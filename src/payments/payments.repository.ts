import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictApiException, RequestValidationException } from '../common/errors/api-error.js';
import { DatabaseService } from '../database/database.service.js';
import { PAYMENT_FROM, buildOrderBy, buildWhere } from './payments.sql.js';
import { toMinorUnits } from './validation/create-payment-body.js';
import {
  type CreatePaymentInput,
  type CurrencyDto,
  type DeclineCode,
  type ListPaymentsQuery,
  type PaymentDto,
  type PaymentFilters,
  type PaymentMethodType,
  type PaymentStatus,
} from './payments.types.js';

interface PaymentRow {
  id: string;
  amount_minor: string;
  currency: string;
  currency_exponent: number;
  status: PaymentStatus;
  description: string | null;
  failure_code: string | null;
  failure_message: string | null;
  refunded_at: Date | null;
  created_at: Date;
  updated_at: Date;
  customer_id: string;
  customer_name: string | null;
  customer_email: string;
  customer_created_at: Date;
  pm_id: string;
  pm_type: PaymentMethodType;
  pm_brand: string | null;
  pm_last4: string;
  pm_wallet: string | null;
  pm_bank_name: string | null;
  pm_exp_month: number | null;
  pm_exp_year: number | null;
}

const PAYMENT_COLUMNS = `
  p.id, p.amount_minor, p.currency, cur.exponent AS currency_exponent, p.status,
  p.description, p.failure_code, p.failure_message, p.refunded_at, p.created_at, p.updated_at,
  c.id AS customer_id, c.name AS customer_name, c.email AS customer_email,
  c.created_at AS customer_created_at,
  pm.id AS pm_id, pm.type AS pm_type, pm.brand AS pm_brand, pm.last4 AS pm_last4,
  pm.wallet AS pm_wallet, pm.bank_name AS pm_bank_name,
  pm.exp_month AS pm_exp_month, pm.exp_year AS pm_exp_year`;

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Stripe-style id (`pi_…`) with 24 random alphanumerics, matching the schema's CHECKs. */
function newId(prefix: 'pi' | 'pm' | 'cus'): string {
  let id = `${prefix}_`;
  for (let i = 0; i < 24; i++) id += ID_ALPHABET.charAt(randomInt(ID_ALPHABET.length));
  return id;
}

/** Largest amount the payments.amount_minor CHECK accepts. */
const AMOUNT_MINOR_MAX = 99_999_999_999n;

/** Any 64-bit key works; it only has to be the same for every create. */
const CREATE_LOCK_KEY = 0x6362_7061_796d_6e74n;

const FAILURE_BY_METHOD: Readonly<Record<string, readonly [DeclineCode, string]>> = {
  card: ['card_declined', 'The card was declined.'],
  wallet: ['card_declined', 'The card was declined.'],
  ach: ['insufficient_funds', 'The account has insufficient funds to complete the purchase.'],
};

export interface PaymentRecord extends PaymentDto {
  readonly customerCreatedAt: string;
}

function toRecord(row: PaymentRow): PaymentRecord {
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor)) throw new Error(`Unsafe amount for payment ${row.id}`);
  return {
    id: row.id,
    amountMinor,
    currency: row.currency,
    currencyExponent: row.currency_exponent,
    status: row.status,
    description: row.description,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    refundedAt: row.refunded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    customer: { id: row.customer_id, name: row.customer_name, email: row.customer_email },
    customerCreatedAt: row.customer_created_at.toISOString(),
    paymentMethod: {
      id: row.pm_id,
      type: row.pm_type,
      brand: row.pm_brand,
      last4: row.pm_last4,
      wallet: row.pm_wallet,
      bankName: row.pm_bank_name,
      expMonth: row.pm_exp_month,
      expYear: row.pm_exp_year,
    },
  };
}

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async count(filters: PaymentFilters): Promise<number> {
    const where = buildWhere(filters);
    const rows = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total ${PAYMENT_FROM} ${where.text}`,
      where.params,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async findPage(query: ListPaymentsQuery, offset: number): Promise<PaymentRecord[]> {
    const where = buildWhere(query);
    const limitIndex = where.params.length + 1;
    const rows = await this.db.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} ${where.text}
       ${buildOrderBy(query.sort, query.direction)}
       LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
      [...where.params, query.limit, offset],
    );
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const rows = await this.db.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} WHERE p.id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  /** Currencies used by any payment (not just a page or a filtered view). */
  async listUsedCurrencies(): Promise<CurrencyDto[]> {
    return this.db.query<CurrencyDto>(
      `SELECT cur.code, cur.name, cur.exponent FROM currencies cur
       WHERE EXISTS (SELECT 1 FROM payments p WHERE p.currency = cur.code)
       ORDER BY cur.code`,
    );
  }

  /** Total rows in the payments table, ignoring every filter. */
  async countAll(): Promise<number> {
    const rows = await this.db.query<{ total: string }>('SELECT count(*) AS total FROM payments');
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Inserts a payment (reusing the customer with the same email, if any) and
   * returns its id. Creates are serialised by a transaction-scoped advisory
   * lock, so concurrent requests can't both pass the `limit` check and push
   * the table over it.
   */
  async create(input: CreatePaymentInput, limit: number): Promise<string> {
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [CREATE_LOCK_KEY.toString()]);

      const countRows = await client.query<{ total: string }>(
        'SELECT count(*) AS total FROM payments',
      );
      if (Number(countRows.rows[0]?.total ?? 0) >= limit) {
        throw new ConflictApiException(
          'PAYMENT_LIMIT_REACHED',
          `This demo holds at most ${limit} payments, and that limit has been reached.`,
        );
      }

      const currencyRows = await client.query<{ exponent: number }>(
        'SELECT exponent FROM currencies WHERE code = $1',
        [input.currency],
      );
      const exponent = currencyRows.rows[0]?.exponent;
      if (exponent === undefined) {
        throw new RequestValidationException([
          { field: 'currency', message: `${input.currency} is not a supported currency` },
        ]);
      }
      const amountMinor = toMinorUnits(input.amount, exponent);
      if (amountMinor === null) {
        throw new RequestValidationException([
          {
            field: 'amount',
            message:
              exponent === 0
                ? `${input.currency} amounts can't have decimals`
                : `${input.currency} amounts can have at most ${exponent} decimals`,
          },
        ]);
      }
      if (amountMinor <= 0n || amountMinor > AMOUNT_MINOR_MAX) {
        throw new RequestValidationException([{ field: 'amount', message: 'is out of range' }]);
      }

      const customerRows = await client.query<{ id: string }>(
        `INSERT INTO customers (id, name, email) VALUES ($1, $2, $3)
         ON CONFLICT ((lower(email))) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name)
         RETURNING id`,
        [newId('cus'), input.customerName, input.customerEmail],
      );
      const customerId = customerRows.rows[0]?.id;
      if (!customerId) throw new Error('Customer upsert returned no row');

      const pm = input.paymentMethod;
      const paymentMethodId = newId('pm');
      await client.query(
        `INSERT INTO payment_methods
           (id, customer_id, type, brand, last4, wallet, bank_name, exp_month, exp_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          paymentMethodId,
          customerId,
          pm.type,
          pm.type === 'ach' ? null : pm.brand,
          pm.last4,
          pm.type === 'wallet' ? pm.wallet : null,
          pm.type === 'ach' ? pm.bankName : null,
          pm.type === 'ach' ? null : pm.expMonth,
          pm.type === 'ach' ? null : pm.expYear,
        ],
      );

      const failure = input.status === 'failed' ? FAILURE_BY_METHOD[pm.type] : null;
      const paymentId = newId('pi');
      await client.query(
        `INSERT INTO payments
           (id, customer_id, payment_method_id, amount_minor, currency, status, description,
            failure_code, failure_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          paymentId,
          customerId,
          paymentMethodId,
          amountMinor.toString(),
          input.currency,
          input.status,
          input.description,
          failure?.[0] ?? null,
          failure?.[1] ?? null,
        ],
      );
      return paymentId;
    });
  }
}

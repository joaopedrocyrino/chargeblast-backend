import type pg from 'pg';
import { generateSeedData, type SeedDataset } from './seed-data.js';

export interface SeedOptions {
  /** Truncate all payment data before inserting (destructive). */
  readonly reset?: boolean;
  /** Reference "now" for relative timestamps. Defaults to the current time. */
  readonly anchor?: Date;
}

export interface SeedSummary {
  readonly customers: number;
  readonly paymentMethods: number;
  readonly payments: number;
}

/**
 * Inserts the deterministic dataset in one transaction. Rows are keyed by
 * deterministic ids and inserted with ON CONFLICT DO NOTHING, so re-running
 * never duplicates data. Returns the number of rows actually inserted.
 */
export async function seedDatabase(pool: pg.Pool, options: SeedOptions = {}): Promise<SeedSummary> {
  const data: SeedDataset = generateSeedData(options.anchor ?? new Date());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.reset) {
      await client.query('TRUNCATE payments, payment_methods, customers');
    }

    const customers = await client.query(
      `INSERT INTO customers (id, name, email, created_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
       ON CONFLICT DO NOTHING`,
      [
        data.customers.map((c) => c.id),
        data.customers.map((c) => c.name),
        data.customers.map((c) => c.email),
        data.customers.map((c) => c.createdAt),
      ],
    );

    const methods = await client.query(
      `INSERT INTO payment_methods
         (id, customer_id, type, brand, last4, wallet, bank_name, exp_month, exp_year, created_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                            $7::text[], $8::smallint[], $9::smallint[], $10::timestamptz[])
       ON CONFLICT DO NOTHING`,
      [
        data.paymentMethods.map((m) => m.id),
        data.paymentMethods.map((m) => m.customerId),
        data.paymentMethods.map((m) => m.type),
        data.paymentMethods.map((m) => m.brand),
        data.paymentMethods.map((m) => m.last4),
        data.paymentMethods.map((m) => m.wallet),
        data.paymentMethods.map((m) => m.bankName),
        data.paymentMethods.map((m) => m.expMonth),
        data.paymentMethods.map((m) => m.expYear),
        data.paymentMethods.map((m) => m.createdAt),
      ],
    );

    const payments = await client.query(
      `INSERT INTO payments
         (id, customer_id, payment_method_id, amount_minor, currency, status, description,
          failure_code, failure_message, refunded_at, created_at, updated_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::text[],
                            $7::text[], $8::text[], $9::text[], $10::timestamptz[],
                            $11::timestamptz[], $12::timestamptz[])
       ON CONFLICT DO NOTHING`,
      [
        data.payments.map((p) => p.id),
        data.payments.map((p) => p.customerId),
        data.payments.map((p) => p.paymentMethodId),
        data.payments.map((p) => p.amountMinor),
        data.payments.map((p) => p.currency),
        data.payments.map((p) => p.status),
        data.payments.map((p) => p.description),
        data.payments.map((p) => p.failureCode),
        data.payments.map((p) => p.failureMessage),
        data.payments.map((p) => p.refundedAt),
        data.payments.map((p) => p.createdAt),
        data.payments.map((p) => p.updatedAt),
      ],
    );

    await client.query('COMMIT');
    return {
      customers: customers.rowCount ?? 0,
      paymentMethods: methods.rowCount ?? 0,
      payments: payments.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

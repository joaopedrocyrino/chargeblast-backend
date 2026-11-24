import { RequestValidationException } from '../../common/errors/api-error.js';
import {
  CARD_BRANDS,
  CREATABLE_STATUSES,
  PAYMENT_METHOD_TYPES,
  WALLETS,
  type CreatePaymentInput,
} from '../payments.types.js';
import { ErrorCollector } from './query-parsers.js';

const BODY_KEYS = [
  'amount',
  'currency',
  'status',
  'description',
  'customerEmail',
  'customerName',
  'method',
  'brand',
  'wallet',
  'last4',
  'expMonth',
  'expYear',
  'bankName',
] as const;

type Body = Readonly<Record<string, unknown>>;

// Same rule as the customers.email CHECK constraint.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Major units with up to 4 decimals; the currency's exponent is checked later. */
const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

function isRecord(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed string; '' and missing become undefined. */
function text(
  body: Body,
  key: string,
  errors: ErrorCollector,
  options: { required: boolean; max: number },
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (options.required) errors.add(key, 'is required');
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.add(key, 'must be a string');
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > options.max) {
    errors.add(key, `must be at most ${options.max} characters`);
    return undefined;
  }
  return trimmed;
}

function oneOf<T extends string>(
  body: Body,
  key: string,
  allowed: readonly T[],
  errors: ErrorCollector,
): T | undefined {
  const value = text(body, key, errors, { required: true, max: 50 });
  if (value === undefined) return undefined;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) errors.add(key, `must be one of: ${allowed.join(', ')}`);
  return match;
}

/** Whole number given as a JSON number or a numeric string. */
function integer(
  body: Body,
  key: string,
  min: number,
  max: number,
  errors: ErrorCollector,
): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    errors.add(key, 'is required');
    return undefined;
  }
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,4}$/.test(value.trim())
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.add(key, `must be a whole number between ${min} and ${max}`);
    return undefined;
  }
  return parsed;
}

/**
 * Validates the `POST /payments` JSON body, reporting every problem at once.
 * The body is flat (one field per form input) so each error maps straight to
 * the input that caused it.
 */
export function parseCreatePaymentBody(raw: unknown, now = new Date()): CreatePaymentInput {
  const errors = new ErrorCollector();
  if (!isRecord(raw)) {
    throw new RequestValidationException([{ field: 'body', message: 'must be a JSON object' }]);
  }
  for (const key of Object.keys(raw)) {
    if (!BODY_KEYS.some((allowed) => allowed === key)) errors.add(key, 'is not a supported field');
  }

  const amount = text(raw, 'amount', errors, { required: true, max: 20 });
  if (amount !== undefined && !AMOUNT.test(amount)) {
    errors.add('amount', 'must be a positive amount, e.g. 49.99');
  } else if (amount !== undefined && Number(amount) <= 0) {
    errors.add('amount', 'must be greater than zero');
  }

  const currency = text(raw, 'currency', errors, { required: true, max: 3 })?.toUpperCase();
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) {
    errors.add('currency', 'must be a 3-letter ISO currency code');
  }

  const status = oneOf(raw, 'status', CREATABLE_STATUSES, errors);
  const description = text(raw, 'description', errors, { required: false, max: 500 }) ?? null;

  const customerEmail = text(raw, 'customerEmail', errors, { required: true, max: 320 });
  if (customerEmail !== undefined && !EMAIL.test(customerEmail)) {
    errors.add('customerEmail', 'must be a valid email address');
  }
  const customerName = text(raw, 'customerName', errors, { required: false, max: 200 }) ?? null;

  const method = oneOf(raw, 'method', PAYMENT_METHOD_TYPES, errors);
  const last4 = text(raw, 'last4', errors, { required: true, max: 4 });
  if (last4 !== undefined && !/^\d{4}$/.test(last4))
    errors.add('last4', 'must be exactly 4 digits');

  let paymentMethod: CreatePaymentInput['paymentMethod'] | undefined;
  if (method === 'ach') {
    const bankName = text(raw, 'bankName', errors, { required: true, max: 100 });
    for (const key of ['brand', 'wallet', 'expMonth', 'expYear']) {
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
        errors.add(key, 'is not used for ACH payments');
      }
    }
    if (bankName !== undefined && last4 !== undefined)
      paymentMethod = { type: 'ach', bankName, last4 };
  } else if (method === 'card' || method === 'wallet') {
    const brand = oneOf(raw, 'brand', CARD_BRANDS, errors);
    const year = now.getUTCFullYear();
    const expMonth = integer(raw, 'expMonth', 1, 12, errors);
    const expYear = integer(raw, 'expYear', year, year + 20, errors);
    if (
      expMonth !== undefined &&
      expYear !== undefined &&
      expYear === year &&
      expMonth < now.getUTCMonth() + 1
    ) {
      errors.add('expMonth', 'the card has already expired');
    }
    if (raw['bankName'] !== undefined && raw['bankName'] !== null && raw['bankName'] !== '') {
      errors.add('bankName', 'is only used for ACH payments');
    }
    if (method === 'wallet') {
      const wallet = oneOf(raw, 'wallet', WALLETS, errors);
      if (
        wallet &&
        brand &&
        last4 !== undefined &&
        expMonth !== undefined &&
        expYear !== undefined
      ) {
        paymentMethod = { type: 'wallet', wallet, brand, last4, expMonth, expYear };
      }
    } else {
      if (raw['wallet'] !== undefined && raw['wallet'] !== null && raw['wallet'] !== '') {
        errors.add('wallet', 'is only used for wallet payments');
      }
      if (brand && last4 !== undefined && expMonth !== undefined && expYear !== undefined) {
        paymentMethod = { type: 'card', brand, last4, expMonth, expYear };
      }
    }
  }

  if (
    errors.errors.length > 0 ||
    amount === undefined ||
    currency === undefined ||
    status === undefined ||
    customerEmail === undefined ||
    paymentMethod === undefined
  ) {
    throw new RequestValidationException(errors.errors);
  }
  return { amount, currency, status, description, customerEmail, customerName, paymentMethod };
}

/**
 * Converts a validated major-unit amount to integer minor units for a
 * currency with `exponent` decimals, without floating point. Returns null
 * when the amount has more decimals than the currency allows.
 */
export function toMinorUnits(amount: string, exponent: number): bigint | null {
  const [whole = '0', rawFraction = ''] = amount.split('.');
  // "100.00" is a fine way to write ¥100: only significant decimals count.
  const fraction = rawFraction.replace(/0+$/, '');
  if (fraction.length > exponent) return null;
  return BigInt(whole + fraction.padEnd(exponent, '0'));
}

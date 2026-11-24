import { describe, expect, it } from 'vitest';
import { RequestValidationException } from '../../src/common/errors/api-error.js';
import {
  parseCreatePaymentBody,
  toMinorUnits,
} from '../../src/payments/validation/create-payment-body.js';

const NOW = new Date('2026-06-15T12:00:00Z');

const card = {
  amount: '49.99',
  currency: 'usd',
  status: 'succeeded',
  customerEmail: ' jane@example.com ',
  customerName: 'Jane Doe',
  method: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: '12',
  expYear: 2028,
};

function fieldErrors(body: unknown): Record<string, string> {
  try {
    parseCreatePaymentBody(body, NOW);
  } catch (error) {
    expect(error).toBeInstanceOf(RequestValidationException);
    const details = (error as RequestValidationException).details ?? [];
    return Object.fromEntries(details.map((d) => [d.field, d.message]));
  }
  throw new Error('expected validation to fail');
}

describe('parseCreatePaymentBody', () => {
  it('accepts a wallet payment with its own fields', () => {
    expect(
      parseCreatePaymentBody({ ...card, method: 'wallet', wallet: 'apple_pay' }, NOW),
    ).toMatchObject({
      currency: 'USD',
      customerEmail: 'jane@example.com',
      paymentMethod: { type: 'wallet', wallet: 'apple_pay', brand: 'visa', expMonth: 12 },
    });
  });

  it('reports every invalid field at once', () => {
    expect(
      fieldErrors({
        amount: '-1',
        currency: 'dollars',
        status: 'refunded',
        customerEmail: 'nope',
        method: 'card',
        brand: 'acme',
        last4: '12',
        expMonth: 13,
        expYear: 2020,
        extra: true,
      }),
    ).toEqual({
      extra: 'is not a supported field',
      amount: 'must be a positive amount, e.g. 49.99',
      currency: 'must be at most 3 characters',
      status: 'must be one of: succeeded, pending, failed',
      customerEmail: 'must be a valid email address',
      last4: 'must be exactly 4 digits',
      brand: 'must be one of: visa, mastercard, amex, discover, jcb, unionpay, diners',
      expMonth: 'must be a whole number between 1 and 12',
      expYear: 'must be a whole number between 2026 and 2046',
    });
  });

  it('rejects zero, expired cards and fields from another method', () => {
    expect(fieldErrors({ ...card, amount: '0.00' })).toEqual({
      amount: 'must be greater than zero',
    });
    expect(fieldErrors({ ...card, expMonth: 5, expYear: 2026 })).toEqual({
      expMonth: 'the card has already expired',
    });
    expect(fieldErrors({ ...card, method: 'ach', bankName: 'Chase' })).toEqual({
      brand: 'is not used for ACH payments',
      expMonth: 'is not used for ACH payments',
      expYear: 'is not used for ACH payments',
    });
  });
});

describe('toMinorUnits', () => {
  it('converts exactly and refuses more decimals than the currency has', () => {
    expect(toMinorUnits('49.99', 2)).toBe(4999n);
    expect(toMinorUnits('0.1', 2)).toBe(10n);
    expect(toMinorUnits('1200.00', 0)).toBe(1200n);
    expect(toMinorUnits('999999999.99', 2)).toBe(99999999999n);
    expect(toMinorUnits('1.5', 0)).toBeNull();
    expect(toMinorUnits('1.005', 2)).toBeNull();
  });
});

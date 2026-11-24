import { describe, expect, it } from 'vitest';
import { RequestValidationException } from '../../src/common/errors/api-error.js';
import {
  parseListPaymentsQuery,
  parsePaymentId,
} from '../../src/payments/validation/list-payments-query.js';

function fields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof RequestValidationException)
      return (error.details ?? []).map((d) => d.field).sort();
    throw error;
  }
  throw new Error('expected a RequestValidationException');
}

// Single-field rejections are covered by the integration tests; these cover
// what only shows up at this level.
describe('query validation', () => {
  it('reports every problem at once, including unknown parameters', () => {
    expect(
      fields(() =>
        parseListPaymentsQuery({ limit: '1000', sort: 'customer', direction: 'up', foo: 'bar' }),
      ),
    ).toEqual(['direction', 'foo', 'limit', 'sort']);
  });

  it('accepts only Stripe-style payment ids', () => {
    expect(parsePaymentId('pi_3QabcdefGHIJKLMNop')).toBe('pi_3QabcdefGHIJKLMNop');
    for (const bad of ['pi_short', 'cus_3QabcdefGHIJKLMNop', "pi_3Qabcdef' OR 1=1--"]) {
      expect(() => parsePaymentId(bad)).toThrow(RequestValidationException);
    }
  });
});

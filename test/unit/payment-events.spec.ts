import { describe, expect, it } from 'vitest';
import { derivePaymentEvents } from '../../src/payments/payment-events.js';
import type { PaymentDto } from '../../src/payments/payments.types.js';

const failed: PaymentDto = {
  id: 'pi_aaaaaaaaaaaaaaaaaaaaaaaa',
  amountMinor: 1000,
  currency: 'USD',
  currencyExponent: 2,
  status: 'failed',
  description: null,
  failureCode: 'expired_card',
  failureMessage: 'The card has expired.',
  refundedAt: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:05.000Z',
  customer: { id: 'cus_aaaaaaaaaaaaaa', name: 'A', email: 'a@example.com' },
  paymentMethod: {
    id: 'pm_aaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    wallet: null,
    bankName: null,
    expMonth: 1,
    expYear: 2030,
  },
};

// The refunded timeline is covered by the payment detail integration test.
describe('derivePaymentEvents', () => {
  it('ends a failed payment with the failure reason, newest first', () => {
    const events = derivePaymentEvents(failed);
    expect(events.map((e) => e.type)).toEqual(['payment.failed', 'payment.created']);
    expect(events[0]).toEqual({
      type: 'payment.failed',
      title: 'Payment failed: The card has expired.',
      occurredAt: failed.updatedAt,
    });
  });

  it('shows the dispute after the successful charge', () => {
    const events = derivePaymentEvents({ ...failed, status: 'disputed', failureCode: null });
    expect(events.map((e) => e.type)).toEqual([
      'charge.dispute.created',
      'payment.succeeded',
      'payment.created',
    ]);
  });
});

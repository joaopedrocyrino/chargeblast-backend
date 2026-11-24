import type { PaymentDto, PaymentEventDto } from './payments.types.js';

/**
 * Derives a human-readable timeline from the payment's own timestamps. The
 * schema intentionally has no events table: the timeline is fully determined
 * by status, created_at, updated_at and refunded_at.
 */
export function derivePaymentEvents(payment: PaymentDto): PaymentEventDto[] {
  const events: PaymentEventDto[] = [
    { type: 'payment.created', title: 'Payment started', occurredAt: payment.createdAt },
  ];
  switch (payment.status) {
    case 'pending':
      events.push({
        type: 'payment.pending',
        title: 'Payment is pending confirmation',
        occurredAt: payment.updatedAt,
      });
      break;
    case 'failed':
      events.push({
        type: 'payment.failed',
        title: `Payment failed${payment.failureMessage ? `: ${payment.failureMessage}` : ''}`,
        occurredAt: payment.updatedAt,
      });
      break;
    case 'succeeded':
      events.push({
        type: 'payment.succeeded',
        title: 'Payment succeeded',
        occurredAt: payment.updatedAt,
      });
      break;
    case 'uncaptured':
      events.push({
        type: 'payment.uncaptured',
        title: 'Payment authorized, awaiting capture',
        occurredAt: payment.updatedAt,
      });
      break;
    case 'disputed':
      events.push({
        type: 'payment.succeeded',
        title: 'Payment succeeded',
        occurredAt: payment.createdAt,
      });
      events.push({
        type: 'charge.dispute.created',
        title: 'Payment disputed by the customer',
        occurredAt: payment.updatedAt,
      });
      break;
    case 'refunded':
      events.push({
        type: 'payment.succeeded',
        title: 'Payment succeeded',
        occurredAt: payment.createdAt,
      });
      if (payment.refundedAt) {
        events.push({
          type: 'charge.refunded',
          title: 'Payment refunded',
          occurredAt: payment.refundedAt,
        });
      }
      break;
  }
  // Newest first, as dashboards display timelines.
  return events.reverse();
}

import { describe, expect, it } from 'vitest';
import { generateSeedData } from '../../src/database/seed/seed-data.js';

const anchor = new Date('2026-06-15T12:00:00Z');

// Volume and re-run behaviour are covered by the database integration test.
describe('generateSeedData', () => {
  const data = generateSeedData(anchor);

  it('is deterministic, and ids do not depend on the anchor', () => {
    expect(generateSeedData(anchor)).toEqual(data);
    const later = generateSeedData(new Date('2027-01-01T00:00:00Z'));
    expect(later.payments.map((p) => p.id)).toEqual(data.payments.map((p) => p.id));
  });

  it('only produces rows the schema accepts', () => {
    const owner = new Map(data.paymentMethods.map((m) => [m.id, m.customerId]));
    for (const p of data.payments) {
      expect(owner.get(p.paymentMethodId)).toBe(p.customerId);
      expect(p.failureCode !== null).toBe(p.status === 'failed');
      expect(p.refundedAt !== null).toBe(p.status === 'refunded');
      expect(p.updatedAt.getTime()).toBeGreaterThanOrEqual(p.createdAt.getTime());
      expect(p.createdAt.getTime()).toBeLessThanOrEqual(anchor.getTime());
    }
  });
});

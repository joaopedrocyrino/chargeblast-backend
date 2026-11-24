import { describe, expect, it } from 'vitest';
import { buildWhere } from '../../src/payments/payments.sql.js';

// Filter, sort and search behaviour is covered end to end by the integration
// tests; this guards the one property those can't observe directly.
describe('buildWhere', () => {
  it('never interpolates user input into the SQL text', () => {
    const evil = "'; DROP TABLE payments; --";
    const where = buildWhere({
      statuses: [],
      methods: [],
      currencies: [],
      brands: [],
      declineCodes: [],
      search: evil,
    });
    expect(where.text).not.toContain('DROP');
    expect(where.params).toEqual([`%${evil.toLowerCase()}%`]);
  });
});

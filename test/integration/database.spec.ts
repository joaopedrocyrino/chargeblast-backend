import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database/migrator.js';
import { CUSTOMER_COUNT, PAYMENT_COUNT } from '../../src/database/seed/seed-data.js';
import { seedDatabase } from '../../src/database/seed/seeder.js';
import { createTestPool } from './helpers.js';
import { TEST_ANCHOR } from './test-env.js';

describe('migrations and seed (real PostgreSQL)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = createTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('records applied migrations and is a no-op when re-run', async () => {
    const result = await runMigrations(pool, undefined, () => undefined);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('0001');
    const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toContain('0001');
  });

  it('seeds the expected volume and never duplicates on re-run', async () => {
    const counts = async (): Promise<number[]> => {
      const { rows } = await pool.query<{ c: string; p: string }>(
        'SELECT (SELECT count(*) FROM customers) AS c, (SELECT count(*) FROM payments) AS p',
      );
      return [Number(rows[0]?.c), Number(rows[0]?.p)];
    };
    expect(await counts()).toEqual([CUSTOMER_COUNT, PAYMENT_COUNT]);
    const summary = await seedDatabase(pool, { anchor: TEST_ANCHOR });
    expect(summary).toEqual({ customers: 0, paymentMethods: 0, payments: 0 });
    expect(await counts()).toEqual([CUSTOMER_COUNT, PAYMENT_COUNT]);
  });

  it('enforces integrity constraints', async () => {
    const { rows } = await pool.query<{
      id: string;
      customer_id: string;
      payment_method_id: string;
    }>('SELECT id, customer_id, payment_method_id FROM payments LIMIT 1');
    const sample = rows[0];
    if (!sample) throw new Error('no seeded payment');
    // Negative amounts are rejected.
    await expect(
      pool.query('UPDATE payments SET amount_minor = -1 WHERE id = $1', [sample.id]),
    ).rejects.toThrow(/check constraint/);
    // Unknown status is rejected.
    await expect(
      pool.query("UPDATE payments SET status = 'lost' WHERE id = $1", [sample.id]),
    ).rejects.toThrow(/check constraint/);
    // A payment cannot use another customer's payment method.
    const other = await pool.query<{ id: string }>(
      'SELECT id FROM payment_methods WHERE customer_id <> $1 LIMIT 1',
      [sample.customer_id],
    );
    await expect(
      pool.query('UPDATE payments SET payment_method_id = $1 WHERE id = $2', [
        other.rows[0]?.id,
        sample.id,
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});

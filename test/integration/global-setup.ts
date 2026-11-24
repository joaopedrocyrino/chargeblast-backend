import pg from 'pg';
import { runMigrations } from '../../src/database/migrator.js';
import { createPool } from '../../src/database/pool.js';
import { seedDatabase } from '../../src/database/seed/seeder.js';
import { TEST_ANCHOR, TEST_DATABASE_URL } from './test-env.js';

/**
 * Recreates the test database schema from scratch, applies migrations and
 * seeds deterministic data. Refuses to run against a database whose name does
 * not end in `_test` to protect development/production data.
 */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": integration tests require a *_test database`);
  }

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();

  const pool = createPool(TEST_DATABASE_URL, 2);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool, undefined, () => undefined);
    await seedDatabase(pool, { anchor: TEST_ANCHOR });
  } finally {
    await pool.end();
  }
}

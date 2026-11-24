/** Shared settings for integration tests (real PostgreSQL, isolated database). */
export const TEST_DATABASE_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://chargeblast:chargeblast_local_password@localhost:5433/chargeblast_test';

/** Fixed "now" used for seeding so assertions are deterministic. */
export const TEST_ANCHOR = new Date('2026-06-15T12:00:00.000Z');

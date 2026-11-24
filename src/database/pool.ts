import pg from 'pg';

// Return BIGINT (int8) columns as strings is pg's default. Amounts are bounded
// by a CHECK constraint well below Number.MAX_SAFE_INTEGER, but conversion is
// still done explicitly in the repository rather than globally here.

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries; the API's queries are all small.
    statement_timeout: 10_000,
    application_name: 'chargeblast-backend',
  });
  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on('error', (error) => {
    console.error('[pg] idle client error', error.message);
  });
  return pool;
}

import { loadConfig } from '../../config/app-config.js';
import { createPool } from '../pool.js';
import { seedDatabase } from '../seed/seeder.js';

// Usage: node dist/database/cli/seed.js [--reset]
//   --reset  truncates customers/payment_methods/payments first (destructive),
//            which also refreshes timestamps relative to "now".
const reset = process.argv.includes('--reset');
const config = loadConfig();
if (reset && config.nodeEnv === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to --reset in production without --force');
  process.exit(1);
}
const pool = createPool(config.databaseUrl, 1);
try {
  const summary = await seedDatabase(pool, { reset });
  console.log(
    `Seed complete (${reset ? 'reset' : 'idempotent'}): inserted ${summary.customers} customers, ` +
      `${summary.paymentMethods} payment methods, ${summary.payments} payments`,
  );
} catch (error) {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

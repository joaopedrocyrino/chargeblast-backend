import { loadConfig } from '../../config/app-config.js';
import { runMigrations } from '../migrator.js';
import { createPool } from '../pool.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl, 1);
try {
  const result = await runMigrations(pool);
  console.log(
    `Migrations complete: ${result.applied.length} applied, ${result.skipped.length} already up to date`,
  );
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

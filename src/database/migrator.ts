import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** Default location of the versioned `.sql` migrations (repo root). */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Arbitrary constant key so concurrent migrators (e.g. two containers) serialise.
const ADVISORY_LOCK_KEY = 7_342_001;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

async function loadMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const file of entries) {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1] || !match[2]) {
      throw new Error(`Migration "${file}" must be named NNNN_snake_case_name.sql`);
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    files.push({
      version: match[1],
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(files.map((file) => file.version));
  if (versions.size !== files.length) throw new Error('Duplicate migration version numbers');
  return files;
}

/**
 * Applies pending migrations in version order, each inside its own
 * transaction. Already-applied migrations are verified by checksum so edits
 * to history are detected instead of silently ignored.
 */
export async function runMigrations(
  pool: pg.Pool,
  dir = MIGRATIONS_DIR,
  log: (message: string) => void = console.log,
): Promise<MigrationResult> {
  const files = await loadMigrationFiles(dir);
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const existing = applied.get(file.version);
      if (existing !== undefined) {
        if (existing !== file.checksum) {
          throw new Error(
            `Migration ${file.version}_${file.name} was modified after being applied (checksum mismatch)`,
          );
        }
        result.skipped.push(file.version);
        continue;
      }
      log(`Applying migration ${file.version}_${file.name}`);
      try {
        await client.query('BEGIN');
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [file.version, file.name, file.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      result.applied.push(file.version);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

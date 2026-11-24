import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { createApp } from '../../src/app.factory.js';
import { loadConfig } from '../../src/config/app-config.js';
import { TEST_DATABASE_URL } from './test-env.js';

export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const app = await createApp(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, DB_POOL_MAX: '4', ...env }),
  );
  await app.init();
  return app;
}

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
}

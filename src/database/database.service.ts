import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from './database.constants.js';

/** Thin wrapper around the pg pool. Every query is parameterised. */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async query<Row extends pg.QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const result = await this.pool.query<Row>(text, params as unknown[]);
    return result.rows;
  }

  /**
   * Runs `work` inside BEGIN/COMMIT on a dedicated client, rolling back if it
   * throws. Every statement in `work` must go through the given client.
   */
  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Resolves when the database answers a trivial query within `timeoutMs`. */
  async ping(timeoutMs = 2_000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`database ping timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

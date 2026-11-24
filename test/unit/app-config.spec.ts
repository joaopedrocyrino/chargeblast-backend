import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/app-config.js';

const valid = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'development',
      port: 4000,
      databaseUrl: valid.DATABASE_URL,
      dbPoolMax: 10,
      corsOrigins: [],
      seedOnStart: false,
      paymentCreateLimit: 3000,
    });
  });

  it('reports every invalid variable', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'mysql://x',
        PORT: '99999',
        SEED_ON_START: 'yes',
        CORS_ORIGIN: 'nope',
      }),
    ).toThrow(ConfigError);
    try {
      loadConfig({ DATABASE_URL: 'mysql://x', PORT: 'abc' });
    } catch (error) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).toContain('PORT');
    }
  });
});

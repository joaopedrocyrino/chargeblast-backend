/**
 * Typed, validated application configuration read from environment variables.
 * Invalid configuration fails fast at start-up with a readable message.
 */
export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly corsOrigins: readonly string[];
  readonly seedOnStart: boolean;
  /**
   * Maximum number of rows the payments table may hold before
   * `POST /payments` is refused. The API is public and unauthenticated, so
   * this cap is what keeps anonymous visitors from growing the table forever.
   */
  readonly paymentCreateLimit: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const DEFAULT_PAYMENT_CREATE_LIMIT = 3000;

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function parseInteger(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${key} must be an integer`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) problems.push(`${key} must be between ${min} and ${max}`);
  return value;
}

function parseBoolean(env: Env, key: string, fallback: boolean, problems: string[]): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  problems.push(`${key} must be "true" or "false"`);
  return fallback;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  const rawNodeEnv = env['NODE_ENV'] ?? 'development';
  const nodeEnv = rawNodeEnv === 'production' || rawNodeEnv === 'test' ? rawNodeEnv : 'development';

  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must be a postgres:// connection string');
  }

  const corsOrigins = (env['CORS_ORIGIN'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of corsOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin))
      problems.push(`CORS_ORIGIN entry "${origin}" is invalid`);
  }

  const config: AppConfig = {
    nodeEnv,
    port: parseInteger(env, 'PORT', 4000, 1, 65535, problems),
    databaseUrl,
    dbPoolMax: parseInteger(env, 'DB_POOL_MAX', 10, 1, 100, problems),
    corsOrigins,
    seedOnStart: parseBoolean(env, 'SEED_ON_START', false, problems),
    paymentCreateLimit: parseInteger(
      env,
      'PAYMENT_CREATE_LIMIT',
      DEFAULT_PAYMENT_CREATE_LIMIT,
      0,
      1_000_000,
      problems,
    ),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

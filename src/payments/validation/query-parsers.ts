import type { FieldError } from '../../common/errors/api-error.js';

/**
 * Low-level runtime parsers for raw query-string values. Express hands us
 * `unknown` (string, string[], nested objects from qs, ...), so every parser
 * narrows explicitly and records a FieldError instead of throwing, allowing
 * all problems to be reported at once.
 */
export type RawQuery = Readonly<Record<string, unknown>>;

export class ErrorCollector {
  readonly errors: FieldError[] = [];

  add(field: string, message: string): void {
    this.errors.push({ field, message });
  }
}

/** Single string value; arrays/objects are rejected. */
export function readString(raw: RawQuery, key: string, errors: ErrorCollector): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.add(key, 'must be provided at most once as a plain value');
    return undefined;
  }
  return value;
}

/** Positive integer within [min, max]. */
export function readInteger(
  raw: RawQuery,
  key: string,
  options: { min: number; max: number; fallback: number },
  errors: ErrorCollector,
): number {
  const value = readString(raw, key, errors);
  if (value === undefined || value === '') return options.fallback;
  if (!/^\d{1,9}$/.test(value)) {
    errors.add(key, 'must be a whole number');
    return options.fallback;
  }
  const parsed = Number(value);
  if (parsed < options.min || parsed > options.max) {
    errors.add(key, `must be between ${options.min} and ${options.max}`);
    return options.fallback;
  }
  return parsed;
}

/** Value restricted to a closed set. */
export function readEnum<T extends string>(
  raw: RawQuery,
  key: string,
  allowed: readonly T[],
  fallback: T,
  errors: ErrorCollector,
): T {
  const value = readString(raw, key, errors);
  if (value === undefined || value === '') return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    errors.add(key, `must be one of: ${allowed.join(', ')}`);
    return fallback;
  }
  return match;
}

/**
 * Multi-valued enum. Accepts `?status=a,b`, `?status=a&status=b`, or a mix.
 * Duplicates are removed; order follows `allowed` for stable SQL/caching.
 */
export function readEnumList<T extends string>(
  raw: RawQuery,
  key: string,
  allowed: readonly T[],
  errors: ErrorCollector,
): T[] {
  const value = raw[key];
  if (value === undefined) return [];
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  const tokens: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') {
      errors.add(key, 'must be a comma-separated list of values');
      return [];
    }
    tokens.push(
      ...part
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token !== ''),
    );
  }
  const invalid = tokens.filter((token) => !allowed.some((candidate) => candidate === token));
  if (invalid.length > 0) {
    errors.add(
      key,
      `contains unsupported value(s) ${invalid.join(', ')}; allowed: ${allowed.join(', ')}`,
    );
    return [];
  }
  return allowed.filter((candidate) => tokens.includes(candidate));
}

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * ISO-8601 instant. A bare date (YYYY-MM-DD) means midnight UTC; a date-time
 * MUST carry an explicit offset or `Z`, so the server never guesses the
 * client's time zone. Impossible calendar dates (Feb 30) are rejected.
 */
export function readDate(raw: RawQuery, key: string, errors: ErrorCollector): Date | undefined {
  const value = readString(raw, key, errors);
  if (value === undefined || value === '') return undefined;
  const match = ISO_DATE_TIME.exec(value);
  if (!match) {
    errors.add(key, 'must be an ISO-8601 date (YYYY-MM-DD) or date-time with offset');
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(match[4] === undefined ? `${value}T00:00:00Z` : value);
  const calendarCheck = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    Number.isNaN(date.getTime()) ||
    calendarCheck.getUTCMonth() !== Number(month) - 1 ||
    calendarCheck.getUTCDate() !== Number(day) ||
    (hour !== undefined && Number(hour) > 23) ||
    (minute !== undefined && Number(minute) > 59) ||
    (second !== undefined && Number(second) > 59)
  ) {
    errors.add(key, 'is not a valid calendar date/time');
    return undefined;
  }
  const yearNumber = date.getUTCFullYear();
  if (yearNumber < 2000 || yearNumber > 2100) {
    errors.add(key, 'must be between the years 2000 and 2100');
    return undefined;
  }
  return date;
}

/** Largest amount accepted in a filter, in major units. */
const AMOUNT_FILTER_MAX = 1_000_000_000;

/**
 * Non-negative decimal amount in major units with at most 2 fractional digits.
 * Returned as a normalised string and bound as `numeric` so no floating-point
 * rounding is ever involved.
 */
export function readAmount(raw: RawQuery, key: string, errors: ErrorCollector): string | undefined {
  const value = readString(raw, key, errors);
  if (value === undefined || value.trim() === '') return undefined;
  const trimmed = value.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(trimmed)) {
    errors.add(key, 'must be a non-negative amount with at most 2 decimal places');
    return undefined;
  }
  if (Number(trimmed) > AMOUNT_FILTER_MAX) {
    errors.add(key, `must not exceed ${AMOUNT_FILTER_MAX}`);
    return undefined;
  }
  return trimmed.replace(/^0+(?=\d)/, '');
}

/**
 * Comma-separated ISO-4217 codes (`?currency=usd,EUR`), upper-cased and
 * deduplicated. The set isn't closed: it is whatever the database holds.
 */
export function readCurrencyList(raw: RawQuery, key: string, errors: ErrorCollector): string[] {
  const value = readString(raw, key, errors);
  if (value === undefined) return [];
  const codes = value
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token !== '');
  const invalid = codes.filter((code) => !/^[A-Z]{3}$/.test(code));
  if (invalid.length > 0) {
    errors.add(key, `must be 3-letter currency codes; got ${invalid.join(', ')}`);
    return [];
  }
  if (codes.length > 20) {
    errors.add(key, 'accepts at most 20 currencies');
    return [];
  }
  return [...new Set(codes)].sort();
}

import {
  STATUS_SORT_ORDER,
  type PaymentFilters,
  type SortDirection,
  type SortField,
} from './payments.types.js';

/**
 * Pure SQL fragment builders. Untrusted values only ever travel as bind
 * parameters ($n); the only text spliced into SQL comes from the closed
 * whitelists below, selected by already-validated enum values.
 */
export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

export const PAYMENT_FROM = `
  FROM payments p
  JOIN customers c ON c.id = p.customer_id
  JOIN payment_methods pm ON pm.id = p.payment_method_id
  JOIN currencies cur ON cur.code = p.currency`;

/** Escapes LIKE metacharacters so user input matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * WHERE clause for the shared filters. Semantics:
 *  - values inside one multi-select (status, method, currency, brand, decline) are OR-ed
 *  - a refunded-date range only matches refunded payments
 *  - different filter categories are AND-ed
 *  - search matches payment id (substring), customer email or name
 *    (substring, case-insensitive) or, for 4-digit input, the exact last4
 *  - amount bounds are inclusive and expressed in MAJOR units of each
 *    payment's own currency (no FX conversion)
 */
export function buildWhere(filters: PaymentFilters, startIndex = 1): SqlFragment {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  };

  if (filters.search) {
    const pattern = bind(`%${escapeLike(filters.search.toLowerCase())}%`);
    const alternatives = [
      `lower(p.id) LIKE ${pattern}`,
      `lower(c.email) LIKE ${pattern}`,
      `lower(c.name) LIKE ${pattern}`,
    ];
    if (/^\d{4}$/.test(filters.search)) alternatives.push(`pm.last4 = ${bind(filters.search)}`);
    conditions.push(`(${alternatives.join(' OR ')})`);
  }
  if (filters.statuses.length > 0) {
    conditions.push(`p.status = ANY(${bind(filters.statuses)}::text[])`);
  }
  if (filters.methods.length > 0) {
    conditions.push(`pm.type = ANY(${bind(filters.methods)}::text[])`);
  }
  if (filters.currencies.length > 0) {
    conditions.push(`p.currency = ANY(${bind(filters.currencies)}::text[])`);
  }
  if (filters.brands.length > 0) {
    conditions.push(`pm.brand = ANY(${bind(filters.brands)}::text[])`);
  }
  if (filters.declineCodes.length > 0) {
    conditions.push(`p.failure_code = ANY(${bind(filters.declineCodes)}::text[])`);
  }
  if (filters.refundedFrom) {
    conditions.push(`p.refunded_at >= ${bind(filters.refundedFrom)}`);
  }
  if (filters.refundedTo) {
    conditions.push(`p.refunded_at < ${bind(filters.refundedTo)}`);
  }
  if (filters.createdFrom) {
    conditions.push(`p.created_at >= ${bind(filters.createdFrom)}`);
  }
  if (filters.createdTo) {
    conditions.push(`p.created_at < ${bind(filters.createdTo)}`);
  }
  if (filters.amountMin !== undefined) {
    // amount_minor >= min * 10^exponent keeps the comparison exact (numeric).
    conditions.push(
      `p.amount_minor >= ${bind(filters.amountMin)}::numeric * power(10, cur.exponent)`,
    );
  }
  if (filters.amountMax !== undefined) {
    conditions.push(
      `p.amount_minor <= ${bind(filters.amountMax)}::numeric * power(10, cur.exponent)`,
    );
  }

  return {
    text: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

const STATUS_RANK = `array_position(ARRAY[${STATUS_SORT_ORDER.map((s) => `'${s}'`).join(', ')}]::text[], p.status)`;

/**
 * ORDER BY for each sort field. Every variant ends with unique keys
 * (created_at, id) so pagination is deterministic even with ties.
 *  - created: chronological, id breaks ties in the same direction
 *  - amount:  grouped by currency code (always A→Z, amounts in different
 *             currencies are not comparable), then amount in the requested
 *             direction, then newest first
 *  - status:  by STATUS_SORT_ORDER rank, then newest first
 */
export function buildOrderBy(sort: SortField, direction: SortDirection): string {
  const dir = direction === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'created':
      return `ORDER BY p.created_at ${dir}, p.id ${dir}`;
    case 'amount':
      return `ORDER BY p.currency ASC, p.amount_minor ${dir}, p.created_at DESC, p.id DESC`;
    case 'status':
      return `ORDER BY ${STATUS_RANK} ${dir}, p.created_at DESC, p.id DESC`;
  }
}

export interface PageWindow {
  readonly offset: number;
  readonly totalPages: number;
}

export function computePageWindow(page: number, limit: number, total: number): PageWindow {
  return {
    offset: (page - 1) * limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

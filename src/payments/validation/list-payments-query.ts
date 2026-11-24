import { RequestValidationException } from '../../common/errors/api-error.js';
import {
  CARD_BRANDS,
  DECLINE_CODES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PAYMENT_METHOD_TYPES,
  PAYMENT_STATUSES,
  SEARCH_MAX_LENGTH,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  type ListPaymentsQuery,
  type PaymentFilters,
} from '../payments.types.js';
import {
  ErrorCollector,
  readAmount,
  readCurrencyList,
  readDate,
  readEnum,
  readEnumList,
  readInteger,
  readString,
  type RawQuery,
} from './query-parsers.js';

const FILTER_KEYS = [
  'search',
  'status',
  'method',
  'currency',
  'brand',
  'decline',
  'refundedFrom',
  'refundedTo',
  'createdFrom',
  'createdTo',
  'amountMin',
  'amountMax',
] as const;
const LIST_KEYS = [...FILTER_KEYS, 'page', 'limit', 'sort', 'direction'] as const;

function rejectUnknownKeys(
  raw: RawQuery,
  allowed: readonly string[],
  errors: ErrorCollector,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) errors.add(key, 'is not a supported query parameter');
  }
}

function parseFilters(raw: RawQuery, errors: ErrorCollector): PaymentFilters {
  const rawSearch = readString(raw, 'search', errors)?.trim();
  if (rawSearch !== undefined && rawSearch.length > SEARCH_MAX_LENGTH) {
    errors.add('search', `must be at most ${SEARCH_MAX_LENGTH} characters`);
  }
  const statuses = readEnumList(raw, 'status', PAYMENT_STATUSES, errors);
  const methods = readEnumList(raw, 'method', PAYMENT_METHOD_TYPES, errors);
  const currencies = readCurrencyList(raw, 'currency', errors);
  const brands = readEnumList(raw, 'brand', CARD_BRANDS, errors);
  const declineCodes = readEnumList(raw, 'decline', DECLINE_CODES, errors);
  const refundedFrom = readDate(raw, 'refundedFrom', errors);
  const refundedTo = readDate(raw, 'refundedTo', errors);
  if (refundedFrom && refundedTo && refundedFrom.getTime() >= refundedTo.getTime()) {
    errors.add('refundedTo', 'must be later than refundedFrom');
  }
  const createdFrom = readDate(raw, 'createdFrom', errors);
  const createdTo = readDate(raw, 'createdTo', errors);
  const amountMin = readAmount(raw, 'amountMin', errors);
  const amountMax = readAmount(raw, 'amountMax', errors);

  if (createdFrom && createdTo && createdFrom.getTime() >= createdTo.getTime()) {
    errors.add('createdTo', 'must be later than createdFrom');
  }
  if (amountMin !== undefined && amountMax !== undefined && Number(amountMin) > Number(amountMax)) {
    errors.add('amountMax', 'must be greater than or equal to amountMin');
  }

  return {
    ...(rawSearch ? { search: rawSearch } : {}),
    statuses,
    methods,
    currencies,
    brands,
    declineCodes,
    ...(refundedFrom ? { refundedFrom } : {}),
    ...(refundedTo ? { refundedTo } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(amountMin !== undefined ? { amountMin } : {}),
    ...(amountMax !== undefined ? { amountMax } : {}),
  };
}

/** Validates `GET /payments` query parameters or throws a 400 with every problem. */
export function parseListPaymentsQuery(raw: RawQuery): ListPaymentsQuery {
  const errors = new ErrorCollector();
  rejectUnknownKeys(raw, LIST_KEYS, errors);
  const filters = parseFilters(raw, errors);
  const query: ListPaymentsQuery = {
    ...filters,
    page: readInteger(raw, 'page', { min: 1, max: 100_000, fallback: 1 }, errors),
    limit: readInteger(
      raw,
      'limit',
      { min: 1, max: PAGE_SIZE_MAX, fallback: PAGE_SIZE_DEFAULT },
      errors,
    ),
    sort: readEnum(raw, 'sort', SORT_FIELDS, 'created', errors),
    direction: readEnum(raw, 'direction', SORT_DIRECTIONS, 'desc', errors),
  };
  if (errors.errors.length > 0) throw new RequestValidationException(errors.errors);
  return query;
}

const PAYMENT_ID = /^pi_[A-Za-z0-9]{14,64}$/;

export function parsePaymentId(raw: string): string {
  if (!PAYMENT_ID.test(raw)) {
    throw new RequestValidationException([
      { field: 'id', message: 'must be a payment id (pi_...)' },
    ]);
  }
  return raw;
}

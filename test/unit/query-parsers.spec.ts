import { describe, expect, it } from 'vitest';
import {
  ErrorCollector,
  readAmount,
  readDate,
} from '../../src/payments/validation/query-parsers.js';

function collect<T>(fn: (errors: ErrorCollector) => T): {
  value: T;
  errors: ErrorCollector['errors'];
} {
  const errors = new ErrorCollector();
  const value = fn(errors);
  return { value, errors: errors.errors };
}

// Edge cases of the two parsers with real logic; the simple ones (strings,
// integers, enums) are exercised by the integration tests' invalid requests.
describe('readDate', () => {
  it('treats a bare date as UTC midnight and honours explicit offsets', () => {
    expect(collect((e) => readDate({ d: '2026-03-01' }, 'd', e)).value?.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(
      collect((e) => readDate({ d: '2026-03-01T00:00:00-03:00' }, 'd', e)).value?.toISOString(),
    ).toBe('2026-03-01T03:00:00.000Z');
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-03-01T10:00:00', // no offset: ambiguous time zone
    '2026-03-01T25:00:00Z',
    '01/03/2026',
    '1999-12-31',
  ])('rejects %j', (raw) => {
    expect(collect((e) => readDate({ d: raw }, 'd', e)).errors).toHaveLength(1);
  });
});

describe('readAmount', () => {
  it('normalises valid decimal amounts', () => {
    expect(collect((e) => readAmount({ a: '0010.5' }, 'a', e)).value).toBe('10.5');
    expect(collect((e) => readAmount({ a: ' 12.34 ' }, 'a', e)).value).toBe('12.34');
  });

  it.each(['-1', '1.234', '1,000', 'NaN', '1e3', '.5', '9999999999'])('rejects %j', (raw) => {
    expect(collect((e) => readAmount({ a: raw }, 'a', e)).errors).toHaveLength(1);
  });
});

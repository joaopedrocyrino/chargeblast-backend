import type { INestApplication } from '@nestjs/common';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CurrencyListResponse,
  PaymentDetailDto,
  PaymentDto,
  PaymentListResponse,
} from '../../src/payments/payments.types.js';
import { createTestApp, createTestPool } from './helpers.js';
import { TEST_ANCHOR } from './test-env.js';

type Agent = ReturnType<typeof request>;

let app: INestApplication;
let pool: pg.Pool;
let http: Agent;

async function list(query: Record<string, string> = {}): Promise<PaymentListResponse> {
  const response = await http.get('/api/v1/payments').query(query).expect(200);
  return response.body as PaymentListResponse;
}

async function sqlCount(where: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM payments p
     JOIN customers c ON c.id = p.customer_id
     JOIN payment_methods pm ON pm.id = p.payment_method_id ${where}`,
    params,
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  app = await createTestApp();
  pool = createTestPool();
  http = request(app.getHttpServer() as Parameters<typeof request>[0]);
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('GET /api/v1/health and /ready', () => {
  it('reports liveness and database readiness', async () => {
    expect((await http.get('/api/v1/health').expect(200)).body).toMatchObject({ status: 'ok' });
    expect((await http.get('/api/v1/ready').expect(200)).body).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });
  });
});

describe('GET /api/v1/payments', () => {
  it('returns the first 25 payments, newest first, with joined customer and method', async () => {
    const body = await list();
    expect(body.data).toHaveLength(25);
    expect(body.meta).toEqual({
      page: 1,
      limit: 25,
      total: 900,
      totalPages: 36,
      hasNextPage: true,
      hasPreviousPage: false,
      sort: 'created',
      direction: 'desc',
    });
    const dates = body.data.map((p) => p.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);

    const first = body.data[0] as PaymentDto;
    const { rows } = await pool.query<{ email: string; last4: string; type: string }>(
      `SELECT c.email, pm.last4, pm.type FROM payments p
       JOIN customers c ON c.id = p.customer_id
       JOIN payment_methods pm ON pm.id = p.payment_method_id WHERE p.id = $1`,
      [first.id],
    );
    expect(first.customer.email).toBe(rows[0]?.email);
    expect(first.paymentMethod.last4).toBe(rows[0]?.last4);
    expect(first.paymentMethod.type).toBe(rows[0]?.type);
    expect(Number.isInteger(first.amountMinor)).toBe(true);
  });

  describe('pagination', () => {
    it('pages through every record exactly once', async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 9; page++) {
        for (const payment of (await list({ limit: '100', page: String(page) })).data) {
          seen.add(payment.id);
        }
      }
      expect(seen.size).toBe(900);
    });

    it('returns a partial last page and an empty page past the end', async () => {
      const last = await list({ limit: '100', page: '9' });
      expect(last.data).toHaveLength(100);
      expect(last.meta.hasNextPage).toBe(false);
      const beyond = await list({ limit: '100', page: '10' });
      expect(beyond.data).toEqual([]);
      expect(beyond.meta.total).toBe(900);
    });

    it('is stable across pages even when created_at ties', async () => {
      const { rows } = await pool.query<{ created_at: Date; n: string }>(
        'SELECT created_at, count(*) AS n FROM payments GROUP BY 1 HAVING count(*) > 1',
      );
      expect(rows.length).toBeGreaterThan(0);
      const tie = rows[0]?.created_at.toISOString() ?? '';
      const body = await list({
        createdFrom: tie,
        createdTo: new Date(Date.parse(tie) + 1).toISOString(),
        limit: '1',
      });
      const ids: string[] = [];
      for (let page = 1; page <= body.meta.totalPages; page++) {
        const pageBody = await list({
          createdFrom: tie,
          createdTo: new Date(Date.parse(tie) + 1).toISOString(),
          limit: '1',
          page: String(page),
        });
        ids.push(pageBody.data[0]?.id ?? '');
      }
      expect(ids).toEqual([...ids].sort().reverse());
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('sorting', () => {
    it('sorts by amount within currency groups (currency A→Z, then amount)', async () => {
      const all: PaymentDto[] = [];
      for (let page = 1; page <= 9; page++) {
        all.push(
          ...(await list({ sort: 'amount', direction: 'desc', limit: '100', page: String(page) }))
            .data,
        );
      }
      for (let i = 1; i < all.length; i++) {
        const prev = all[i - 1] as PaymentDto;
        const cur = all[i] as PaymentDto;
        expect(prev.currency <= cur.currency).toBe(true);
        if (prev.currency === cur.currency)
          expect(prev.amountMinor).toBeGreaterThanOrEqual(cur.amountMinor);
      }
    });

    it('sorts by status using the documented lifecycle order', async () => {
      const rank = {
        pending: 0,
        uncaptured: 1,
        succeeded: 2,
        disputed: 3,
        refunded: 4,
        failed: 5,
      } as const;
      const all: PaymentDto[] = [];
      for (let page = 1; page <= 9; page++) {
        all.push(
          ...(await list({ sort: 'status', direction: 'asc', limit: '100', page: String(page) }))
            .data,
        );
      }
      const ranks = all.map((p) => rank[p.status]);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
      const desc = await list({ sort: 'status', direction: 'desc', limit: '5' });
      expect(desc.data.every((p) => p.status === 'failed')).toBe(true);
    });
  });

  describe('filters', () => {
    it('ORs values within one filter', async () => {
      const statuses = await list({ status: 'failed,refunded', limit: '100' });
      expect(statuses.meta.total).toBe(await sqlCount(`WHERE p.status IN ('failed', 'refunded')`));
      expect(statuses.data.every((p) => p.status === 'failed' || p.status === 'refunded')).toBe(
        true,
      );
      const methods = await list({ method: 'ach,wallet', limit: '100' });
      expect(methods.meta.total).toBe(await sqlCount(`WHERE pm.type IN ('ach', 'wallet')`));
      const currencies = await list({ currency: 'eur,JPY', limit: '100' });
      expect(currencies.meta.total).toBe(await sqlCount(`WHERE p.currency IN ('EUR', 'JPY')`));
      expect(currencies.data.every((p) => p.currency === 'EUR' || p.currency === 'JPY')).toBe(true);
      const brands = await list({ brand: 'amex,discover', limit: '100' });
      expect(brands.meta.total).toBe(await sqlCount(`WHERE pm.brand IN ('amex', 'discover')`));
      const declines = await list({ decline: 'expired_card,fraudulent', limit: '100' });
      expect(declines.meta.total).toBe(
        await sqlCount(`WHERE p.failure_code IN ('expired_card', 'fraudulent')`),
      );
    });

    it('ANDs different filter categories', async () => {
      const body = await list({
        status: 'succeeded',
        method: 'card',
        amountMin: '100',
        limit: '100',
      });
      const expected = await sqlCount(
        `JOIN currencies cur ON cur.code = p.currency
         WHERE p.status = 'succeeded' AND pm.type = 'card' AND p.amount_minor >= 100 * power(10, cur.exponent)`,
      );
      expect(body.meta.total).toBe(expected);
      expect(expected).toBeGreaterThan(0);
    });

    it('filters by created date range (inclusive start, exclusive end)', async () => {
      const createdFrom = new Date(TEST_ANCHOR.getTime() - 7 * 86_400_000).toISOString();
      const createdTo = TEST_ANCHOR.toISOString();
      const body = await list({ createdFrom, createdTo, limit: '100' });
      expect(body.meta.total).toBe(
        await sqlCount('WHERE p.created_at >= $1 AND p.created_at < $2', [createdFrom, createdTo]),
      );
      expect(body.data.every((p) => p.createdAt >= createdFrom && p.createdAt < createdTo)).toBe(
        true,
      );
    });

    it('filters by refunded date, matching only refunded payments', async () => {
      const refundedFrom = new Date(TEST_ANCHOR.getTime() - 30 * 86_400_000).toISOString();
      const body = await list({ refundedFrom, limit: '100' });
      expect(body.meta.total).toBe(await sqlCount('WHERE p.refunded_at >= $1', [refundedFrom]));
      expect(body.meta.total).toBeGreaterThan(0);
      expect(body.data.every((p) => p.status === 'refunded')).toBe(true);
    });

    it('applies amount bounds in major units of each currency (JPY has no decimals)', async () => {
      const body = await list({ amountMin: '100', amountMax: '100', limit: '100' });
      for (const p of body.data) expect(p.amountMinor / 10 ** p.currencyExponent).toBe(100);
      expect(body.data.some((p) => p.currency === 'EUR')).toBe(true);
      const jpy = await list({ amountMin: '1000', amountMax: '5000', limit: '100' });
      for (const p of jpy.data.filter((x) => x.currency === 'JPY')) {
        expect(p.amountMinor).toBeGreaterThanOrEqual(1000);
        expect(p.amountMinor).toBeLessThanOrEqual(5000);
      }
    });
  });

  describe('search', () => {
    it('matches a payment id substring (case-insensitively) and customer email', async () => {
      const target = (await list({ limit: '1', page: '7' })).data[0] as PaymentDto;
      const byId = await list({ search: target.id.slice(5, 15).toUpperCase() });
      expect(byId.data.map((p) => p.id)).toContain(target.id);
      const byEmail = await list({ search: target.customer.email, limit: '100' });
      expect(byEmail.data.every((p) => p.customer.email === target.customer.email)).toBe(true);
    });

    it('matches the exact last four digits of the payment method', async () => {
      const body = await list({ search: '4242', limit: '100' });
      expect(body.meta.total).toBe(
        await sqlCount(
          `WHERE pm.last4 = '4242' OR lower(p.id) LIKE '%4242%' OR lower(c.email) LIKE '%4242%'`,
        ),
      );
      expect(body.data.some((p) => p.paymentMethod.last4 === '4242')).toBe(true);
    });

    it('treats LIKE wildcards literally', async () => {
      expect((await list({ search: '%' })).meta.total).toBe(0);
      // Every id literally contains "pi_", but "p_" only matches if "_" were a wildcard.
      expect((await list({ search: 'pi_' })).meta.total).toBe(900);
      expect((await list({ search: 'p_' })).meta.total).toBe(0);
    });
  });

  describe('invalid requests', () => {
    it.each([
      [{ limit: '101' }, 'limit'],
      [{ createdFrom: 'yesterday' }, 'createdFrom'],
      [{ amountMin: '10', amountMax: '5' }, 'amountMax'],
      [{ currency: 'dollars' }, 'currency'],
      [{ brand: 'visa,acme' }, 'brand'],
      [{ unexpected: '1' }, 'unexpected'],
    ])('rejects %j with a 400 naming %s', async (query, field) => {
      const response = await http.get('/api/v1/payments').query(query).expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
      expect(
        (response.body as { details: { field: string }[] }).details.map((d) => d.field),
      ).toContain(field);
    });

    it('rejects repeated scalar parameters', async () => {
      await http.get('/api/v1/payments?page=1&page=2').expect(400);
    });

    it('returns a structured 404 for unknown routes', async () => {
      const response = await http.get('/api/v1/nope').expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('GET /api/v1/payments/:id', () => {
  it('returns the payment with customer, method and a derived timeline', async () => {
    const target = (await list({ status: 'refunded', limit: '1' })).data[0] as PaymentDto;
    const response = await http.get(`/api/v1/payments/${target.id}`).expect(200);
    const detail = response.body as PaymentDetailDto;
    expect(detail).toMatchObject({
      id: target.id,
      customer: target.customer,
      paymentMethod: target.paymentMethod,
    });
    expect(detail.customer.createdAt).toMatch(/^\d{4}-/);
    expect(detail.events.map((e) => e.type)).toEqual([
      'charge.refunded',
      'payment.succeeded',
      'payment.created',
    ]);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    await http.get('/api/v1/payments/pi_000000000000000000000000').expect(404);
    await http.get('/api/v1/payments/not-a-payment').expect(400);
  });
});

describe('GET /api/v1/payments/currencies', () => {
  it('lists every currency used across all payments, not just one page', async () => {
    const response = await http.get('/api/v1/payments/currencies').expect(200);
    const { rows } = await pool.query<{ currency: string }>(
      'SELECT DISTINCT currency FROM payments ORDER BY currency',
    );
    const body = response.body as CurrencyListResponse;
    expect(body.data.map((c) => c.code)).toEqual(rows.map((r) => r.currency));
    expect(body.data.find((c) => c.code === 'JPY')).toEqual({
      code: 'JPY',
      name: 'Japanese Yen',
      exponent: 0,
    });
  });
});

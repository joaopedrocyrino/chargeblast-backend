import type { INestApplication } from '@nestjs/common';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  PaymentCapacityResponse,
  PaymentDetailDto,
} from '../../src/payments/payments.types.js';
import { createTestApp, createTestPool } from './helpers.js';

type Agent = ReturnType<typeof request>;

const EMAIL_DOMAIN = 'create-payment.test';
const nextYear = new Date().getUTCFullYear() + 1;

const body = {
  amount: '49.99',
  currency: 'USD',
  status: 'succeeded',
  description: 'Integration test',
  customerEmail: `new@${EMAIL_DOMAIN}`,
  customerName: 'New Customer',
  method: 'card',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: nextYear,
};

let app: INestApplication;
let pool: pg.Pool;
let http: Agent;
let seededTotal: number;

async function cleanUp(): Promise<void> {
  const owned = `SELECT id FROM customers WHERE email LIKE '%@${EMAIL_DOMAIN}'`;
  await pool.query(`DELETE FROM payments WHERE customer_id IN (${owned})`);
  await pool.query(`DELETE FROM payment_methods WHERE customer_id IN (${owned})`);
  await pool.query(`DELETE FROM customers WHERE email LIKE '%@${EMAIL_DOMAIN}'`);
}

async function paymentCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM payments');
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  pool = createTestPool();
  await cleanUp();
  seededTotal = await paymentCount();
  // Room for exactly three more payments, so the cap is reachable in a test.
  app = await createTestApp({ PAYMENT_CREATE_LIMIT: String(seededTotal + 3) });
  http = request(app.getHttpServer() as Parameters<typeof request>[0]);
});

afterAll(async () => {
  // Other spec files assert exact seeded counts.
  await cleanUp();
  await pool.end();
  await app.close();
});

describe('POST /api/v1/payments', () => {
  it('creates a card payment with a new customer and returns its details', async () => {
    const response = await http.post('/api/v1/payments').send(body).expect(201);
    const payment = response.body as PaymentDetailDto;
    expect(payment).toMatchObject({
      amountMinor: 4999,
      currency: 'USD',
      status: 'succeeded',
      description: 'Integration test',
      failureCode: null,
      customer: { name: 'New Customer', email: `new@${EMAIL_DOMAIN}` },
      paymentMethod: {
        type: 'card',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: nextYear,
      },
    });
    expect(payment.id).toMatch(/^pi_[A-Za-z0-9]{24}$/);
    await http.get(`/api/v1/payments/${payment.id}`).expect(200);
  });

  it('reuses the customer with the same email and fills in failure details', async () => {
    const response = await http
      .post('/api/v1/payments')
      .send({
        amount: '1200',
        currency: 'JPY',
        status: 'failed',
        customerEmail: `NEW@${EMAIL_DOMAIN}`,
        method: 'ach',
        bankName: 'Chase',
        last4: '6789',
      })
      .expect(201);
    const payment = response.body as PaymentDetailDto;
    expect(payment).toMatchObject({
      amountMinor: 1200,
      currencyExponent: 0,
      status: 'failed',
      failureCode: 'insufficient_funds',
      customer: { email: `new@${EMAIL_DOMAIN}`, name: 'New Customer' },
      paymentMethod: { type: 'ach', bankName: 'Chase', brand: null, expMonth: null },
    });
  });

  it('rejects invalid input with field errors and writes nothing', async () => {
    const before = await paymentCount();
    const response = await http
      .post('/api/v1/payments')
      .send({ ...body, amount: '1.5', currency: 'JPY' })
      .expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'amount', message: "JPY amounts can't have decimals" }],
    });
    await http
      .post('/api/v1/payments')
      .send({ ...body, currency: 'XYZ' })
      .expect(400);
    expect(await paymentCount()).toBe(before);
  });

  it('rejects oversized bodies', async () => {
    await http
      .post('/api/v1/payments')
      .send({ ...body, description: 'x'.repeat(20_000) })
      .expect(413);
  });

  it('refuses new payments once the limit is reached, even when sent concurrently', async () => {
    const before = await http.get('/api/v1/payments/capacity').expect(200);
    expect(before.body).toEqual({
      total: seededTotal + 2,
      limit: seededTotal + 3,
      remaining: 1,
      canCreate: true,
    } satisfies PaymentCapacityResponse);

    const responses = await Promise.all(
      [1, 2, 3].map((n) =>
        http.post('/api/v1/payments').send({ ...body, customerEmail: `race${n}@${EMAIL_DOMAIN}` }),
      ),
    );
    const statuses = responses.map((r) => r.status).sort();
    // One slot was left after the two creates above.
    expect(statuses).toEqual([201, 409, 409]);
    expect(responses.find((r) => r.status === 409)?.body).toMatchObject({
      code: 'PAYMENT_LIMIT_REACHED',
    });
    expect(await paymentCount()).toBe(seededTotal + 3);

    const capacity = await http.get('/api/v1/payments/capacity').expect(200);
    expect(capacity.body).toMatchObject({ remaining: 0, canCreate: false });
  });
});

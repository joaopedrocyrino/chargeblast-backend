import { SeededRandom } from './random.js';

/**
 * Deterministic demo dataset. Identifiers, names, amounts, statuses and
 * relative timestamps are fully determined by SEED; only the `anchor`
 * (normally "now") shifts the absolute dates so "Today"/"Last 7 days"
 * filters always have data right after seeding.
 */
const SEED = 0x5eed_c4a2;
export const CUSTOMER_COUNT = 160;
export const PAYMENT_COUNT = 900;

export type SeedPaymentStatus =
  'succeeded' | 'pending' | 'failed' | 'refunded' | 'disputed' | 'uncaptured';
export type SeedMethodType = 'card' | 'ach' | 'wallet';

export interface SeedCustomer {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
}

export interface SeedPaymentMethod {
  id: string;
  customerId: string;
  type: SeedMethodType;
  brand: string | null;
  last4: string;
  wallet: string | null;
  bankName: string | null;
  expMonth: number | null;
  expYear: number | null;
  createdAt: Date;
}

export interface SeedPayment {
  id: string;
  customerId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: string;
  status: SeedPaymentStatus;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeedDataset {
  customers: SeedCustomer[];
  paymentMethods: SeedPaymentMethod[];
  payments: SeedPayment[];
}

const FIRST_NAMES = [
  'Olivia',
  'Liam',
  'Emma',
  'Noah',
  'Ava',
  'Elijah',
  'Sophia',
  'Mateo',
  'Isabella',
  'Lucas',
  'Mia',
  'Amelia',
  'Ethan',
  'Harper',
  'James',
  'Evelyn',
  'Benjamin',
  'Aria',
  'Henry',
  'Chloe',
  'Hiroshi',
  'Yuki',
  'Priya',
  'Arjun',
  'Fatima',
  'Omar',
  'Chen',
  'Mei',
  'Lars',
  'Ingrid',
  'José',
  'Zoë',
  'Søren',
  'Chiara',
  'Kwame',
  'Amara',
  'Diego',
  'Lucía',
  'Felix',
  'Hannah',
];
const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Tanaka',
  'Sato',
  'Patel',
  'Sharma',
  'Haddad',
  'Wang',
  'Nielsen',
  'Okafor',
  'Rossi',
  'Müller',
  "O'Brien",
  'da Silva',
  'Fernández',
  'Kowalski',
  'Nguyen',
  'Kim',
];
const EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'acme.co',
  'example.com',
  'northwind.io',
  'globex.com',
  'initech.dev',
];
const CARD_BRANDS: readonly (readonly [string, number])[] = [
  ['visa', 45],
  ['mastercard', 30],
  ['amex', 12],
  ['discover', 6],
  ['jcb', 3],
  ['unionpay', 2],
  ['diners', 2],
];
const BANKS = [
  'STRIPE TEST BANK',
  'Chase',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'US Bank',
];
const WALLETS: readonly (readonly [string, number])[] = [
  ['apple_pay', 55],
  ['google_pay', 35],
  ['link', 10],
];
const CURRENCIES: readonly (readonly [string, number])[] = [
  ['USD', 70],
  ['EUR', 10],
  ['GBP', 7],
  ['CAD', 5],
  ['AUD', 3],
  ['BRL', 3],
  ['JPY', 2],
];
const DESCRIPTIONS = [
  'Subscription creation',
  'Subscription update',
  'Payment for Invoice',
  'Pro plan (monthly)',
  'Team plan (annual)',
  'Order #{n}',
  'Usage-based billing',
  'Add-on: extra seats',
  null,
  null,
];
const FAILURES: readonly (readonly [string, string])[] = [
  ['card_declined', 'The card was declined.'],
  ['insufficient_funds', 'The card has insufficient funds to complete the purchase.'],
  ['expired_card', 'The card has expired.'],
  ['incorrect_cvc', "The card's security code is incorrect."],
  ['processing_error', 'An error occurred while processing the card.'],
  ['fraudulent', 'The payment was blocked because it was flagged as potentially fraudulent.'],
  ['do_not_honor', 'The card was declined for an unknown reason.'],
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function randomAmountMinor(rng: SeededRandom, currency: string): number {
  if (currency === 'JPY') {
    return rng.weighted<number>([
      [rng.int(5, 50) * 100, 60],
      [rng.int(50, 500) * 100, 35],
      [rng.int(500, 3000) * 100, 5],
    ]);
  }
  const tier = rng.weighted<'small' | 'medium' | 'large' | 'huge'>([
    ['small', 60],
    ['medium', 28],
    ['large', 10],
    ['huge', 2],
  ]);
  const major =
    tier === 'small'
      ? rng.int(1, 199)
      : tier === 'medium'
        ? rng.int(200, 1_999)
        : tier === 'large'
          ? rng.int(2_000, 19_999)
          : rng.int(20_000, 99_999);
  // Real prices cluster on .00 / .99 / .50 endings.
  const cents = rng.weighted<number>([
    [0, 45],
    [99, 25],
    [50, 10],
    [rng.int(1, 98), 20],
  ]);
  return Math.max(50, major * 100 + cents);
}

/** Skews towards recent dates; ~6% of payments land within the last 24h. */
function randomAgeMs(rng: SeededRandom): number {
  const bucket = rng.weighted<'today' | 'week' | 'month' | 'quarter' | 'older'>([
    ['today', 6],
    ['week', 14],
    ['month', 22],
    ['quarter', 28],
    ['older', 30],
  ]);
  switch (bucket) {
    case 'today':
      return rng.int(5 * MINUTE, 20 * HOUR);
    case 'week':
      return rng.int(1 * DAY, 7 * DAY);
    case 'month':
      return rng.int(7 * DAY, 30 * DAY);
    case 'quarter':
      return rng.int(30 * DAY, 120 * DAY);
    case 'older':
      return rng.int(120 * DAY, 540 * DAY);
  }
}

export function generateSeedData(anchor: Date): SeedDataset {
  const rng = new SeededRandom(SEED);
  const anchorMs = Math.floor(anchor.getTime() / 1000) * 1000;
  const customers: SeedCustomer[] = [];
  const paymentMethods: SeedPaymentMethod[] = [];
  const methodsByCustomer = new Map<string, SeedPaymentMethod[]>();
  const usedEmails = new Set<string>();

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    // A few customers are known only by email, like guest checkouts.
    const name = rng.chance(0.08) ? null : `${first} ${last}`;
    let local = rng.chance(0.5)
      ? `${slug(first)}.${slug(last)}`
      : `${slug(first)[0] ?? 'x'}${slug(last)}`;
    if (rng.chance(0.1)) local += `+${rng.pick(['billing', 'stripe', 'work'])}`;
    let email = `${local}@${rng.pick(EMAIL_DOMAINS)}`;
    for (let n = 2; usedEmails.has(email); n++)
      email = `${local}${n}@${email.split('@')[1] ?? 'example.com'}`;
    usedEmails.add(email);

    const customer: SeedCustomer = {
      id: `cus_${rng.id(14)}`,
      name,
      email,
      createdAt: new Date(anchorMs - 560 * DAY - rng.int(0, 200) * DAY),
    };
    customers.push(customer);

    const methodCount = rng.weighted<number>([
      [1, 65],
      [2, 28],
      [3, 7],
    ]);
    const methods: SeedPaymentMethod[] = [];
    for (let m = 0; m < methodCount; m++) {
      const type = rng.weighted<SeedMethodType>([
        ['card', 70],
        ['ach', 14],
        ['wallet', 16],
      ]);
      const isAch = type === 'ach';
      const method: SeedPaymentMethod = {
        id: `pm_${rng.id(24)}`,
        customerId: customer.id,
        type,
        brand: isAch ? null : rng.weighted(CARD_BRANDS),
        last4: rng.chance(0.06) ? '4242' : String(rng.int(0, 9999)).padStart(4, '0'),
        wallet: type === 'wallet' ? rng.weighted(WALLETS) : null,
        bankName: isAch ? rng.pick(BANKS) : null,
        expMonth: isAch ? null : rng.int(1, 12),
        expYear: isAch ? null : rng.int(2026, 2032),
        createdAt: customer.createdAt,
      };
      methods.push(method);
      paymentMethods.push(method);
    }
    methodsByCustomer.set(customer.id, methods);
  }

  const payments: SeedPayment[] = [];
  for (let i = 0; i < PAYMENT_COUNT; i++) {
    const customer = rng.pick(customers);
    const method = rng.pick(methodsByCustomer.get(customer.id) ?? []);
    const currency = rng.weighted(CURRENCIES);
    // ACH settles slowly, so it is pending far more often than cards; only
    // cards (and wallets, which tokenise one) can be authorised and captured later.
    const status = rng.weighted<SeedPaymentStatus>(
      method.type === 'ach'
        ? [
            ['succeeded', 58],
            ['pending', 28],
            ['failed', 6],
            ['refunded', 6],
            ['disputed', 2],
          ]
        : [
            ['succeeded', 69],
            ['pending', 2],
            ['uncaptured', 4],
            ['failed', 15],
            ['refunded', 8],
            ['disputed', 2],
          ],
    );
    const createdAt = new Date(anchorMs - randomAgeMs(rng));
    const failure = status === 'failed' ? rng.pick(FAILURES) : null;
    const refundedAt =
      status === 'refunded'
        ? new Date(Math.min(anchorMs, createdAt.getTime() + rng.int(1 * HOUR, 14 * DAY)))
        : null;
    const settleMs = status === 'pending' ? 0 : rng.int(2_000, 90_000);
    // A dispute arrives well after the charge (minutes to hours here); derived
    // from settleMs so the random sequence, and so every id, stays the same.
    const updatedMs = status === 'disputed' ? settleMs * 100 : settleMs;
    const updatedAt = refundedAt ?? new Date(Math.min(anchorMs, createdAt.getTime() + updatedMs));
    const template = rng.pick(DESCRIPTIONS);

    payments.push({
      id: `pi_${rng.id(24)}`,
      customerId: customer.id,
      paymentMethodId: method.id,
      amountMinor: randomAmountMinor(rng, currency),
      currency,
      status,
      description: template?.replace('{n}', String(rng.int(1000, 99999))) ?? null,
      failureCode: failure?.[0] ?? null,
      failureMessage: failure?.[1] ?? null,
      refundedAt,
      createdAt,
      updatedAt,
    });
  }

  addEdgeCases(payments, anchorMs);
  return { customers, paymentMethods, payments };
}

/**
 * Deliberate edge cases for sorting/pagination/filter tests:
 *  - several payments sharing one exact created_at (tie-break by id)
 *  - identical amounts in different currencies
 *  - minimum and maximum realistic amounts
 */
function addEdgeCases(payments: SeedPayment[], anchorMs: number): void {
  const sharedTimestamp = new Date(anchorMs - 3 * DAY);
  for (const payment of payments.slice(0, 4)) {
    payment.createdAt = sharedTimestamp;
    payment.updatedAt = sharedTimestamp;
    if (payment.refundedAt) payment.refundedAt = new Date(sharedTimestamp.getTime() + HOUR);
  }
  const [a, b, c, d] = payments.slice(10, 14);
  if (a && b && a.currency !== 'JPY' && b.currency !== 'JPY') {
    a.amountMinor = 10_000;
    b.amountMinor = 10_000;
    a.currency = 'USD';
    b.currency = 'EUR';
  }
  if (c) {
    c.amountMinor = 50;
    c.currency = 'USD';
  }
  if (d) {
    d.amountMinor = 9_999_999;
    d.currency = 'USD';
  }
}

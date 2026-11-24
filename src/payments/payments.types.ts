export const PAYMENT_STATUSES = [
  'succeeded',
  'pending',
  'failed',
  'refunded',
  'disputed',
  'uncaptured',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHOD_TYPES = ['card', 'ach', 'wallet'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

/** Statuses a new payment may be created with (a refund needs an existing payment). */
export const CREATABLE_STATUSES = ['succeeded', 'pending', 'failed'] as const;
export type CreatablePaymentStatus = (typeof CREATABLE_STATUSES)[number];

export const CARD_BRANDS = [
  'visa',
  'mastercard',
  'amex',
  'discover',
  'jcb',
  'unionpay',
  'diners',
] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const WALLETS = ['apple_pay', 'google_pay', 'link'] as const;

/** Decline codes a failed payment can carry (seed data and created payments). */
export const DECLINE_CODES = [
  'card_declined',
  'insufficient_funds',
  'expired_card',
  'incorrect_cvc',
  'processing_error',
  'fraudulent',
  'do_not_honor',
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];
export type Wallet = (typeof WALLETS)[number];

export const SORT_FIELDS = ['created', 'amount', 'status'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * Explicit status ordering used when sorting by status (ascending order).
 * Follows the payment lifecycle: in-flight, settled, reversed, then failed.
 */
export const STATUS_SORT_ORDER: readonly PaymentStatus[] = [
  'pending',
  'uncaptured',
  'succeeded',
  'disputed',
  'refunded',
  'failed',
];

export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 25;
export const SEARCH_MAX_LENGTH = 100;

/** Validated, normalised filters shared by the list and summary endpoints. */
export interface PaymentFilters {
  readonly search?: string;
  readonly statuses: readonly PaymentStatus[];
  readonly methods: readonly PaymentMethodType[];
  /** ISO-4217 codes; unknown codes simply match nothing. */
  readonly currencies: readonly string[];
  /** Card brand, for cards and wallets (ACH has none). */
  readonly brands: readonly CardBrand[];
  readonly declineCodes: readonly DeclineCode[];
  /** Inclusive lower / exclusive upper bound on refunded_at. */
  readonly refundedFrom?: Date;
  readonly refundedTo?: Date;
  /** Inclusive lower bound on created_at. */
  readonly createdFrom?: Date;
  /** Exclusive upper bound on created_at. */
  readonly createdTo?: Date;
  /** Inclusive bounds in MAJOR units of each payment's own currency (decimal strings). */
  readonly amountMin?: string;
  readonly amountMax?: string;
}

export interface ListPaymentsQuery extends PaymentFilters {
  readonly page: number;
  readonly limit: number;
  readonly sort: SortField;
  readonly direction: SortDirection;
}

export interface PaymentMethodDto {
  readonly id: string;
  readonly type: PaymentMethodType;
  readonly brand: string | null;
  readonly last4: string;
  readonly wallet: string | null;
  readonly bankName: string | null;
  readonly expMonth: number | null;
  readonly expYear: number | null;
}

export interface CustomerDto {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
}

export interface PaymentDto {
  readonly id: string;
  /** Integer amount in the currency's minor unit. */
  readonly amountMinor: number;
  readonly currency: string;
  /** Number of decimal places of the currency (2 for USD, 0 for JPY). */
  readonly currencyExponent: number;
  readonly status: PaymentStatus;
  readonly description: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly refundedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly customer: CustomerDto;
  readonly paymentMethod: PaymentMethodDto;
}

export interface PaymentEventDto {
  readonly type:
    | 'payment.created'
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.pending'
    | 'payment.uncaptured'
    | 'charge.dispute.created'
    | 'charge.refunded';
  readonly title: string;
  readonly occurredAt: string;
}

export interface PaymentDetailDto extends PaymentDto {
  readonly customer: CustomerDto & { readonly createdAt: string };
  readonly events: readonly PaymentEventDto[];
}

export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  readonly sort: SortField;
  readonly direction: SortDirection;
}

export interface PaymentListResponse {
  readonly data: readonly PaymentDto[];
  readonly meta: PaginationMeta;
}

/** Validated `POST /payments` body. `amount` is in MAJOR units, as typed by a person. */
export interface CreatePaymentInput {
  readonly amount: string;
  readonly currency: string;
  readonly status: CreatablePaymentStatus;
  readonly description: string | null;
  readonly customerEmail: string;
  readonly customerName: string | null;
  readonly paymentMethod:
    | {
        readonly type: 'card';
        readonly brand: CardBrand;
        readonly last4: string;
        readonly expMonth: number;
        readonly expYear: number;
      }
    | {
        readonly type: 'wallet';
        readonly wallet: Wallet;
        readonly brand: CardBrand;
        readonly last4: string;
        readonly expMonth: number;
        readonly expYear: number;
      }
    | { readonly type: 'ach'; readonly bankName: string; readonly last4: string };
}

/** Whether `POST /payments` currently accepts new rows. */
export interface PaymentCapacityResponse {
  readonly total: number;
  readonly limit: number;
  readonly remaining: number;
  readonly canCreate: boolean;
}

export interface CurrencyDto {
  readonly code: string;
  readonly name: string;
  readonly exponent: number;
}

/** Every currency used by at least one payment, across the whole table. */
export interface CurrencyListResponse {
  readonly data: readonly CurrencyDto[];
}

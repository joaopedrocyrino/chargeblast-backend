import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { NotFoundApiException } from '../common/errors/api-error.js';
import { derivePaymentEvents } from './payment-events.js';
import { PaymentsRepository, type PaymentRecord } from './payments.repository.js';
import { computePageWindow } from './payments.sql.js';
import type {
  CreatePaymentInput,
  CurrencyListResponse,
  ListPaymentsQuery,
  PaymentCapacityResponse,
  PaymentDetailDto,
  PaymentDto,
  PaymentListResponse,
} from './payments.types.js';

function toDto({ customerCreatedAt: _ignored, ...dto }: PaymentRecord): PaymentDto {
  return dto;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PaymentsRepository) private readonly repository: PaymentsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(query: ListPaymentsQuery): Promise<PaymentListResponse> {
    const total = await this.repository.count(query);
    const { offset, totalPages } = computePageWindow(query.page, query.limit, total);
    // Pages past the end return an empty page with accurate metadata rather
    // than an error, so a stale bookmarked URL still renders.
    const records = offset < total ? await this.repository.findPage(query, offset) : [];
    return {
      data: records.map(toDto),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1 && total > 0,
        sort: query.sort,
        direction: query.direction,
      },
    };
  }

  async getById(id: string): Promise<PaymentDetailDto> {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundApiException(`Payment ${id} was not found`);
    const dto = toDto(record);
    return {
      ...dto,
      customer: { ...dto.customer, createdAt: record.customerCreatedAt },
      events: derivePaymentEvents(dto),
    };
  }

  async currencies(): Promise<CurrencyListResponse> {
    return { data: await this.repository.listUsedCurrencies() };
  }

  async capacity(): Promise<PaymentCapacityResponse> {
    const total = await this.repository.countAll();
    const limit = this.config.paymentCreateLimit;
    const remaining = Math.max(limit - total, 0);
    return { total, limit, remaining, canCreate: remaining > 0 };
  }

  async create(input: CreatePaymentInput): Promise<PaymentDetailDto> {
    const id = await this.repository.create(input, this.config.paymentCreateLimit);
    return this.getById(id);
  }
}

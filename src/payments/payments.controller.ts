import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import type {
  CurrencyListResponse,
  PaymentCapacityResponse,
  PaymentDetailDto,
  PaymentListResponse,
} from './payments.types.js';
import { parseListPaymentsQuery, parsePaymentId } from './validation/list-payments-query.js';
import { parseCreatePaymentBody } from './validation/create-payment-body.js';
import type { RawQuery } from './validation/query-parsers.js';

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get()
  list(@Query() raw: RawQuery): Promise<PaymentListResponse> {
    return this.payments.list(parseListPaymentsQuery(raw));
  }

  /** Currency filter options: every currency present in the data, not just one page. */
  @Get('currencies')
  currencies(): Promise<CurrencyListResponse> {
    return this.payments.currencies();
  }

  /** Whether new payments can still be created (the table is capped). */
  @Get('capacity')
  capacity(): Promise<PaymentCapacityResponse> {
    return this.payments.capacity();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown): Promise<PaymentDetailDto> {
    return this.payments.create(parseCreatePaymentBody(body));
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<PaymentDetailDto> {
    return this.payments.getById(parsePaymentId(id));
  }
}

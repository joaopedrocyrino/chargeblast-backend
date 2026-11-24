import { HttpException, HttpStatus } from '@nestjs/common';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** Uniform error body returned by every failing endpoint. */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly FieldError[];
  readonly path: string;
  readonly timestamp: string;
}

export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: readonly FieldError[],
  ) {
    super(message, status);
  }
}

export class RequestValidationException extends ApiException {
  constructor(details: readonly FieldError[]) {
    super(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Request validation failed', details);
  }
}

export class NotFoundApiException extends ApiException {
  constructor(message: string) {
    super(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
  }
}

export class ConflictApiException extends ApiException {
  constructor(code: string, message: string) {
    super(HttpStatus.CONFLICT, code, message);
  }
}

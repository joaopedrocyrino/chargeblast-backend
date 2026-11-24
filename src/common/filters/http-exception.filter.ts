import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException, type ApiErrorBody } from '../errors/api-error.js';

const DEFAULT_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Converts every thrown error into the ApiErrorBody shape. Unknown errors are
 * logged and returned as a generic 500 so internals (SQL, stack traces) never
 * leak to clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const base = {
      path: request.originalUrl.split('?')[0] ?? '',
      timestamp: new Date().toISOString(),
    };

    let body: ApiErrorBody;
    if (exception instanceof ApiException) {
      body = {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
        ...base,
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      body = {
        statusCode: status,
        code: DEFAULT_CODES[status] ?? 'HTTP_ERROR',
        message: exception.message,
        ...base,
      };
    } else {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        ...base,
      };
    }
    response.status(body.statusCode).json(body);
  }
}

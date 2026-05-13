import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorCode, ApiErrorResponse } from '../types/api-response.types';

// Catches every HttpException (and everything else that falls through Nest's
// other filters) and emits the canonical error envelope. The HTTP status is
// preserved on the response itself; the body carries the semantic code,
// human-readable message, and field-level details for validation errors.
//
// Registered as the catch-all (no specific exception type passed to @Catch),
// so it must come LAST in main.ts's useGlobalFilters argument list — more
// specific filters (PrismaExceptionFilter) get first shot.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // Request context shown only in logs (never in the response body) so ops
    // can pinpoint which endpoint failed without correlating timestamps with
    // access logs by hand.
    const route = `${request.method} ${request.originalUrl}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'Internal server error';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      ({ code, message, details } = mapHttpException(exception, status));
    } else if (exception instanceof Error) {
      // Unhandled non-HTTP error — log the full thing for ops, but don't leak
      // the stack or internals to the client.
      this.logger.error(
        `Unhandled exception on ${route}: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `Unhandled non-Error exception on ${route}: ${String(exception)}`,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      error: { code, message, ...(details && { details }) },
    };

    response.status(status).json(body);
  }
}

function mapHttpException(
  exception: HttpException,
  status: number,
): { code: ApiErrorCode; message: string; details?: string[] } {
  const responseBody = exception.getResponse();
  const fallbackMessage = exception.message;

  // class-validator's BadRequestException puts the validation errors in
  // `response.message` as a string[]. Extract them as `details` and use a
  // generic top-level message so clients can render the list separately.
  if (
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'message' in responseBody
  ) {
    const raw = responseBody.message;
    if (
      Array.isArray(raw) &&
      raw.every((m): m is string => typeof m === 'string')
    ) {
      return {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: raw,
      };
    }
    if (typeof raw === 'string') {
      return {
        code: statusToCode(status),
        message: raw,
      };
    }
  }

  return {
    code: statusToCode(status),
    message: fallbackMessage,
  };
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiErrorCode, ApiErrorResponse } from '../types/api-response.types';

// Maps Prisma's runtime errors into the canonical error envelope so callers
// see semantic codes (CONFLICT, NOT_FOUND, INVALID_REFERENCE) instead of
// leaked Prisma codes (P2002, P2025, ...). Reduces information disclosure
// and keeps the client error-handling contract stable even if we swap ORMs.
//
// Registered BEFORE the generic HttpExceptionFilter in main.ts so Prisma
// errors are intercepted at the right semantic layer.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, code, message } = mapPrismaError(exception);

    if (status >= 500) {
      // Server-side failures (unmapped Prisma codes) include the original code
      // in the log for debugging, but never in the response body.
      this.logger.error(
        `Unmapped Prisma error ${exception.code}: ${exception.message}`,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      error: { code, message },
    };

    response.status(status).json(body);
  }
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: ApiErrorCode;
  message: string;
} {
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation — the target field can be inferred from
      // error.meta.target, but exposing field names invites enumeration on
      // login flows. Keep the message generic.
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'Resource already exists',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Resource not found',
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REFERENCE',
        message: 'Referenced resource does not exist',
      };
    case 'P2014':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REFERENCE',
        message: 'The change would violate a required relation',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
        message: 'A database error occurred',
      };
  }
}

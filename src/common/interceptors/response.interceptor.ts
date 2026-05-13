import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccessResponse, Paginated } from '../types/api-response.types';

// Wraps every successful controller return in the canonical success envelope.
//
// Detection rules:
//   - undefined / void  → leave alone (used for 204 No Content endpoints)
//   - { data, meta }    → already paginated shape; merge with success+timestamp
//   - anything else     → wrap as { data: <value> }
//
// Errors are NOT handled here — they short-circuit the observable and are
// caught by the global exception filters.
@Injectable()
export class ResponseInterceptor<TData = unknown> implements NestInterceptor<
  TData,
  ApiSuccessResponse<TData> | undefined
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<TData>,
  ): Observable<ApiSuccessResponse<TData> | undefined> {
    return next.handle().pipe(
      map((value) => {
        // 204 No Content / void — keep body empty so the HTTP status carries
        // the semantic by itself.
        if (value === undefined) return undefined;

        const timestamp = new Date().toISOString();

        if (isPaginated(value)) {
          return {
            success: true,
            timestamp,
            data: value.data as TData,
            meta: value.meta,
          };
        }

        return {
          success: true,
          timestamp,
          data: value,
        };
      }),
    );
  }
}

function isPaginated(value: unknown): value is Paginated<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    Array.isArray((value as Paginated<unknown>).data)
  );
}

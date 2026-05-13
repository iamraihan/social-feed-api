// Shared response shapes for the entire API. The ResponseInterceptor and
// exception filters both emit values matching these types so every response
// — success or error, anywhere in the app — has the same outer structure.

// String error codes are decoupled from HTTP status numbers so clients can
// branch on semantic codes (e.g., distinguishing CONFLICT from VALIDATION_FAILED
// without hard-coding 409 vs 400). HTTP status is still carried by the response
// itself; this is what goes in the body.
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_ENTITY'
  | 'TOO_MANY_REQUESTS'
  | 'INVALID_REFERENCE'
  | 'DATABASE_ERROR'
  | 'INTERNAL_SERVER_ERROR';

// Returned for any successful response. `meta` is only present when the route
// returned a paginated list (the service explicitly produced { data, meta }).
export interface ApiSuccessResponse<TData = unknown, TMeta = unknown> {
  success: true;
  timestamp: string;
  data: TData;
  meta?: TMeta;
}

// Returned for any error. `details` carries field-level breakdown for
// validation errors; null for everything else.
export interface ApiErrorResponse {
  success: false;
  timestamp: string;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: string[];
  };
}

// Convenience type for services that produce paginated lists. Returning this
// shape from a service method tells the ResponseInterceptor to surface both
// `data` and `meta` in the envelope, rather than nesting the whole object
// under `data`.
export interface Paginated<TItem, TMeta = unknown> {
  data: TItem[];
  meta: TMeta;
}

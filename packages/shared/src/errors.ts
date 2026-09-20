/** Machine readable error codes returned in the API error envelope. */
export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  /** Safe to expose to API clients. Internal errors are masked by the error handler. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 400,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(ErrorCodes.BAD_REQUEST, message, 400, { details });

export const validationFailed = (message: string, details?: unknown): AppError =>
  new AppError(ErrorCodes.VALIDATION_FAILED, message, 422, { details });

export const unauthorized = (message = 'Authentication required.'): AppError =>
  new AppError(ErrorCodes.UNAUTHORIZED, message, 401);

export const forbidden = (message = 'You do not have access to this resource.'): AppError =>
  new AppError(ErrorCodes.FORBIDDEN, message, 403);

export const notFound = (message = 'Resource not found.'): AppError =>
  new AppError(ErrorCodes.NOT_FOUND, message, 404);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError(ErrorCodes.CONFLICT, message, 409, { details });

export const insufficientCredits = (required: number, available: number): AppError =>
  new AppError(
    ErrorCodes.INSUFFICIENT_CREDITS,
    `Not enough credits: ${required} required, ${available} available.`,
    402,
    { details: { required, available } },
  );

export const internalError = (message = 'Something went wrong.', cause?: unknown): AppError =>
  new AppError(ErrorCodes.INTERNAL, message, 500, { expose: false, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

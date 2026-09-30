import type { ErrorCode } from '@bitaqati/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  TOKEN_INVALID: 400,
  MFA_REQUIRED: 401,
  MFA_ENROLLMENT_REQUIRED: 403,
  MFA_INVALID: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  BRANCH_NOT_ASSIGNED: 403,
  REAUTH_REQUIRED: 401,
  NOT_FOUND: 404,
  CARD_NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REDEEMED_TODAY: 409,
  QUOTE_ALREADY_USED: 409,
  QUOTE_CHANGED: 409,
  REQUEST_IN_PROGRESS: 409,
  ALREADY_VOIDED: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  RATE_LIMITED: 429,
  UPLOAD_INVALID: 400,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Domain error with a stable code. The HTTP layer renders it as the standard error body. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: Record<string, unknown>,
    status?: number,
  ) {
    super(code);
    this.name = 'AppError';
    this.status = status ?? STATUS[code] ?? 422;
  }
}

export const fail = (code: ErrorCode, details?: Record<string, unknown>): never => {
  throw new AppError(code, details);
};

/** Stable machine-readable error codes returned by the API. */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Signed in with a temporary password: only a password change is allowed until it is set. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** Right password, but the account may not sign in. */
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** A report export would hold more records than one file is allowed to; narrow the filters. */
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiFieldError {
  field: string;
  messages: string[];
}

/** Every non-2xx response from the API has exactly this shape. */
export interface ApiErrorBody {
  error: {
    statusCode: number;
    code: ApiErrorCode;
    message: string;
    details?: ApiFieldError[];
    requestId: string;
    path: string;
    timestamp: string;
  };
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: ApiErrorCode.BAD_REQUEST,
  401: ApiErrorCode.UNAUTHORIZED,
  403: ApiErrorCode.FORBIDDEN,
  404: ApiErrorCode.NOT_FOUND,
  409: ApiErrorCode.CONFLICT,
  413: ApiErrorCode.PAYLOAD_TOO_LARGE,
  503: ApiErrorCode.SERVICE_UNAVAILABLE,
};

export function errorCodeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? ApiErrorCode.INTERNAL_ERROR;
}

export type StoreErrorCode =
  | 'INVALID_ARTIFACT'
  | 'INVALID_META'
  | 'INVALID_PATH'
  | 'INVALID_UPDATE'
  | 'UNSUPPORTED_KIND'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EDIT_CONFLICT'
  | 'PATH_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'LOCK_TIMEOUT'
  | 'STORE_UNAVAILABLE';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: StoreErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.details = details;
  }
}

export function isStoreError(error: unknown, code?: StoreErrorCode): error is StoreError {
  return error instanceof StoreError && (code === undefined || error.code === code);
}

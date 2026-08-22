export class ObserverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'ObserverError';
  }

  toJSON(): object {
    return {
      error: {
        code: this.code,
        message: this.message,
        recoverable: this.recoverable,
        ...(this.suggestion === undefined
          ? {}
          : { suggestion: this.suggestion }),
      },
    };
  }
}

export function asObserverError(error: unknown): ObserverError {
  if (error instanceof ObserverError) return error;
  if (
    error instanceof Error &&
    error.name === 'CdpLockError' &&
    'suggestion' in error
  ) {
    return new ObserverError(
      'CDP_LOCK_HELD',
      error.message,
      true,
      (error as { suggestion: string }).suggestion,
    );
  }
  return new ObserverError(
    'INTERNAL_ERROR',
    error instanceof Error ? error.message : String(error),
    false,
  );
}

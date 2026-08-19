/**
 * Retry classification — a pure, dependency-free helper so both the
 * runtime handler and the check script always agree.
 *
 * Historical contract: retry everything except `TypeError` (bugs that a retry
 * won't fix). Explicit `RetryableError` is also retried.
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof RetryableError || !(err instanceof TypeError);
}

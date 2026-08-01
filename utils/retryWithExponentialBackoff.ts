/**
 * Retry a function with exponential backoff.
 * Useful for API calls that might fail temporarily.
 */
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = (error: Error) => {
      // Retry on network errors and timeouts, not on auth/permission errors
      const message = error.message.toLowerCase();
      return !message.includes('401') && !message.includes('403');
    },
  } = options;

  let lastError: Error | null = null;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));

      // Exponential backoff: delay = min(initialDelay * 2^attempt, maxDelay)
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

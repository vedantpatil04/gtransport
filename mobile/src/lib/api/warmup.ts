import { API_URL } from '../config';

/** The API runs on an instance that sleeps when idle and takes up to about a minute to wake. */
export const WAKE_TIMEOUT_MS = 75_000;

/**
 * Sends the API's public health check, which wakes a sleeping instance, and waits for the answer.
 * Resolves true when the API answered and false when it did not in time; never throws, because the
 * request that follows reports the real failure with the real reason.
 *
 * Used before sign-in-adjacent requests (opening the office console) so their short time limits
 * and one-minute handoff code are not spent waiting for a cold start, and periodically while the
 * console is open so the instance does not go to sleep under someone who is working.
 */
export async function wakeApi(timeoutMs: number = WAKE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}/health`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

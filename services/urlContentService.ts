import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { retryWithExponentialBackoff } from '../utils/retryWithExponentialBackoff';

const PROXY = '/.netlify/functions/extractUrlContent';

export interface ExtractedUrlContent {
    title: string;
    text: string;
    length: number;
    truncated: boolean;
    url: string;
}

/**
 * Fetches a URL server-side (via the extractUrlContent Netlify function,
 * avoiding browser CORS) and returns its main readable text — the real
 * article/page body, not just a title or meta description.
 *
 * Returns null rather than throwing on failure (page unreachable, blocked,
 * no readable text, etc.) so callers can fall back to whatever short
 * note/summary they already have instead of surfacing a hard error for what
 * is meant to be a best-effort enrichment step.
 */
export const extractUrlContent = async (url: string): Promise<ExtractedUrlContent | null> => {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
        const params = new URLSearchParams({ url });
        const res = await retryWithExponentialBackoff(
            // 15s per attempt + a full retry of the same 15s on ANY failure —
            // including a timeout itself — meant the worst case for this one
            // step was 15s + 1s backoff + 15s = 31s, before the caller had even
            // started generating audio. A slow/unreachable site is the common
            // case here (not a transient blip worth retrying), so: shrink the
            // per-attempt timeout to a still-generous-but-saner 10s, and don't
            // retry when the failure WAS a timeout — retrying an attempt that
            // already used its full budget rarely helps and just doubles the
            // wait. Genuine transient errors (a dropped connection, a one-off
            // 5xx) still get one quick retry.
            () => fetchWithTimeout(`${PROXY}?${params}`, { timeout: 10000 }),
            {
                maxRetries: 1,
                initialDelayMs: 500,
                shouldRetry: (error) => error.name !== 'AbortError' && !/timed out|abort/i.test(error.message),
            }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.text) return null;
        return data as ExtractedUrlContent;
    } catch (error) {
        console.error('extractUrlContent failed:', error);
        return null;
    }
};

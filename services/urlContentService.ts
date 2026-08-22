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
            () => fetchWithTimeout(`${PROXY}?${params}`, { timeout: 15000 }),
            { maxRetries: 1, initialDelayMs: 1000 }
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

import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const PROXY = '/.netlify/functions/podcastSnip';

// This pipeline (Spotify lookup -> RSS fetch -> Range audio fetch ->
// Gemini transcription) genuinely takes longer than a typical proxy call —
// give it real headroom rather than the 10-15s budgets used elsewhere in
// this codebase for lighter server calls.
const REQUEST_TIMEOUT_MS = 45000;

export interface PodcastSnipResult {
    showName: string | null;
    episodeTitle: string;
    episodeUrl: string;
    timestampSeconds: number;
    transcript: string;
    audioWindowStartSeconds: number;
    audioWindowEndSeconds: number;
    rangeSupported: boolean;
    bitrateEstimated: boolean;
    audioSourceUrl: string;
}

export type PodcastSnipOutcome =
    | { ok: true; data: PodcastSnipResult }
    | { ok: false; reason: string };

/**
 * Given a Spotify episode share link (ideally one produced by Spotify's
 * "Share -> Share Timestamp" option, e.g.
 * https://open.spotify.com/episode/<id>?si=...&t=<seconds>), calls the
 * podcastSnip Netlify function to resolve the episode's real audio file,
 * fetch just the ~10-20 minute window around that timestamp, and transcribe
 * it (Hebrew-first). This is deliberately NOT a full-episode transcription.
 *
 * Returns a discriminated { ok, ... } result rather than null-on-failure —
 * unlike extractUrlContent's best-effort-enrichment use case, a failure here
 * IS the whole point of the request (there's no shorter fallback content to
 * silently degrade to), and this pipeline has several distinct, genuinely
 * likely failure modes (episode not in any public RSS feed, Spotify-exclusive
 * show, host doesn't support Range, transcription failure) that the user
 * needs to actually see, per this app's established surface-the-real-error
 * convention (Web Clips, Claude, Notion, Moodle all follow this same shape).
 */
export const fetchPodcastSnip = async (spotifyUrl: string): Promise<PodcastSnipOutcome> => {
    if (!spotifyUrl || !/^https?:\/\//i.test(spotifyUrl)) {
        return { ok: false, reason: 'Not a valid link.' };
    }
    try {
        const res = await fetchWithTimeout(PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: spotifyUrl }),
            timeout: REQUEST_TIMEOUT_MS,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.transcript) {
            const reason = data?.error || `Request failed (HTTP ${res.status}).`;
            console.error('fetchPodcastSnip failed:', reason);
            return { ok: false, reason };
        }
        return { ok: true, data: data as PodcastSnipResult };
    } catch (error: any) {
        const reason = error?.name === 'AbortError'
            ? 'Timed out fetching and transcribing that podcast moment — this can take a while, try again.'
            : (error?.message || 'Could not reach the podcast snip service.');
        console.error('fetchPodcastSnip failed:', error);
        return { ok: false, reason };
    }
};

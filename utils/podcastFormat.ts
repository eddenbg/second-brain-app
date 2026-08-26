/**
 * Shared client-side helpers for Podcast Snip memories — used by both the
 * share-routing flow (App.tsx, deciding whether a shared Spotify link
 * carried an explicit timestamp) and the browse UI (PersonalView.tsx,
 * formatting that timestamp for display).
 *
 * Kept out of services/podcastService.ts deliberately — that file's shape is
 * a confirmed contract with the backend function; this is purely
 * client-side detection/presentation logic layered on top of it.
 */

/** Matches a Spotify single-episode share link, e.g.
 *  https://open.spotify.com/episode/<id>?si=...&t=<seconds> */
export const SPOTIFY_EPISODE_URL_RE = /open\.spotify\.com\/episode\//i;

/**
 * Tag stamped on a PodcastSnipMemory when the shared link carried no
 * explicit Spotify "Share Timestamp" (`?t=...`) — meaning the backend fell
 * back to transcribing from the start of the episode rather than a moment
 * the user actually pointed at (see fetchPodcastSnip's parseSpotifyUrl,
 * which defaults timestampSeconds to 0 when `t` is absent). Surfaced in the
 * UI so that fallback never reads as a precisely-captured moment — there is
 * a real, unverified possibility that Spotify's timestamp-sharing only
 * works for video podcasts, so a plain "Share Episode" (no `?t=`) may be
 * what actually arrives for many audio-only shows.
 */
export const PODCAST_NO_TIMESTAMP_TAG = 'podcast:no-explicit-timestamp';

/**
 * Whether a shared Spotify episode URL itself included a `t=` (timestamp)
 * query param — checked independently of whatever `timestampSeconds` the
 * backend returns, since it silently defaults that to 0 when none was
 * given (a real 0 and "no timestamp was shared at all" would otherwise be
 * indistinguishable).
 */
export const hasExplicitPodcastTimestamp = (url: string): boolean => {
    try {
        return new URL(url).searchParams.has('t');
    } catch {
        return /[?&]t=\d/.test(url);
    }
};

/** Formats a playback offset in seconds as "mm:ss", or "h:mm:ss" past the first hour. */
export const formatPodcastTimestamp = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return hrs > 0
        ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        : `${mins}:${secs.toString().padStart(2, '0')}`;
};

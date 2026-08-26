import type { Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

// Turns a Spotify "Share Timestamp" episode link into a short Hebrew-first
// transcript of just the ~10-20 minutes of audio around that timestamp — NOT
// a full-episode transcription. Pipeline, all server-side (no Spotify API key
// needed, keeps everything keyless):
//
//   1. Parse the episode id + timestamp (seconds) out of the Spotify URL.
//   2. Resolve the episode title via Spotify's public oEmbed endpoint (no
//      auth). oEmbed does NOT reliably return the show name (see
//      extractShowName below), so:
//   3. Fetch the Spotify episode page itself (also public, no auth) and try
//      to recover the show name from its JSON-LD / <title> tag.
//   4. Search Apple's iTunes Search API (entity=podcast, keyless) for the
//      show by name to get its RSS feedUrl, then fetch+parse that RSS feed
//      ourselves and find the item whose <title> matches our episode title.
//   5. Estimate a byte range around the target timestamp from the RSS
//      enclosure's declared length + <itunes:duration>, and fetch just that
//      window with an HTTP Range request (degrading honestly if the host
//      doesn't support Range — see fetchAudioWindow).
//   6. Transcribe that audio window with Gemini, Hebrew-first (mirrors the
//      exact instruction wording used in services/geminiService.ts's
//      extractTextFromImage/extractHandwritingFromImage and the live
//      transcription systemInstruction in components/Recorder.tsx).
//
// See the accompanying research notes in the handoff report for exactly
// which of the assumptions below were verified live vs. documented-but-
// unverified (this sandbox's network egress blocks direct requests to
// open.spotify.com / itunes.apple.com / arbitrary hosts, so the Spotify URL
// shape and API field names come from Spotify's own docs + corroborating
// third-party writeups found via search, not a live test request).

const FETCH_TIMEOUT_MS = 10000;
const RSS_FETCH_TIMEOUT_MS = 12000;
const AUDIO_FETCH_TIMEOUT_MS = 20000;

// How far before/after the shared timestamp we'd LIKE to capture, before the
// Gemini inline-payload budget below potentially shrinks it.
const TARGET_PADDING_BEFORE_SEC = 7 * 60; // 7 min before
const TARGET_PADDING_AFTER_SEC = 8 * 60; // 8 min after (~15 min window)

// Gemini's documented inline-request budget for audio is ~20MB total
// (base64-encoded, includes the prompt text) — see
// https://ai.google.dev/gemini-api/docs/generate-content/audio. Base64
// inflates raw bytes by ~4/3, so keep the RAW audio well under that: 14MB
// raw -> ~18.7MB base64, leaving headroom for the prompt text and JSON
// envelope. This, not the padding above, is what actually caps how much
// audio we fetch for a high-bitrate file.
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

// Hard ceiling for a same-origin, no-Range-support fallback download (see
// fetchAudioWindow). Mirrors extractUrlContent.ts's MAX_RESPONSE_BYTES
// pattern: cap what we'll ever pull into memory regardless of what the
// server claims/sends.
const MAX_FALLBACK_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const MAX_RSS_BYTES = 8 * 1024 * 1024;

// Typical spoken-word podcast bitrate, used ONLY when we can't compute a
// real bitrate from the RSS feed's own declared enclosure length +
// <itunes:duration> (see estimateBitrate). 128kbps = 16,000 bytes/sec.
const ASSUMED_BITRATE_BYTES_PER_SEC = 16000;

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function errorResponse(status: number, error: string, stage: string) {
  return new Response(JSON.stringify({ error, stage }), { status, headers: corsHeaders });
}

// ---------------------------------------------------------------------------
// 1. Spotify URL parsing
// ---------------------------------------------------------------------------

interface ParsedSpotifyUrl {
  episodeId: string;
  timestampSeconds: number;
  canonicalUrl: string;
}

/**
 * Spotify's "Share -> Share Timestamp" option (distinct from "Share
 * Episode") appends the playback position to the normal episode share URL as
 * `?t=<seconds>` (integer seconds, NOT milliseconds) — e.g.
 * `https://open.spotify.com/episode/<id>?si=<share-id>&t=1450` for a
 * timestamp of 24:10. Confirmed via Spotify community threads and
 * third-party writeups describing real share links (not independently
 * fetchable from this sandbox — see file header). `si` is Spotify's own
 * share/tracking id and is unrelated to the timestamp; we ignore it. As a
 * defensive fallback (undocumented but seen used by some third-party
 * timestamp-share tools/extensions), we also accept `ts` or `time` with the
 * same seconds semantics if `t` is absent, and `t` given in milliseconds
 * (heuristically: a value implausibly large for a podcast, i.e. > 6 hours in
 * "seconds", is reinterpreted as milliseconds).
 */
function parseSpotifyEpisodeUrl(raw: string): ParsedSpotifyUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;

  const match = url.pathname.match(/\/episode\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const episodeId = match[1];

  const tRaw = url.searchParams.get("t") ?? url.searchParams.get("ts") ?? url.searchParams.get("time");
  let timestampSeconds = tRaw != null ? Number(tRaw) : 0;
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) timestampSeconds = 0;
  // Defensive ms-vs-seconds heuristic — see doc comment above.
  if (timestampSeconds > 6 * 3600) timestampSeconds = Math.round(timestampSeconds / 1000);

  return {
    episodeId,
    timestampSeconds: Math.round(timestampSeconds),
    canonicalUrl: `https://open.spotify.com/episode/${episodeId}`,
  };
}

// ---------------------------------------------------------------------------
// 2 & 3. Episode title (oEmbed) + show name (episode page best-effort)
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecondBrainPodcastSnip/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Spotify's public oEmbed endpoint (no auth) — verified via Spotify's own
 * developer docs and corroborating writeups to return a JSON object whose
 * `title` field is the EPISODE title (e.g. "My Path to Spotify: Women in
 * Engineering") — not "Show — Episode". There is no documented author_name /
 * show field on this response, hence the separate show-name step below.
 */
async function fetchOEmbedTitle(episodeUrl: string): Promise<string> {
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(episodeUrl)}`;
  const data = await fetchJson(oembedUrl, FETCH_TIMEOUT_MS);
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  if (!title) throw new Error("Spotify oEmbed returned no title for that episode");
  return title;
}

/**
 * Best-effort extraction of the show name from the Spotify episode page's
 * own HTML (a public page, fetched the same way extractUrlContent.ts fetches
 * any third-party page). Tries, in order:
 *   1. A JSON-LD <script type="application/ld+json"> block with
 *      @type "PodcastEpisode" and a partOfSeries.name — the standard
 *      schema.org pattern podcast platforms use for SEO.
 *   2. The page's <title> tag, which (per real indexed examples, e.g.
 *      "Making Your Links Look Great on Social Media - Good Morning
 *      Podcasters! | Podcast on Spotify") follows the pattern
 *      "{episode title} - {show name} | Podcast on Spotify". Since we
 *      already know the exact episode title from oEmbed, we strip it as a
 *      known prefix and strip the known suffix, leaving the show name.
 * Returns "" (not a throw) on failure — show name is best-effort; a missing
 * show name degrades the show lookup step, it doesn't abort the request
 * outright (that decision is made by the caller).
 */
async function extractShowName(episodeUrl: string, episodeTitle: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(episodeUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SecondBrainPodcastSnip/1.0)",
        "Accept": "text/html",
      },
    });
    if (!res.ok) return "";
    html = await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }

  // Strategy 1: JSON-LD PodcastEpisode -> partOfSeries.name
  const ldBlocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const seriesName = c?.partOfSeries?.name;
        if (typeof seriesName === "string" && seriesName.trim()) return seriesName.trim();
      }
    } catch {
      // Not valid/parseable JSON-LD — fall through to strategy 2.
    }
  }

  // Strategy 2: <title>"{episode} - {show} | Podcast on Spotify"</title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    let pageTitle = titleMatch[1].replace(/\s+/g, " ").trim();
    pageTitle = pageTitle.replace(/\s*\|\s*Podcast on Spotify\s*$/i, "").replace(/\s*\|\s*Spotify\s*$/i, "").trim();
    if (pageTitle.toLowerCase().startsWith(episodeTitle.toLowerCase())) {
      let remainder = pageTitle.slice(episodeTitle.length).trim();
      remainder = remainder.replace(/^[-–—:|]\s*/, "").trim();
      if (remainder) return remainder;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// 4. iTunes Search (entity=podcast) -> RSS feed -> matching <item>
// ---------------------------------------------------------------------------

interface FeedEpisode {
  title: string;
  audioUrl: string;
  audioType: string;
  lengthBytes: number | null; // from <enclosure length="...">
  durationSeconds: number | null; // from <itunes:duration>
}

async function findRssFeedUrl(showName: string): Promise<string | null> {
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(showName)}&entity=podcast&limit=5`;
  const data = await fetchJson(searchUrl, FETCH_TIMEOUT_MS);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, "");
  const target = normalize(showName);

  // Prefer an exact (normalized) name match; otherwise take the top result —
  // iTunes Search's own relevance ranking for entity=podcast (as opposed to
  // the documented-unreliable entity=podcastEpisode) is generally sound.
  const exact = results.find(r => typeof r.collectionName === "string" && normalize(r.collectionName) === target);
  const chosen = exact || results[0];
  return typeof chosen?.feedUrl === "string" ? chosen.feedUrl : null;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ""; }
    })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Parses "HH:MM:SS", "MM:SS", or a plain integer-seconds string — all valid
 *  per the itunes:duration spec, and all seen in real feeds. */
function parseItunesDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(":").map(p => parseInt(p, 10));
  if (parts.some(p => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

async function fetchAndParseFeed(feedUrl: string, episodeTitle: string): Promise<FeedEpisode | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  let xml: string;
  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecondBrainPodcastSnip/1.0)" },
    });
    if (!res.ok) throw new Error(`RSS feed returned HTTP ${res.status}`);

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          chunks.push(value);
          if (total >= MAX_RSS_BYTES) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } else {
      chunks.push(new Uint8Array(await res.arrayBuffer()));
    }
    xml = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");
  } finally {
    clearTimeout(timeoutId);
  }

  const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  const target = normalize(episodeTitle);

  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  let bestMatch: FeedEpisode | null = null;
  let bestScore = -1;

  for (const item of itemBlocks) {
    const titleMatch = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    if (!titleMatch) continue;
    const itemTitle = decodeXmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
    const normItem = normalize(itemTitle);

    let score = -1;
    if (normItem === target) score = 100;
    else if (normItem.includes(target) || target.includes(normItem)) score = 50;
    if (score <= bestScore) continue;

    const enclosureMatch = item.match(/<enclosure\b[^>]*\/?>/i);
    if (!enclosureMatch) continue;
    const enclosureTag = enclosureMatch[0];
    const urlMatch = enclosureTag.match(/\burl=["']([^"']+)["']/i);
    if (!urlMatch) continue;
    const lengthMatch = enclosureTag.match(/\blength=["'](\d+)["']/i);
    const typeMatch = enclosureTag.match(/\btype=["']([^"']+)["']/i);

    const durationMatch = item.match(/<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/i);
    const durationSeconds = durationMatch ? parseItunesDuration(decodeXmlEntities(durationMatch[1])) : null;

    bestScore = score;
    bestMatch = {
      title: itemTitle,
      audioUrl: decodeXmlEntities(urlMatch[1]),
      audioType: typeMatch ? typeMatch[1] : "audio/mpeg",
      lengthBytes: lengthMatch ? parseInt(lengthMatch[1], 10) : null,
      durationSeconds,
    };
  }

  return bestScore >= 50 ? bestMatch : null;
}

// ---------------------------------------------------------------------------
// 5. Byte-range audio window fetch
// ---------------------------------------------------------------------------

interface AudioWindow {
  bytes: Uint8Array;
  mimeType: string;
  rangeSupported: boolean;
  bitrateEstimated: boolean;
  windowStartSeconds: number;
  windowEndSeconds: number;
}

async function headContentLength(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    const len = res.headers.get("content-length");
    return len ? parseInt(len, 10) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAudioWindow(episode: FeedEpisode, timestampSeconds: number): Promise<AudioWindow> {
  let totalBytes = episode.lengthBytes;
  if (!totalBytes) totalBytes = await headContentLength(episode.audioUrl);

  const durationSeconds = episode.durationSeconds;
  let bitrate: number;
  let bitrateEstimated: boolean;
  if (totalBytes && durationSeconds && durationSeconds > 0) {
    bitrate = totalBytes / durationSeconds;
    bitrateEstimated = false;
  } else {
    bitrate = ASSUMED_BITRATE_BYTES_PER_SEC;
    bitrateEstimated = true;
  }

  let windowStartSec = Math.max(0, timestampSeconds - TARGET_PADDING_BEFORE_SEC);
  let windowEndSec = timestampSeconds + TARGET_PADDING_AFTER_SEC;
  if (durationSeconds) windowEndSec = Math.min(windowEndSec, durationSeconds);

  // Shrink symmetrically around the timestamp if the estimated window would
  // blow the Gemini inline-payload budget.
  const estimatedBytes = (windowEndSec - windowStartSec) * bitrate;
  if (estimatedBytes > MAX_AUDIO_BYTES) {
    const maxWindowSec = MAX_AUDIO_BYTES / bitrate;
    const half = maxWindowSec / 2;
    windowStartSec = Math.max(0, timestampSeconds - half);
    windowEndSec = timestampSeconds + half;
    if (durationSeconds) windowEndSec = Math.min(windowEndSec, durationSeconds);
  }

  let byteStart = Math.floor(windowStartSec * bitrate);
  let byteEnd = Math.ceil(windowEndSec * bitrate);
  if (totalBytes) byteEnd = Math.min(byteEnd, totalBytes - 1);
  byteEnd = Math.min(byteEnd, byteStart + MAX_AUDIO_BYTES);
  if (byteEnd <= byteStart) byteEnd = byteStart + Math.min(MAX_AUDIO_BYTES, totalBytes ? totalBytes - byteStart : MAX_AUDIO_BYTES);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUDIO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(episode.audioUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SecondBrainPodcastSnip/1.0)",
        "Range": `bytes=${byteStart}-${byteEnd}`,
      },
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`Audio host returned HTTP ${res.status} fetching the episode file`);
    }

    const mimeType = res.headers.get("content-type") || episode.audioType || "audio/mpeg";

    if (res.status === 206) {
      // Host honored the Range request — we got exactly the window we asked
      // for (modulo it not being frame-aligned, which MP3/AAC decoders
      // tolerate by resyncing at the next valid frame header).
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        bytes: buf,
        mimeType,
        rangeSupported: true,
        bitrateEstimated,
        windowStartSeconds: Math.round(windowStartSec),
        windowEndSeconds: Math.round(windowEndSec),
      };
    }

    // Host ignored Range and sent 200 with (presumably) the whole file.
    // Download it capped at MAX_FALLBACK_DOWNLOAD_BYTES — we cannot slice
    // compressed audio client-side without decoding it, so this path
    // honestly means "we transcribe more than the intended window, or we
    // give up if the file is too big to safely fit the transcription
    // budget at all" (see the size check below), never silently pretending
    // we captured just the requested window.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          chunks.push(value);
          if (total >= MAX_FALLBACK_DOWNLOAD_BYTES) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } else {
      chunks.push(new Uint8Array(await res.arrayBuffer()));
    }
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));

    if (total >= MAX_FALLBACK_DOWNLOAD_BYTES && (!totalBytes || totalBytes > MAX_FALLBACK_DOWNLOAD_BYTES)) {
      throw new Error(
        "This podcast's host does not support partial (Range) downloads, and the full episode file is too large to transcribe safely. Try a different episode or a shorter show."
      );
    }
    if (buf.byteLength > MAX_AUDIO_BYTES) {
      throw new Error(
        "This podcast's host does not support partial (Range) downloads, so only whole-episode audio was available and it exceeds what can be transcribed in one request."
      );
    }

    return {
      bytes: new Uint8Array(buf),
      mimeType,
      rangeSupported: false,
      bitrateEstimated,
      windowStartSeconds: 0,
      windowEndSeconds: durationSeconds ?? Math.round(buf.byteLength / bitrate),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// 6. Gemini transcription — Hebrew-first, mirrors the wording convention in
//    services/geminiService.ts (extractTextFromImage / extractHandwritingFromImage)
//    and components/Recorder.tsx's live-transcription systemInstruction.
// ---------------------------------------------------------------------------

const TRANSCRIPTION_PROMPT =
  "Transcribe this audio clip from a podcast, exactly as spoken. Hebrew is the default and primary language — when a word or sound is ambiguous, transcribe it as Hebrew. Only transcribe a word as English when it clearly cannot be Hebrew (e.g. a technical term, product name, acronym, or a stretch of speech that is unmistakably English). Do not let English be the default guess for unclear audio. If the speaker mixes Hebrew and English, switching mid-sentence, transcribe each word in the language it was actually spoken in — never translate between them. Keep English technical terms, product names and acronyms in Latin script exactly as spoken, even inside a Hebrew sentence. Return ONLY the transcript text, no timestamps, speaker labels, or commentary.";

async function transcribeAudio(bytes: Uint8Array, mimeType: string): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  const ai = new GoogleGenAI({ apiKey });
  const base64Data = Buffer.from(bytes).toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
  });

  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned no transcript for this audio window");
  return text;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", "method");
  }

  let spotifyUrl: string | null = null;
  try {
    const body = await req.json();
    spotifyUrl = typeof body?.url === "string" ? body.url : null;
  } catch {
    return errorResponse(400, "Invalid JSON body", "parse_request");
  }
  if (!spotifyUrl) {
    return errorResponse(400, "Missing 'url' parameter", "parse_request");
  }

  const parsed = parseSpotifyEpisodeUrl(spotifyUrl);
  if (!parsed) {
    return errorResponse(
      400,
      "That doesn't look like a Spotify episode link (expected something like https://open.spotify.com/episode/<id>?t=<seconds>)",
      "parse_url"
    );
  }

  let episodeTitle: string;
  try {
    episodeTitle = await fetchOEmbedTitle(parsed.canonicalUrl);
  } catch (error: any) {
    const msg = error?.name === "AbortError" ? "Timed out looking up that episode on Spotify" : (error?.message || "Failed to look up that episode on Spotify");
    return errorResponse(502, `Spotify episode lookup failed: ${msg}`, "oembed");
  }

  const showName = await extractShowName(parsed.canonicalUrl, episodeTitle).catch(() => "");

  let feedUrl: string | null = null;
  try {
    feedUrl = await findRssFeedUrl(showName || episodeTitle);
  } catch (error: any) {
    const msg = error?.name === "AbortError" ? "Timed out searching for the podcast" : (error?.message || "Podcast directory search failed");
    return errorResponse(502, `Could not search for this podcast's RSS feed: ${msg}`, "show_lookup");
  }
  if (!feedUrl) {
    return errorResponse(
      404,
      showName
        ? `Could not find "${showName}" in the iTunes podcast directory, so its RSS feed (and audio) couldn't be located.`
        : `Could not determine the show name for "${episodeTitle}", and searching by episode title found no matching podcast in the iTunes directory.`,
      "show_lookup"
    );
  }

  let feedEpisode: FeedEpisode | null;
  try {
    feedEpisode = await fetchAndParseFeed(feedUrl, episodeTitle);
  } catch (error: any) {
    const msg = error?.name === "AbortError" ? "Timed out fetching the podcast's RSS feed" : (error?.message || "Failed to fetch/parse the podcast RSS feed");
    return errorResponse(502, msg, "feed_fetch");
  }
  if (!feedEpisode) {
    return errorResponse(
      404,
      `Found the show's RSS feed but no episode titled "${episodeTitle}" appears in it (it may be too old for the feed, or Spotify-exclusive with no public RSS entry).`,
      "episode_match"
    );
  }

  let audioWindow: AudioWindow;
  try {
    audioWindow = await fetchAudioWindow(feedEpisode, parsed.timestampSeconds);
  } catch (error: any) {
    const msg = error?.name === "AbortError" ? "Timed out fetching audio from the podcast host" : (error?.message || "Failed to fetch the episode audio");
    return errorResponse(502, msg, "audio_fetch");
  }

  let transcript: string;
  try {
    transcript = await transcribeAudio(audioWindow.bytes, audioWindow.mimeType);
  } catch (error: any) {
    if (error?.message === "GEMINI_API_KEY_MISSING") {
      return errorResponse(503, "Gemini API key not configured on the server (API_KEY env var).", "transcription");
    }
    const apiMessage =
      (typeof error?.error?.message === "string" && error.error.message) ||
      (typeof error?.message === "string" && error.message) ||
      String(error);
    return errorResponse(502, `Transcription failed: ${apiMessage}`, "transcription");
  }

  return new Response(
    JSON.stringify({
      showName: showName || null,
      episodeTitle,
      episodeUrl: parsed.canonicalUrl,
      timestampSeconds: parsed.timestampSeconds,
      transcript,
      audioWindowStartSeconds: audioWindow.windowStartSeconds,
      audioWindowEndSeconds: audioWindow.windowEndSeconds,
      rangeSupported: audioWindow.rangeSupported,
      bitrateEstimated: audioWindow.bitrateEstimated,
      audioSourceUrl: feedEpisode.audioUrl,
    }),
    { status: 200, headers: corsHeaders }
  );
};

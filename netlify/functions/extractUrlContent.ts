import type { Context } from "@netlify/functions";

// Server-side fetch + readable-text extraction for a third-party URL. Runs on
// the Netlify function so the browser never has to fetch an arbitrary
// cross-origin page directly (which CORS blocks for most sites). This is
// intentionally NOT a full Readability port — no scoring, no boilerplate
// heuristics beyond dropping the obvious chrome tags — just enough to turn a
// typical article/blog page into clean plain text good enough to read aloud.

const FETCH_TIMEOUT_MS = 10000;
// Cap how much of the response body we ever read, so a huge or non-HTML
// response (a video file behind a misleading URL, an infinite stream) can't
// hang the function or balloon memory. 4MB of markup is enormously more than
// any normal article needs.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// Cap the extracted text we return/store. Memories are persisted as whole
// Firestore documents (capped at 1MB — see BaseMemory.voiceNote comments in
// types.ts), and nothing about "read this aloud" needs more than this even
// for a long-form article.
const MAX_TEXT_CHARS = 20000;

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Tags whose *contents* are pure noise for readable-text purposes — strip the
// whole element, not just the tag.
const STRIP_TAG_NAMES = ["script", "style", "noscript", "nav", "header", "footer", "form", "iframe", "svg", "aside"];

// Block-level tags: their closing tag becomes a newline, so paragraphs and
// list items don't get smashed together into one run-on line once the tags
// themselves are stripped.
const BLOCK_TAG_CLOSE_RE = /<\/(p|div|section|article|li|h[1-6]|br|tr|blockquote)>/gi;
const BR_RE = /<br\s*\/?>/gi;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", copy: "©",
  reg: "®", trade: "™",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ""; }
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITIES[name] ?? match);
}

function stripTagAndContents(html: string, tagName: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  return html.replace(re, " ");
}

/** Prefer the main article container when the page has one, so nav/sidebar
 *  text that slipped past the tag strip doesn't dilute the body. */
function pickMainRegion(html: string): string {
  const candidates = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+(?:id|class)=["'][^"']*(?:article|post-content|entry-content|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of candidates) {
    const match = html.match(re);
    if (match && match[1] && match[1].replace(/<[^>]+>/g, "").trim().length > 200) {
      return match[1];
    }
  }
  return html;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
}

function htmlToReadableText(html: string): string {
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of STRIP_TAG_NAMES) {
    cleaned = stripTagAndContents(cleaned, tag);
  }

  const region = pickMainRegion(cleaned);

  const withBreaks = region.replace(BR_RE, "\n").replace(BLOCK_TAG_CLOSE_RE, "\n");
  const textOnly = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(textOnly);

  return decoded
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isFetchableUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

async function fetchCapped(url: URL): Promise<{ html: string; contentType: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A generic browser UA — some sites 403 non-browser fetches outright.
        "User-Agent": "Mozilla/5.0 (compatible; SecondBrainClipper/1.0; +https://netlify.app)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("text/plain")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          chunks.push(value);
          if (totalBytes >= MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } else {
      // Environments without a streaming body (rare) — fall back to a plain read.
      const buf = await res.arrayBuffer();
      chunks.push(new Uint8Array(buf));
    }

    const html = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");
    return { html, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  let rawUrl: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      rawUrl = body?.url ?? null;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders });
    }
  } else {
    const url = new URL(req.url, "http://localhost");
    rawUrl = url.searchParams.get("url");
  }

  if (!rawUrl) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), { status: 400, headers: corsHeaders });
  }

  const target = isFetchableUrl(rawUrl);
  if (!target) {
    return new Response(JSON.stringify({ error: "Only http(s) URLs can be fetched" }), { status: 400, headers: corsHeaders });
  }

  try {
    const { html } = await fetchCapped(target);
    const title = extractTitle(html);
    const fullText = htmlToReadableText(html);
    const truncated = fullText.length > MAX_TEXT_CHARS;
    const text = truncated ? fullText.slice(0, MAX_TEXT_CHARS) : fullText;

    if (!text) {
      return new Response(JSON.stringify({ error: "No readable text found on that page" }), { status: 422, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ title, text, length: text.length, truncated, url: target.toString() }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error: any) {
    const message = error?.name === "AbortError" ? "Timed out fetching that page" : (error?.message || "Failed to fetch page");
    console.error("extractUrlContent error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: corsHeaders });
  }
};

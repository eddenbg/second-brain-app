import type { Context } from "@netlify/functions";
import { AwsClient } from "aws4fetch";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

// Storage gateway to Backblaze B2 (S3-compatible API).
//
// The B2 key never leaves Netlify. The app proves who is signed in with its
// Firebase ID token; everything it can touch lives under
//   <B2_PREFIX>/users/<uid>/db/...     notes, tasks, events, settings (JSON)
//   <B2_PREFIX>/users/<uid>/media/...  recordings, photos, PDFs, drawings
// Large files are sent in pieces of a few MB (Netlify functions accept ~6 MB
// per request), so no bucket CORS setup is needed.
//
// Netlify environment variables:
//   B2_KEY_ID, B2_APPLICATION_KEY  – an application key for the bucket
//   B2_BUCKET                      – bucket name
//   B2_ENDPOINT                    – e.g. s3.eu-central-003.backblazeb2.com
//   B2_PREFIX (optional)           – folder inside the bucket, default "second-brain"
//   ALLOWED_EMAILS                 – comma-separated Google account(s) allowed to use storage

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "my-second-brain-app-10dfe";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Google's public keys for Firebase sign-in tokens (they rotate; cached 1 h)
let jwksCache: { at: number; keys: ReturnType<typeof createLocalJWKSet> } | null = null;
const getJwks = async (refresh = false) => {
  if (!jwksCache || refresh || Date.now() - jwksCache.at > 3600_000) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`Could not load sign-in keys (${res.status})`);
    jwksCache = { at: Date.now(), keys: createLocalJWKSet((await res.json()) as JSONWebKeySet) };
  }
  return jwksCache.keys;
};

// Keys the app may use, relative to its user folder
const KEY_PATTERN = /^(db|media)\/[A-Za-z0-9._:\-\/]{1,400}$/;
const PREFIX_PATTERN = /^(db|media)\/[A-Za-z0-9._:\-\/]*$/;
// Response budget for getMany, in bytes of JSON (function responses are capped
// at ~6 MB) and in time (sync functions stop after ~10 s; the app asks again
// for whatever wasn't returned)
const GET_MANY_BYTES = 4_000_000;
const GET_MANY_MS = 6_000;
const MAX_BIN_BYTES = 4_500_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const config = () => {
  const keyId = process.env.B2_KEY_ID;
  const secret = process.env.B2_APPLICATION_KEY;
  const bucket = process.env.B2_BUCKET;
  let endpoint = (process.env.B2_ENDPOINT || "").trim().replace(/\/+$/, "");
  if (!keyId || !secret || !bucket || !endpoint) return null;
  if (!/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;
  const region = endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1] || "us-east-1";
  const prefix = (process.env.B2_PREFIX || "second-brain").replace(/^\/+|\/+$/g, "");
  return {
    bucket,
    endpoint,
    prefix,
    client: new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: "s3", region }),
  };
};

type Cfg = NonNullable<ReturnType<typeof config>>;

const objectUrl = (cfg: Cfg, fullKey: string) =>
  `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${fullKey.split("/").map(encodeURIComponent).join("/")}`;

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const validKey = (key: unknown): key is string => typeof key === "string" && KEY_PATTERN.test(key) && !key.includes("..");

async function verifyUser(req: Request): Promise<{ uid: string } | Response> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Not signed in.", code: "sign-in-required" }, 401);
  try {
    const options = { issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`, audience: FIREBASE_PROJECT_ID };
    let payload;
    try {
      ({ payload } = await jwtVerify(token, await getJwks(), options));
    } catch (e: any) {
      // A key we don't know yet (Google rotated them): reload once
      if (e?.code !== "ERR_JWKS_NO_MATCHING_KEY") throw e;
      ({ payload } = await jwtVerify(token, await getJwks(true), options));
    }
    // Only Google accounts on the allow-list (the bucket is private storage)
    const provider = (payload as any).firebase?.sign_in_provider;
    if (provider !== "google.com") return json({ error: "Sign in with Google to sync.", code: "sign-in-required" }, 403);
    const allowed = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!allowed.length) return json({ error: "Cloud storage isn't set up yet (ALLOWED_EMAILS missing in Netlify).", code: "not-configured" }, 503);
    const email = String((payload as any).email || "").toLowerCase();
    if ((payload as any).email_verified !== true || !allowed.includes(email)) {
      return json({ error: "This Google account isn't allowed to use this app's storage.", code: "not-allowed" }, 403);
    }
    if (!payload.sub) return json({ error: "Invalid sign-in.", code: "token-invalid" }, 401);
    return { uid: payload.sub };
  } catch (e: any) {
    return json({ error: "Sign-in expired.", code: "token-invalid", detail: String(e?.code || e?.message || e) }, 401);
  }
}

/** List every object under `fullPrefix` (handles pagination). */
async function listAll(cfg: Cfg, fullPrefix: string, userRoot: string) {
  const items: { key: string; etag: string; size: number; lastModified: string }[] = [];
  let token: string | undefined;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ "list-type": "2", prefix: fullPrefix, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const res = await cfg.client.fetch(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}?${q}`);
    const text = await res.text();
    if (!res.ok) throw new Error(`B2 list failed (${res.status}): ${text.slice(0, 300)}`);
    for (const m of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "");
      items.push({
        key: key.slice(userRoot.length),
        etag: decodeXml(block.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1] || "").replace(/"/g, ""),
        size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
        lastModified: block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || "",
      });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(text);
    token = text.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
    if (!truncated || !token) break;
    token = decodeXml(token);
  }
  return items;
}

async function deleteKeys(cfg: Cfg, userRoot: string, keys: string[]) {
  // A few at a time, to stay friendly with B2's rate limits
  for (let i = 0; i < keys.length; i += 10) {
    await Promise.all(keys.slice(i, i + 10).map(async (key) => {
      const res = await cfg.client.fetch(objectUrl(cfg, userRoot + key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`B2 delete failed (${res.status})`);
    }));
  }
}

export default async (req: Request, _context: Context) => {
  const cfg = config();
  if (!cfg) return json({ error: "Cloud storage isn't set up yet (B2 keys missing in Netlify).", code: "not-configured" }, 503);

  const who = await verifyUser(req);
  if (who instanceof Response) return who;
  const userRoot = `${cfg.prefix}/users/${who.uid}/`;
  const url = new URL(req.url);

  try {
    // ── Binary pieces (recordings, PDFs, photos) ──────────────────────────
    if (url.searchParams.get("op") === "getBin") {
      const key = url.searchParams.get("key");
      if (!validKey(key)) return json({ error: "Bad key" }, 400);
      const res = await cfg.client.fetch(objectUrl(cfg, userRoot + key));
      if (res.status === 404) return json({ error: "Not found", code: "not-found" }, 404);
      if (!res.ok) return json({ error: `B2 download failed (${res.status})` }, 502);
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: { "Content-Type": res.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-store" },
      });
    }
    if (url.searchParams.get("op") === "putBin") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const key = url.searchParams.get("key");
      if (!validKey(key)) return json({ error: "Bad key" }, 400);
      const data = await req.arrayBuffer();
      if (data.byteLength > MAX_BIN_BYTES) return json({ error: "Piece too large" }, 413);
      const res = await cfg.client.fetch(objectUrl(cfg, userRoot + key), {
        method: "PUT",
        body: data,
        headers: { "Content-Type": url.searchParams.get("type") || "application/octet-stream" },
      });
      if (!res.ok) return json({ error: `B2 upload failed (${res.status})`, detail: (await res.text()).slice(0, 300) }, 502);
      return json({ ok: true });
    }

    // ── JSON operations ──────────────────────────────────────────────────
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const op = body?.op;

    if (op === "ping") {
      // Proves the key and bucket work
      const res = await cfg.client.fetch(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}?list-type=2&max-keys=1&prefix=${encodeURIComponent(userRoot)}`);
      if (!res.ok) return json({ error: `B2 refused the request (${res.status}). Check the key, bucket name and endpoint.`, detail: (await res.text()).slice(0, 300) }, 502);
      return json({ ok: true });
    }

    if (op === "list") {
      const sub = typeof body.prefix === "string" ? body.prefix : "db/";
      if (!PREFIX_PATTERN.test(sub) || sub.includes("..")) return json({ error: "Bad prefix" }, 400);
      return json({ items: await listAll(cfg, userRoot + sub, userRoot) });
    }

    if (op === "getMany") {
      // Text objects (JSON records). Stops early if the response would get too big;
      // the app asks again for whatever is missing.
      const keys: unknown[] = Array.isArray(body.keys) ? body.keys.slice(0, 200) : [];
      const items: Record<string, string | null> = {};
      let used = 0;
      const started = Date.now();
      for (let i = 0; i < keys.length && used < GET_MANY_BYTES && Date.now() - started < GET_MANY_MS; i += 16) {
        const batch = keys.slice(i, i + 16).filter(validKey) as string[];
        const results = await Promise.all(batch.map(async (key) => {
          const res = await cfg.client.fetch(objectUrl(cfg, userRoot + key));
          if (res.status === 404) return [key, null] as const;
          if (!res.ok) throw new Error(`B2 download failed (${res.status})`);
          return [key, await res.text()] as const;
        }));
        for (const [key, text] of results) {
          const bytes = text ? Buffer.byteLength(JSON.stringify(text)) : 4;
          if (used + bytes > GET_MANY_BYTES && used > 0) break;
          items[key] = text;
          used += bytes;
        }
      }
      return json({ items });
    }

    if (op === "putText") {
      // JSON records: [{ key, text }]
      const puts: any[] = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      for (const p of puts) if (!validKey(p?.key) || typeof p?.text !== "string") return json({ error: "Bad item" }, 400);
      // B2's fingerprint of each saved file, so the app knows which version is its own
      const etags: Record<string, string> = {};
      for (let i = 0; i < puts.length; i += 8) {
        await Promise.all(puts.slice(i, i + 8).map(async (p) => {
          const res = await cfg.client.fetch(objectUrl(cfg, userRoot + p.key), {
            method: "PUT",
            body: p.text,
            headers: { "Content-Type": p.contentType || "application/json; charset=utf-8" },
          });
          if (!res.ok) throw new Error(`B2 upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
          const etag = (res.headers.get("etag") || "").replace(/"/g, "");
          if (etag) etags[p.key] = etag;
        }));
      }
      return json({ ok: true, etags });
    }

    if (op === "delete") {
      const keys: unknown[] = Array.isArray(body.keys) ? body.keys.slice(0, 1000) : [];
      if (!keys.every(validKey)) return json({ error: "Bad key" }, 400);
      await deleteKeys(cfg, userRoot, keys as string[]);
      return json({ ok: true });
    }

    if (op === "deletePrefix") {
      // Everything stored for one item, e.g. media/<id>/
      const sub = String(body.prefix || "");
      if (!/^media\/[A-Za-z0-9._:\-]+\/$/.test(sub)) return json({ error: "Bad prefix" }, 400);
      const items = await listAll(cfg, userRoot + sub, userRoot);
      await deleteKeys(cfg, userRoot, items.map(i => i.key));
      return json({ ok: true, deleted: items.length });
    }

    return json({ error: "Unknown op" }, 400);
  } catch (e: any) {
    console.error("b2 function error", e);
    return json({ error: e?.message || "Storage error" }, 502);
  }
};

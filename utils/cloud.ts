import { auth } from './firebase';

// Client for the B2 storage function (netlify/functions/b2.ts). Every request
// carries the signed-in user's Firebase ID token; the function maps it to
// that user's folder in the bucket.

const ENDPOINT = '/api/b2';
// Pieces for large files: the function accepts ~6 MB per request, and binary
// bodies are base64-encoded on the way in, so stay well below that.
export const MEDIA_PIECE_BYTES = 3 * 1024 * 1024;

export class CloudError extends Error {
    constructor(message: string, public status: number, public code?: string) {
        super(message);
    }
}

export interface CloudObject {
    key: string;
    etag: string;
    size: number;
    lastModified: string;
}

// Replaceable for tests (no Firebase there)
let tokenProvider: ((force: boolean) => Promise<string>) | null = null;
export const setIdTokenProvider = (fn: ((force: boolean) => Promise<string>) | null) => { tokenProvider = fn; };

const idToken = async (force = false): Promise<string> => {
    if (tokenProvider) return tokenProvider(force);
    const user = auth?.currentUser;
    if (!user || user.isAnonymous) throw new CloudError('Sign in with Google to sync.', 401, 'sign-in-required');
    return user.getIdToken(force);
};

const request = async (init: RequestInit & { query?: string }, retry = true): Promise<Response> => {
    const token = await idToken();
    const res = await fetch(`${ENDPOINT}${init.query || ''}`, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
        // ID tokens last an hour; get a fresh one and try once more
        await idToken(true);
        return request(init, false);
    }
    if (!res.ok) {
        let body: any = {};
        try { body = await res.json(); } catch { /* not JSON */ }
        throw new CloudError(body.error || `Storage error (${res.status})`, res.status, body.code);
    }
    return res;
};

const op = async <T>(body: Record<string, unknown>): Promise<T> => {
    const res = await request({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    return res.json() as Promise<T>;
};

export const cloud = {
    ping: () => op<{ ok: boolean }>({ op: 'ping' }),

    list: async (prefix: string): Promise<CloudObject[]> => (await op<{ items: CloudObject[] }>({ op: 'list', prefix })).items,

    /** Read text objects; asks again for any the function left out (size budget). */
    getMany: async (keys: string[]): Promise<Record<string, string | null>> => {
        const out: Record<string, string | null> = {};
        let remaining = [...keys];
        for (let round = 0; remaining.length > 0 && round < 1000; round++) {
            const { items } = await op<{ items: Record<string, string | null> }>({ op: 'getMany', keys: remaining.slice(0, 200) });
            const got = Object.keys(items);
            if (got.length === 0) throw new CloudError('Storage returned nothing.', 502);
            Object.assign(out, items);
            remaining = remaining.filter(k => !(k in items));
        }
        return out;
    },

    putText: (items: { key: string; text: string; contentType?: string }[]) => op<{ ok: boolean; etags?: Record<string, string> }>({ op: 'putText', items }),

    delete: (keys: string[]) => op<{ ok: boolean }>({ op: 'delete', keys }),

    deletePrefix: (prefix: string) => op<{ ok: boolean }>({ op: 'deletePrefix', prefix }),

    putBin: async (key: string, data: Blob, type?: string): Promise<void> => {
        const q = `?op=putBin&key=${encodeURIComponent(key)}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
        await request({ method: 'POST', body: data, query: q, headers: { 'Content-Type': 'application/octet-stream' } });
    },

    getBin: async (key: string): Promise<Blob> => {
        const res = await request({ method: 'GET', query: `?op=getBin&key=${encodeURIComponent(key)}` });
        return res.blob();
    },
};

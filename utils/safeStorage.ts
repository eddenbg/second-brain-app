// Safe localStorage helpers.
// Browsers cap localStorage at roughly 5 million UTF-16 characters per origin
// (Chrome/Edge/Firefox). Exceeding it throws QuotaExceededError, which — if
// uncaught inside a React effect — unmounts the whole app.

// Conservative estimate of the per-origin limit, measured in characters.
const QUOTA_ESTIMATE_CHARS = 5_000_000;
// Start freeing space once projected usage passes this fraction of the quota.
const NEAR_QUOTA_RATIO = 0.8;

export const isQuotaExceededError = (e: unknown): boolean =>
    e instanceof DOMException && (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
        e.code === 22 ||
        e.code === 1014
    );

/** Approximate characters currently used in localStorage (keys + values). */
export const getLocalStorageUsage = (excludeKey?: string): number => {
    let total = 0;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null || key === excludeKey) continue;
            total += key.length + (localStorage.getItem(key)?.length ?? 0);
        }
    } catch {
        // Storage inaccessible (private mode etc.) — treat as empty
    }
    return total;
};

/** True if writing `value` under `key` would push usage near or over the quota. */
export const isNearQuota = (key: string, value: string): boolean =>
    getLocalStorageUsage(key) + key.length + value.length > QUOTA_ESTIMATE_CHARS * NEAR_QUOTA_RATIO;

/** setItem that never throws. Returns false if the write failed. */
export const safeSetItem = (key: string, value: string): boolean => {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn(`localStorage write failed for "${key}"`, e);
        return false;
    }
};

// Fields that can hold base64 / blob media. Never cached locally — Firestore
// stays the source of truth for them.
const MEDIA_FIELDS = ['imageDataUrl', 'audioDataUrl', 'videoDataUrl'];

const isMediaString = (v: unknown): boolean =>
    typeof v === 'string' && (v.startsWith('data:') || v.startsWith('blob:'));

/** Return a copy of `item` with raw media data removed (top level + known nested spots). */
export const stripMediaForCache = <T extends Record<string, any>>(item: T): T => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
        if (MEDIA_FIELDS.includes(k) || isMediaString(v)) continue;
        out[k] = v;
    }
    if (out.voiceNote?.audioDataUrl) {
        const { audioDataUrl, ...rest } = out.voiceNote;
        out.voiceNote = rest;
    }
    if (out.notebook?.backgroundImageUrl && isMediaString(out.notebook.backgroundImageUrl)) {
        const { backgroundImageUrl, ...rest } = out.notebook;
        out.notebook = rest;
    }
    return out as T;
};

// Device storage (IndexedDB) for a memory's large parts: recorded audio,
// photos, PDFs and very long drawings, keyed "<memoryId>:<field>". They are
// also uploaded to cloud storage (utils/cloudSync.ts); on another device they
// are downloaded on first use and kept here. The "pending" store is from the
// old Firestore setup (saves that had failed); its items are moved over once.

const DB_NAME = 'second-brain-media';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';
const PENDING_STORE = 'pendingMemories';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
            if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
};

const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
    });
};

export const putLocal = (key: string, value: unknown): Promise<void> =>
    run<IDBValidKey>(MEDIA_STORE, 'readwrite', s => s.put(value, key)).then(() => undefined);

const MEDIA_KEY = /^(.+):(audio|image|pdf|notebook|structuredTranscript|transcript|extractedText)$/;

/**
 * Read an item kept on this device. A memory's media (recording, photo, PDF,
 * big drawings) that isn't here yet is fetched from cloud storage and kept
 * here from then on — unless `localOnly` is set.
 */
export const getLocal = async <T = unknown>(key: string, opts: { localOnly?: boolean } = {}): Promise<T | undefined> => {
    const here = await run<T | undefined>(MEDIA_STORE, 'readonly', s => s.get(key)).catch(() => undefined);
    if (here !== undefined || opts.localOnly) return here;
    const m = key.match(MEDIA_KEY);
    if (!m) return undefined;
    try {
        const { syncEngine } = await import('./cloudSync');
        return (await syncEngine.fetchMedia(m[1], m[2] as any)) as T | undefined;
    } catch (e) {
        console.warn('Could not fetch from cloud storage', key, e);
        return undefined;
    }
};

export const deleteLocalFor = async (memoryId: string): Promise<void> => {
    try {
        const db = await openDb();
        await new Promise<void>((resolve) => {
            const tx = db.transaction(MEDIA_STORE, 'readwrite');
            tx.objectStore(MEDIA_STORE).delete(IDBKeyRange.bound(`${memoryId}:`, `${memoryId}:￿`));
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch { /* nothing stored */ }
};

export const localKey = (memoryId: string, field: 'audio' | 'notebook' | 'structuredTranscript' | 'image' | 'pdf') => `${memoryId}:${field}`;

// ── Failed cloud saves ─────────────────────────────────────────────────────
export const savePending = (id: string, memory: unknown): Promise<void> =>
    run<IDBValidKey>(PENDING_STORE, 'readwrite', s => s.put(memory, id)).then(() => undefined);

export const removePending = (id: string): Promise<void> =>
    run<undefined>(PENDING_STORE, 'readwrite', s => s.delete(id)).then(() => undefined).catch(() => undefined);

export const listPending = async (): Promise<Record<string, any>[]> => {
    try {
        return await run<Record<string, any>[]>(PENDING_STORE, 'readonly', s => s.getAll());
    } catch {
        return [];
    }
};

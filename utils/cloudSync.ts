import type { AnyMemory, Task, CalendarEvent } from '../types';
import { cloud, CloudError, MEDIA_PIECE_BYTES } from './cloud';
import { getLocal, putLocal, listPending } from './mediaStore';

// Keeps everything in Backblaze B2 and in sync between devices.
//
// - A full copy lives on this device (IndexedDB, one database per account), so
//   the app opens instantly and works offline.
// - Every change is written here first and queued in an outbox; the outbox is
//   sent to B2 as soon as there's a connection. Nothing is lost offline.
// - Edits remember which fields changed. If the other device changed the same
//   record meanwhile, the two are merged field by field before uploading.
// - Deleting writes a small "deleted" marker. A record missing from B2 without
//   a marker is never deleted on this device; it is uploaded again instead
//   (so a wrong setting or a cleanup in the B2 website can't wipe the device).
// - Other devices' changes are picked up every ~45 s while the app is open and
//   when it returns to the foreground (a tiny "version" object tells whether
//   anything changed; everything is re-checked at least every 5 minutes).
// - Recordings, PDFs and photos upload in their own queue, in 3 MB pieces, and
//   resume where they stopped.
//
// Layout in the bucket (per user):
//   db/memories/<id>.json  db/tasks/<id>.json  db/events/<id>.json
//   db/settings.json  db/_version  db/_migrated  db/deleted/<collection>/<id>.json
//   media/<memoryId>/<field>/index.json + part-0000, part-0001, …

export type Collection = 'memories' | 'tasks' | 'events';
export type MediaField = 'audio' | 'image' | 'pdf' | 'notebook' | 'structuredTranscript' | 'transcript' | 'extractedText';

export interface Settings {
    courses: string[];
    moodleToken: string | null;
}

export interface Snapshot {
    memories: AnyMemory[];
    tasks: Task[];
    events: CalendarEvent[];
    settings: Settings;
}

export type SyncStatus = 'starting' | 'synced' | 'syncing' | 'offline' | 'signed-out' | 'not-configured' | 'error';

export interface SyncState {
    status: SyncStatus;
    pending: number;
    message?: string;
    lastSynced?: string;
    /** This account's data has been loaded (from the device or the cloud) */
    ready: boolean;
}

interface OutboxEntry {
    id: string;              // one entry per target: a newer change replaces / extends it
    type: 'put' | 'delete' | 'media' | 'deleteMedia';
    key?: string;            // db key for put/delete
    fields?: string[] | null;// put: changed fields (null = the whole record)
    memoryId?: string;
    field?: MediaField;
    partsDone?: number;      // media: pieces already uploaded (resume)
    seq: number;
}

const POLL_MS = 45_000;
const FULL_CHECK_MS = 5 * 60_000;
const RETRY_MS = 30_000;
// Netlify functions accept ~6 MB per request
const MAX_REQUEST_BYTES = 3_500_000;
const VERSION_KEY = 'db/_version';
const MIGRATED_KEY = 'db/_migrated';
const SETTINGS_KEY = 'db/settings.json';

export const MEDIA_FIELDS: MediaField[] = ['audio', 'image', 'pdf', 'notebook', 'structuredTranscript', 'transcript', 'extractedText'];

const recordKey = (c: Collection, id: string) => `db/${c}/${id}.json`;
const tombstoneKey = (key: string) => key.replace(/^db\//, 'db/deleted/');
const parseKey = (key: string): { c: Collection; id: string } | null => {
    const m = key.match(/^db\/(memories|tasks|events)\/(.+)\.json$/);
    return m ? { c: m[1] as Collection, id: m[2] } : null;
};
const tombstoneTarget = (key: string): string | null => {
    const m = key.match(/^db\/deleted\/((memories|tasks|events)\/.+\.json)$/);
    return m ? `db/${m[1]}` : null;
};
const isDataKey = (key: string) => key === SETTINGS_KEY || !!parseKey(key);
// Ids end up in object names; keep them to safe characters
const safeId = (id: string) => /^[A-Za-z0-9._:\-]+$/.test(id);

const sortMemories = (list: AnyMemory[]) => list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const sortEvents = (list: CalendarEvent[]) => list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

// Strictly increasing, so a newer outbox entry is always told apart from an older one
let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(Date.now(), lastSeq + 1));

// ── Device database (per account) ─────────────────────────────────────────
const RECORDS = 'records';
const OUTBOX = 'outbox';
const META = 'meta';

const openAccountDb = (name: string): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const s of [RECORDS, OUTBOX, META]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

/** One transaction; resolves when it has committed. */
const tx = <T = void>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest | void): Promise<T> =>
    new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result: any;
        const req = fn(t);
        if (req) req.onsuccess = () => { result = req.result; };
        t.oncomplete = () => resolve(result as T);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });

const getAllWithKeys = (db: IDBDatabase, store: string): Promise<[string, any][]> =>
    new Promise((resolve, reject) => {
        const out: [string, any][] = [];
        const t = db.transaction(store, 'readonly');
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
            const cur = req.result;
            if (cur) { out.push([String(cur.key), cur.value]); cur.continue(); }
        };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
    });

/** Add or extend the outbox entry for a record (inside an open transaction). */
const mergeOutboxPut = (outbox: IDBObjectStore, key: string, fields: string[] | null) => {
    const id = `put:${key}`;
    const req = outbox.get(id);
    req.onsuccess = () => {
        const prev = req.result as OutboxEntry | undefined;
        let merged: string[] | null = fields;
        if (prev && prev.type === 'put') {
            merged = prev.fields == null || fields == null ? null : Array.from(new Set([...prev.fields, ...fields]));
        }
        // After a pending delete, a put means the record is back as a whole
        outbox.put({ id, type: 'put', key, fields: merged, seq: nextSeq() } as OutboxEntry, id);
    };
};

// ── Media (recordings, photos, PDFs, big drawings) ────────────────────────
type MediaKind = 'dataurl' | 'blob' | 'json' | 'text';

const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

const toUploadable = async (value: unknown): Promise<{ blob: Blob; kind: MediaKind; type: string } | null> => {
    if (value == null) return null;
    if (typeof value === 'string' && value.startsWith('data:')) {
        const blob = await (await fetch(value)).blob();
        return { blob, kind: 'dataurl', type: blob.type || value.slice(5, value.indexOf(';')) || 'application/octet-stream' };
    }
    if (typeof value === 'string') return { blob: new Blob([value], { type: 'text/plain' }), kind: 'text', type: 'text/plain' };
    if (typeof Blob !== 'undefined' && value instanceof Blob) return { blob: value, kind: 'blob', type: value.type || 'application/octet-stream' };
    return { blob: new Blob([JSON.stringify(value)], { type: 'application/json' }), kind: 'json', type: 'application/json' };
};

const fromDownloaded = async (blob: Blob, kind: MediaKind): Promise<unknown> => {
    if (kind === 'dataurl') return blobToDataUrl(blob);
    if (kind === 'text') return blob.text();
    if (kind === 'json') return JSON.parse(await blob.text());
    return blob;
};

const mediaBase = (memoryId: string, field: MediaField) => `media/${memoryId}/${field}`;
const partKey = (base: string, p: number) => `${base}/part-${String(p).padStart(4, '0')}`;

const FLAG_FIELDS: [string, MediaField][] = [
    ['localMedia', 'audio'], ['localImage', 'image'], ['localPdf', 'pdf'],
    ['localNotebook', 'notebook'], ['localStructuredTranscript', 'structuredTranscript'],
];

/** Which of a memory's parts may be in the device media store. */
const mediaFieldsOf = (m: any): MediaField[] => [
    ...FLAG_FIELDS.filter(([flag]) => m?.[flag]).map(([, f]) => f),
    'transcript', 'extractedText', // full text of very long ones (no flag)
];

export class SyncEngine {
    /** `dbPrefix` lets tests run two "devices" side by side */
    constructor(private dbPrefix = 'second-brain-data') {}

    private uid: string | null = null;
    private db: IDBDatabase | null = null;
    private canUseCloud = false;
    private migrated = false;
    private listeners = new Set<(s: Snapshot) => void>();
    private stateListeners = new Set<(s: SyncState) => void>();
    private state: SyncState = { status: 'starting', pending: 0, ready: false };
    private snapshot: Snapshot = { memories: [], tasks: [], events: [], settings: { courses: [], moodleToken: null } };
    private etags: Record<string, string> = {};
    private lastVersion: string | null = null;
    private lastFullCheck = 0;
    private flushing: Promise<void> | null = null;
    private mediaFlushing: Promise<void> | null = null;
    private pulling: Promise<void> | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private syncSoonTimer: ReturnType<typeof setTimeout> | null = null;
    private mediaDownloads = new Map<string, Promise<unknown>>();
    private mediaSynced = new Set<string>();
    private startToken = 0;

    // ── Lifecycle ──────────────────────────────────────────────────────────
    /** Open this account's data. `cloudEnabled` is false for a guest (anonymous) session. */
    async start(uid: string, cloudEnabled: boolean): Promise<void> {
        if (this.uid === uid && this.canUseCloud === cloudEnabled && this.db) return;
        const token = ++this.startToken;
        this.stopTimers();
        if (this.uid !== uid) {
            const previous = this.uid && this.db && !this.canUseCloud
                ? { db: this.db, name: `${this.dbPrefix}-${this.uid}` }
                : null;
            const db = await openAccountDb(`${this.dbPrefix}-${uid}`);
            if (token !== this.startToken) { db.close(); return; }
            if (this.db && this.db !== previous?.db) this.db.close();
            this.db = db;
            this.uid = uid;
            this.setState({ ready: false, status: 'starting', message: undefined });
            this.etags = (await this.getMeta<Record<string, string>>('etags')) || {};
            this.lastVersion = (await this.getMeta<string>('version')) || null;
            this.mediaSynced = new Set((await this.getMeta<string[]>('mediaSynced')) || []);
            this.migrated = !!(await this.getMeta<boolean>('migrated'));
            this.lastFullCheck = 0;
            await this.loadSnapshot();
            // Things made as a guest before signing in move into this account
            if (previous && cloudEnabled) await this.adoptGuestData(previous.db, previous.name);
            else previous?.db.close();
        }
        if (token !== this.startToken) return;
        this.canUseCloud = cloudEnabled;
        if (!cloudEnabled) {
            this.setState({ status: 'signed-out', ready: true });
            return;
        }
        this.setState({ status: 'syncing' });
        this.pollTimer = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.syncNow();
        }, POLL_MS);
        void this.firstSync(token);
    }

    stop(): void {
        this.stopTimers();
        this.canUseCloud = false;
    }

    private stopTimers() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.pollTimer = null;
        this.retryTimer = null;
    }

    private hasData() {
        return this.snapshot.memories.length + this.snapshot.tasks.length + this.snapshot.events.length > 0;
    }

    private async firstSync(token: number) {
        let ok = false;
        try {
            await this.pull(true);
            if (token !== this.startToken) return;
            await this.migrateIfNeeded();
            await this.importOldPendingSaves();
            await this.queueUnsyncedMedia();
            ok = true;
            await this.applyStoredPatches();
            await this.flush();
            void this.flushMedia();
        } catch (e) {
            this.handleError(e);
        } finally {
            // Not ready until the cloud copy has been read and the old data copied
            // (or this device already has data), so a first start offline keeps
            // showing the last-known list instead of an empty one
            if (token === this.startToken && (ok || this.hasData())) this.setState({ ready: true });
        }
    }

    /** Send pending changes, then fetch other devices' changes. */
    async syncNow(force = false): Promise<void> {
        if (!this.canUseCloud || !this.db) return;
        try {
            await this.flush();
            await this.pull(force);
            if (!this.migrated) await this.migrateIfNeeded();
            void this.flushMedia();
        } catch (e) {
            this.handleError(e);
        }
    }

    subscribe(fn: (s: Snapshot) => void): () => void {
        this.listeners.add(fn);
        fn(this.snapshot);
        return () => { this.listeners.delete(fn); };
    }

    subscribeState(fn: (s: SyncState) => void): () => void {
        this.stateListeners.add(fn);
        fn(this.state);
        return () => { this.stateListeners.delete(fn); };
    }

    getSnapshot(): Snapshot { return this.snapshot; }

    isReady(): boolean { return this.state.ready; }

    private setState(changes: Partial<SyncState>) {
        this.state = { ...this.state, ...changes };
        this.stateListeners.forEach(fn => fn(this.state));
    }

    private emit() {
        this.snapshot = { ...this.snapshot };
        this.listeners.forEach(fn => fn(this.snapshot));
    }

    private handleError(e: unknown) {
        const err = e as CloudError;
        if (err?.code === 'not-configured') {
            this.setState({ status: 'not-configured', message: err.message });
        } else if (err?.code === 'sign-in-required' || err?.code === 'not-allowed') {
            this.setState({ status: 'signed-out', message: err.message });
        } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            this.setState({ status: 'offline', message: 'Offline — changes are kept on this device and sync when you reconnect.' });
        } else {
            console.warn('Sync failed', e);
            this.setState({ status: 'error', message: (err?.message || 'Sync failed') + ' — will retry.' });
        }
        if (this.canUseCloud && !this.retryTimer) {
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                void (this.state.ready ? this.syncNow() : this.firstSync(this.startToken));
            }, RETRY_MS);
        }
    }

    // ── Device database helpers ────────────────────────────────────────────
    private getMeta<T>(key: string): Promise<T | undefined> {
        return tx<T>(this.db!, META, 'readonly', t => t.objectStore(META).get(key));
    }
    private setMeta(key: string, value: unknown): Promise<void> {
        return tx<void>(this.db!, META, 'readwrite', t => { t.objectStore(META).put(value, key); });
    }

    private async loadSnapshot() {
        const rows = await getAllWithKeys(this.db!, RECORDS);
        const snap: Snapshot = { memories: [], tasks: [], events: [], settings: { courses: [], moodleToken: null } };
        for (const [key, value] of rows) {
            if (key === SETTINGS_KEY) { snap.settings = { courses: value?.courses || [], moodleToken: value?.moodleToken ?? null }; continue; }
            const p = parseKey(key);
            if (p) (snap[p.c] as any[]).push(value);
        }
        sortMemories(snap.memories);
        sortEvents(snap.events);
        this.snapshot = snap;
        await this.refreshPending();
        this.emit();
    }

    private recordFromSnapshot(key: string): any | undefined {
        if (key === SETTINGS_KEY) return this.snapshot.settings;
        const p = parseKey(key);
        return p ? (this.snapshot[p.c] as any[]).find(r => r.id === p.id) : undefined;
    }

    private applyLocal(key: string, value: any | null) {
        const snap = this.snapshot;
        if (key === SETTINGS_KEY) {
            snap.settings = { courses: value?.courses || [], moodleToken: value?.moodleToken ?? null };
            return;
        }
        const p = parseKey(key);
        if (!p) return;
        const list = (snap[p.c] as any[]).filter(r => r.id !== p.id);
        if (value) list.push(value);
        if (p.c === 'memories') snap.memories = sortMemories(list);
        else if (p.c === 'events') snap.events = sortEvents(list);
        else snap.tasks = list;
    }

    private async refreshPending() {
        if (!this.db) return;
        this.setState({ pending: (await getAllWithKeys(this.db, OUTBOX)).length });
    }

    // ── Changes made in the app ────────────────────────────────────────────
    private async writeRecord(key: string, value: any, fields: string[] | null) {
        if (!this.db) throw new Error('Storage is not ready yet.');
        // Visible at once (also to an update() that runs before this finishes)
        this.applyLocal(key, value);
        this.emit();
        await tx(this.db, [RECORDS, OUTBOX], 'readwrite', t => {
            t.objectStore(RECORDS).put(value, key);
            mergeOutboxPut(t.objectStore(OUTBOX), key, fields);
        });
        await this.refreshPending();
        this.syncSoon();
    }

    private syncSoon() {
        if (!this.canUseCloud) return;
        if (this.syncSoonTimer) clearTimeout(this.syncSoonTimer);
        // Small delay so a burst of changes goes out together
        this.syncSoonTimer = setTimeout(() => {
            this.syncSoonTimer = null;
            void this.flush().then(() => this.flushMedia()).catch(e => this.handleError(e));
        }, 300);
    }

    put(c: Collection, record: { id: string }): Promise<void> {
        if (!safeId(record.id)) return Promise.reject(new Error(`Invalid id: ${record.id}`));
        return this.writeRecord(recordKey(c, record.id), stripUndefined(record), null);
    }

    async update(c: Collection, id: string, changes: Record<string, unknown>): Promise<void> {
        const key = recordKey(c, id);
        const current = this.recordFromSnapshot(key);
        if (!current) {
            // Not loaded yet (first start offline): keep the change and apply it
            // once the record arrives
            if (!this.db) return;
            const patches = (await this.getMeta<Record<string, any>>('patches')) || {};
            patches[key] = { ...(patches[key] || {}), ...changes };
            await this.setMeta('patches', patches);
            return;
        }
        return this.writeRecord(key, stripUndefined({ ...current, ...changes }), Object.keys(changes));
    }

    async remove(c: Collection, id: string): Promise<void> {
        if (!this.db) throw new Error('Storage is not ready yet.');
        const key = recordKey(c, id);
        this.applyLocal(key, null);
        this.emit();
        await tx(this.db, [RECORDS, OUTBOX], 'readwrite', t => {
            t.objectStore(RECORDS).delete(key);
            t.objectStore(OUTBOX).put({ id: `put:${key}`, type: 'delete', key, seq: nextSeq() } as OutboxEntry, `put:${key}`);
        });
        await this.refreshPending();
        this.syncSoon();
    }

    async putSettings(changes: Partial<Settings>): Promise<void> {
        return this.writeRecord(SETTINGS_KEY, stripUndefined({ ...this.snapshot.settings, ...changes }), Object.keys(changes));
    }

    /** Queue a memory's media (kept on this device) for upload. */
    async queueMedia(memoryId: string, fields: MediaField[]): Promise<void> {
        if (!this.db) return;
        await tx(this.db, OUTBOX, 'readwrite', t => {
            for (const field of fields) {
                const id = `media:${memoryId}:${field}`;
                t.objectStore(OUTBOX).put({ id, type: 'media', memoryId, field, partsDone: 0, seq: nextSeq() } as OutboxEntry, id);
            }
        });
        await this.refreshPending();
        this.syncSoon();
    }

    async deleteMedia(memoryId: string): Promise<void> {
        if (!this.db) return;
        await tx(this.db, OUTBOX, 'readwrite', t => {
            const store = t.objectStore(OUTBOX);
            // No point uploading what is being deleted
            for (const f of MEDIA_FIELDS) store.delete(`media:${memoryId}:${f}`);
            store.put({ id: `media-delete:${memoryId}`, type: 'deleteMedia', memoryId, seq: nextSeq() } as OutboxEntry, `media-delete:${memoryId}`);
        });
        await this.refreshPending();
        this.syncSoon();
    }

    private async applyStoredPatches() {
        const patches = (await this.getMeta<Record<string, any>>('patches')) || {};
        const keys = Object.keys(patches);
        if (!keys.length) return;
        for (const key of keys) {
            const current = this.recordFromSnapshot(key);
            if (current) await this.writeRecord(key, stripUndefined({ ...current, ...patches[key] }), Object.keys(patches[key]));
        }
        await this.setMeta('patches', {});
    }

    // ── Sending records ────────────────────────────────────────────────────
    flush(): Promise<void> {
        if (!this.canUseCloud || !this.db) return Promise.resolve();
        if (!this.flushing) this.flushing = this.doFlush().finally(() => { this.flushing = null; });
        return this.flushing;
    }

    private async doFlush() {
        const db = this.db!;
        const entries = (await getAllWithKeys(db, OUTBOX))
            .map(([, v]) => v as OutboxEntry)
            .filter(e => e.type === 'put' || e.type === 'delete' || e.type === 'deleteMedia')
            .sort((a, b) => a.seq - b.seq);
        if (entries.length === 0) return;
        this.setState({ status: 'syncing' });

        const records = entries.filter(e => e.type === 'put' || e.type === 'delete');
        if (records.length) {
            await this.mergeRemoteEdits(records);

            const puts: { key: string; text: string }[] = [];
            const deletes: string[] = [];
            for (const e of records) {
                if (e.type === 'delete') { deletes.push(e.key!); continue; }
                const value = await tx<any>(db, RECORDS, 'readonly', t => t.objectStore(RECORDS).get(e.key!));
                if (value === undefined) continue;
                puts.push({ key: e.key!, text: JSON.stringify(value) });
            }

            // Several requests if needed: each stays under the function's size limit
            const written: Record<string, string> = {};
            let chunk: typeof puts = [];
            let size = 0;
            const send = async () => {
                if (!chunk.length) return;
                Object.assign(written, (await cloud.putText(chunk)).etags || {});
                chunk = [];
                size = 0;
            };
            for (const p of puts) {
                const bytes = new Blob([p.text]).size;
                if (chunk.length && size + bytes > MAX_REQUEST_BYTES) await send();
                chunk.push(p);
                size += bytes;
            }
            await send();

            if (deletes.length) {
                // The marker first: other devices delete only what has a marker
                const at = new Date().toISOString();
                await cloud.putText(deletes.map(k => ({ key: tombstoneKey(k), text: JSON.stringify({ at }) })));
                await cloud.delete(deletes);
            }

            // Remember which version is ours, so it isn't downloaded again — and a
            // later change from another device is still noticed
            for (const p of puts) {
                if (written[p.key]) this.etags[p.key] = written[p.key];
                else delete this.etags[p.key];
            }
            for (const k of deletes) delete this.etags[k];
            await this.removeSent(records);
            await this.bumpVersion();
            await this.setMeta('etags', this.etags);
        }

        for (const e of entries.filter(e => e.type === 'deleteMedia')) {
            await cloud.deletePrefix(`media/${e.memoryId}/`);
            for (const f of MEDIA_FIELDS) this.mediaSynced.delete(`${e.memoryId}:${f}`);
            await this.setMeta('mediaSynced', [...this.mediaSynced]);
            await this.removeSent([e]);
        }

        await this.refreshPending();
        this.setState({ status: 'synced', message: undefined, lastSynced: new Date().toISOString() });
    }

    /**
     * Before uploading edits: if the other device changed the same record since
     * we last saw it, start from its version and re-apply only our changed fields.
     */
    private async mergeRemoteEdits(records: OutboxEntry[]) {
        const db = this.db!;
        const edits = records.filter(e => e.type === 'put' && e.fields && this.etags[e.key!]);
        if (!edits.length) return;
        const remote = new Map((await cloud.list('db/')).map(i => [i.key, i.etag]));
        const changed = edits.filter(e => remote.has(e.key!) && remote.get(e.key!) !== this.etags[e.key!]);
        if (!changed.length) return;
        const texts = await cloud.getMany(changed.map(e => e.key!));
        for (const e of changed) {
            const text = texts[e.key!];
            if (!text) continue;
            let theirs: any;
            try { theirs = JSON.parse(text); } catch { continue; }
            const ours = await tx<any>(db, RECORDS, 'readonly', t => t.objectStore(RECORDS).get(e.key!));
            if (!ours) continue;
            const merged: any = { ...theirs };
            for (const f of e.fields!) merged[f] = ours[f];
            await tx(db, RECORDS, 'readwrite', t => { t.objectStore(RECORDS).put(stripUndefined(merged), e.key!); });
            this.applyLocal(e.key!, merged);
            this.etags[e.key!] = remote.get(e.key!)!;
        }
        this.emit();
    }

    private async removeSent(sent: OutboxEntry[]) {
        await tx(this.db!, OUTBOX, 'readwrite', t => {
            const store = t.objectStore(OUTBOX);
            for (const e of sent) {
                const req = store.get(e.id);
                // Keep entries that were replaced by a newer change meanwhile
                req.onsuccess = () => { if (req.result && req.result.seq === e.seq) store.delete(e.id); };
            }
        });
    }

    private async bumpVersion() {
        // If someone else changed things since our last look, don't treat the
        // new version as "already seen" — the next check lists everything
        const { [VERSION_KEY]: current } = await cloud.getMany([VERSION_KEY]);
        const v = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await cloud.putText([{ key: VERSION_KEY, text: v, contentType: 'text/plain' }]);
        this.lastVersion = (current ?? null) === this.lastVersion ? v : null;
        await this.setMeta('version', this.lastVersion);
    }

    // ── Sending media (own queue, so big uploads don't hold up notes) ──────
    flushMedia(): Promise<void> {
        if (!this.canUseCloud || !this.db) return Promise.resolve();
        if (!this.mediaFlushing) {
            this.mediaFlushing = this.doFlushMedia()
                .catch(e => this.handleError(e))
                .finally(() => { this.mediaFlushing = null; });
        }
        return this.mediaFlushing;
    }

    private async doFlushMedia() {
        for (;;) {
            const next = (await getAllWithKeys(this.db!, OUTBOX))
                .map(([, v]) => v as OutboxEntry)
                .filter(e => e.type === 'media')
                .sort((a, b) => a.seq - b.seq)[0];
            if (!next || !this.canUseCloud) return;
            await this.uploadMedia(next);
            await this.removeSent([next]);
            await this.refreshPending();
        }
    }

    private async uploadMedia(entry: OutboxEntry) {
        const memoryId = entry.memoryId!;
        const field = entry.field!;
        if (!safeId(memoryId)) return;
        const value = await getLocal<unknown>(`${memoryId}:${field}`, { localOnly: true });
        const up = await toUploadable(value);
        if (!up) return; // not on this device (another device uploads it)
        const base = mediaBase(memoryId, field);
        const parts = Math.max(1, Math.ceil(up.blob.size / MEDIA_PIECE_BYTES));
        for (let p = entry.partsDone || 0; p < parts; p++) {
            await cloud.putBin(partKey(base, p), up.blob.slice(p * MEDIA_PIECE_BYTES, (p + 1) * MEDIA_PIECE_BYTES), 'application/octet-stream');
            // Remember progress, so an interrupted upload resumes here
            await tx(this.db!, OUTBOX, 'readwrite', t => {
                const store = t.objectStore(OUTBOX);
                const req = store.get(entry.id);
                req.onsuccess = () => {
                    if (req.result && req.result.seq === entry.seq) store.put({ ...req.result, partsDone: p + 1 }, entry.id);
                };
            });
        }
        // The index goes last: a reader only sees complete files
        await cloud.putText([{ key: `${base}/index.json`, text: JSON.stringify({ kind: up.kind, type: up.type, size: up.blob.size, parts }) }]);
        this.mediaSynced.add(`${memoryId}:${field}`);
        await this.setMeta('mediaSynced', [...this.mediaSynced]);
    }

    /** Fetch a memory's media from B2 (used when it isn't on this device). */
    fetchMedia(memoryId: string, field: MediaField): Promise<unknown> {
        const id = `${memoryId}:${field}`;
        let p = this.mediaDownloads.get(id);
        if (!p) {
            p = this.downloadMedia(memoryId, field).finally(() => this.mediaDownloads.delete(id));
            this.mediaDownloads.set(id, p);
        }
        return p;
    }

    private async downloadMedia(memoryId: string, field: MediaField): Promise<unknown> {
        if (!this.canUseCloud || !safeId(memoryId)) return undefined;
        const base = mediaBase(memoryId, field);
        const { [`${base}/index.json`]: indexText } = await cloud.getMany([`${base}/index.json`]);
        if (!indexText) return undefined;
        const index = JSON.parse(indexText) as { kind: MediaKind; type: string; parts: number };
        const pieces: Blob[] = [];
        for (let p = 0; p < index.parts; p++) pieces.push(await cloud.getBin(partKey(base, p)));
        const value = await fromDownloaded(new Blob(pieces, { type: index.type }), index.kind);
        // Keep it on this device from now on (and don't upload it back)
        await putLocal(`${memoryId}:${field}`, value).catch(() => {});
        this.mediaSynced.add(`${memoryId}:${field}`);
        if (this.db) void this.setMeta('mediaSynced', [...this.mediaSynced]);
        return value;
    }

    /** Media saved on this device before cloud sync existed: upload it once. */
    private async queueUnsyncedMedia() {
        for (const m of this.snapshot.memories as any[]) {
            const fields: MediaField[] = [];
            for (const field of mediaFieldsOf(m)) {
                if (this.mediaSynced.has(`${m.id}:${field}`)) continue;
                if (await getLocal(`${m.id}:${field}`, { localOnly: true }) !== undefined) fields.push(field);
            }
            if (fields.length) await this.queueMedia(m.id, fields);
        }
    }

    // ── Receiving ──────────────────────────────────────────────────────────
    private pull(force: boolean): Promise<void> {
        if (!this.canUseCloud || !this.db) return Promise.resolve();
        if (!this.pulling) this.pulling = this.doPull(force).finally(() => { this.pulling = null; });
        return this.pulling;
    }

    private async doPull(force: boolean) {
        const db = this.db!;
        const fullDue = Date.now() - this.lastFullCheck > FULL_CHECK_MS;
        if (!force && !fullDue && this.lastVersion) {
            const { [VERSION_KEY]: v } = await cloud.getMany([VERSION_KEY]);
            if (v && v === this.lastVersion) {
                this.setState({ status: this.state.pending ? this.state.status : 'synced', message: undefined, lastSynced: new Date().toISOString() });
                return;
            }
        }
        this.setState({ status: 'syncing' });
        const remote = await cloud.list('db/');
        this.lastFullCheck = Date.now();

        const remoteEtag = new Map<string, string>();
        const tombstones = new Set<string>();
        let sentinel = false;
        for (const item of remote) {
            if (item.key === MIGRATED_KEY) sentinel = true;
            const target = tombstoneTarget(item.key);
            if (target) { tombstones.add(target); continue; }
            if (isDataKey(item.key)) remoteEtag.set(item.key, item.etag);
        }
        const toFetch = [...remoteEtag].filter(([k, etag]) => !tombstones.has(k) && this.etags[k] !== etag).map(([k]) => k);
        const { [VERSION_KEY]: version } = remote.some(i => i.key === VERSION_KEY) ? await cloud.getMany([VERSION_KEY]) : { [VERSION_KEY]: null };

        const texts = toFetch.length ? await cloud.getMany(toFetch) : {};
        let changed = false;
        const reupload: string[] = [];

        // One transaction over records + outbox: a change made on this device
        // meanwhile (it has an outbox entry) always wins over the download
        await tx(db, [RECORDS, OUTBOX], 'readwrite', t => {
            const records = t.objectStore(RECORDS);
            const outbox = t.objectStore(OUTBOX);
            for (const key of toFetch) {
                const text = texts[key];
                if (text == null) continue;
                let value: any;
                try { value = JSON.parse(text); } catch (e) { console.warn('Skipping unreadable record', key, e); continue; }
                const pending = outbox.get(`put:${key}`);
                pending.onsuccess = () => {
                    if (pending.result) return; // ours is newer; the upload merges
                    records.put(value, key);
                    this.applyLocal(key, value);
                    this.etags[key] = remoteEtag.get(key)!;
                    changed = true;
                };
            }
            // Deleted on another device (it left a marker)
            for (const key of tombstones) {
                const pending = outbox.get(`put:${key}`);
                pending.onsuccess = () => {
                    if (pending.result) return;
                    if (this.recordFromSnapshot(key)) {
                        records.delete(key);
                        this.applyLocal(key, null);
                        changed = true;
                    }
                    delete this.etags[key];
                };
            }
            // Seen in the cloud before, now missing without a marker: the cloud
            // lost it (wrong settings, manual cleanup). Keep ours and upload again.
            if (sentinel) {
                for (const key of Object.keys(this.etags)) {
                    if (remoteEtag.has(key) || tombstones.has(key)) continue;
                    delete this.etags[key];
                    if (this.recordFromSnapshot(key)) {
                        reupload.push(key);
                        mergeOutboxPut(outbox, key, null);
                    }
                }
            }
        });
        if (reupload.length) console.warn('Re-uploading records missing from cloud storage', reupload);

        if (version) { this.lastVersion = version; await this.setMeta('version', version); }
        await this.setMeta('etags', this.etags);
        if (changed) this.emit();
        await this.refreshPending();
        if (reupload.length) this.syncSoon();
        this.setState({ status: this.state.pending ? 'syncing' : 'synced', message: undefined, lastSynced: new Date().toISOString() });
    }

    // ── Moving in from the old setup ───────────────────────────────────────
    /** One-time copy of the old Firestore data (by whichever device opens first). */
    private async migrateIfNeeded() {
        if (this.migrated) return;
        const marker = await cloud.getMany([MIGRATED_KEY]);
        if (marker[MIGRATED_KEY]) {
            this.migrated = true;
            await this.setMeta('migrated', true);
            return;
        }
        this.setState({ status: 'syncing', message: 'Copying your existing notes to cloud storage…' });
        const old = legacyReader
            ? await legacyReader(this.uid!)
            : await (await import('./firestoreExport')).readFirestoreData(this.uid!);
        const outboxKeys = new Set((await getAllWithKeys(this.db!, OUTBOX)).map(([k]) => k));
        // Never overwrite anything newer: what's in the cloud, on this device, or waiting to upload
        const skip = (key: string) => !!this.etags[key] || !!this.recordFromSnapshot(key) || outboxKeys.has(`put:${key}`);
        let copied = 0;
        for (const c of ['memories', 'tasks', 'events'] as Collection[]) {
            for (const record of old[c] as any[]) {
                if (!record?.id || !safeId(String(record.id))) continue;
                const key = recordKey(c, String(record.id));
                if (skip(key)) continue;
                const value = stripUndefined(record);
                this.applyLocal(key, value);
                await tx(this.db!, [RECORDS, OUTBOX], 'readwrite', t => {
                    t.objectStore(RECORDS).put(value, key);
                    mergeOutboxPut(t.objectStore(OUTBOX), key, null);
                });
                copied++;
            }
        }
        if (old.settings) {
            const merged = {
                courses: Array.from(new Set([...(this.snapshot.settings.courses || []), ...(old.settings.courses || [])])),
                moodleToken: this.snapshot.settings.moodleToken || old.settings.moodleToken || null,
            };
            this.applyLocal(SETTINGS_KEY, merged);
            await tx(this.db!, [RECORDS, OUTBOX], 'readwrite', t => {
                t.objectStore(RECORDS).put(merged, SETTINGS_KEY);
                mergeOutboxPut(t.objectStore(OUTBOX), SETTINGS_KEY, null);
            });
        }
        this.emit();
        await this.refreshPending();
        await this.flush();
        await cloud.putText([{ key: MIGRATED_KEY, text: JSON.stringify({ at: new Date().toISOString(), copied }) }]);
        this.migrated = true;
        await this.setMeta('migrated', true);
        this.setState({ message: undefined });
    }

    /** Saves that had failed under the old setup, kept on this device: bring them in (each device once). */
    private async importOldPendingSaves() {
        if (await this.getMeta<boolean>('pendingImported')) return;
        const pending = (await (legacyPendingReader ?? listPending)()) as any[];
        for (const m of pending) {
            if (!m?.id || !safeId(String(m.id))) continue;
            const key = recordKey('memories', String(m.id));
            if (this.etags[key] || this.recordFromSnapshot(key)) continue;
            await this.writeRecord(key, stripUndefined(m), null);
        }
        await this.setMeta('pendingImported', true);
    }

    /** Things made in a guest session before signing in move into this account. */
    private async adoptGuestData(guestDb: IDBDatabase, guestName: string) {
        try {
            const rows = await getAllWithKeys(guestDb, RECORDS);
            for (const [key, value] of rows) {
                if (!isDataKey(key) || this.recordFromSnapshot(key)) continue;
                await this.writeRecord(key, value, null);
                if (parseKey(key)?.c === 'memories') await this.queueMedia(value.id, mediaFieldsOf(value));
            }
            guestDb.close();
            if (rows.length) indexedDB.deleteDatabase(guestName);
        } catch (e) {
            console.warn('Could not move guest data into the account', e);
        }
    }
}

/** Copy without undefined fields at any depth (B2 stores JSON; keeps records tidy). */
export const stripUndefined = (value: any): any => {
    if (Array.isArray(value)) return value.filter(v => v !== undefined).map(stripUndefined);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
        return out;
    }
    return value;
};

// Replaceable for tests (no Firestore there)
let legacyReader: ((uid: string) => Promise<import('./firestoreExport').FirestoreData>) | null = null;
let legacyPendingReader: (() => Promise<Record<string, any>[]>) | null = null;
export const setLegacyReader = (fn: typeof legacyReader, pendingFn?: typeof legacyPendingReader) => {
    legacyReader = fn;
    if (pendingFn !== undefined) legacyPendingReader = pendingFn;
};

export const syncEngine = new SyncEngine();

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { void syncEngine.syncNow(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void syncEngine.syncNow();
    });
}

import type { AnyMemory, Task, CalendarEvent } from '../types';
import { cloud, CloudError, MEDIA_PIECE_BYTES } from './cloud';
import { getLocal, putLocal } from './mediaStore';

// Keeps everything in Backblaze B2 and in sync between devices.
//
// - A full copy lives on this device (IndexedDB, one database per account), so
//   the app opens instantly and works offline.
// - Every change is written here first and queued in an outbox; the outbox is
//   sent to B2 as soon as there's a connection. Nothing is lost offline.
// - Other devices' changes are picked up every ~45 s while the app is open,
//   and when it comes back to the foreground: a small "version" object tells
//   whether anything changed; if so, the changed records are fetched.
//
// Layout in the bucket (per user):
//   db/memories/<id>.json  db/tasks/<id>.json  db/events/<id>.json
//   db/settings.json       db/_version          db/_migrated
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
    /** First load (including copying old data over) finished */
    ready: boolean;
}

interface OutboxEntry {
    id: string;          // unique per target, so a newer change replaces an older one
    type: 'put' | 'delete' | 'media' | 'deleteMedia';
    key?: string;        // db key for put/delete
    memoryId?: string;
    field?: MediaField;
    at: number;
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
const parseKey = (key: string): { c: Collection; id: string } | null => {
    const m = key.match(/^db\/(memories|tasks|events)\/(.+)\.json$/);
    return m ? { c: m[1] as Collection, id: m[2] } : null;
};
// Ids end up in object names; keep them to safe characters
const safeId = (id: string) => /^[A-Za-z0-9._:\-]+$/.test(id);

const sortMemories = (list: AnyMemory[]) => list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const sortEvents = (list: CalendarEvent[]) => list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

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

const tx = <T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> =>
    new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        let result: any;
        const req = fn(t.objectStore(store));
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

export class SyncEngine {
    /** `dbPrefix` lets tests run two "devices" side by side */
    constructor(private dbPrefix = 'second-brain-data') {}

    private uid: string | null = null;
    private db: IDBDatabase | null = null;
    private canUseCloud = false;
    private listeners = new Set<(s: Snapshot) => void>();
    private stateListeners = new Set<(s: SyncState) => void>();
    private state: SyncState = { status: 'starting', pending: 0, ready: false };
    private snapshot: Snapshot = { memories: [], tasks: [], events: [], settings: { courses: [], moodleToken: null } };
    private etags: Record<string, string> = {};
    private lastVersion: string | null = null;
    private lastFullCheck = 0;
    private flushing: Promise<void> | null = null;
    private pulling: Promise<void> | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
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
            this.db?.close();
            this.db = await openAccountDb(`${this.dbPrefix}-${uid}`);
            if (token !== this.startToken) return;
            this.uid = uid;
            this.etags = (await this.getMeta<Record<string, string>>('etags')) || {};
            this.lastVersion = (await this.getMeta<string>('version')) || null;
            this.mediaSynced = new Set((await this.getMeta<string[]>('mediaSynced')) || []);
            await this.loadSnapshot();
        }
        this.canUseCloud = cloudEnabled;
        this.setState({ status: cloudEnabled ? 'syncing' : 'signed-out', ready: !cloudEnabled || this.state.ready });
        if (!cloudEnabled) return;

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

    private async firstSync(token: number) {
        let ok = false;
        try {
            await this.pull(true);
            if (token !== this.startToken) return;
            try {
                await this.migrateIfNeeded();
            } catch (e) {
                // Tried again next time the app opens; new changes still sync
                console.warn('Copying old data to cloud storage failed', e);
            }
            await this.queueUnsyncedMedia();
            ok = true;
            await this.flush();
        } catch (e) {
            this.handleError(e);
        } finally {
            // Not ready until the cloud copy has been read at least once (or this
            // device already has data), so a first start offline keeps showing
            // the last-known list instead of an empty one
            const hasLocal = this.snapshot.memories.length + this.snapshot.tasks.length + this.snapshot.events.length > 0;
            if (token === this.startToken && (ok || hasLocal)) this.setState({ ready: true });
        }
    }

    /** Send pending changes, then fetch other devices' changes. */
    async syncNow(force = false): Promise<void> {
        if (!this.canUseCloud) return;
        try {
            await this.flush();
            await this.pull(force);
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
        if (this.canUseCloud && !this.retryTimer && err?.code !== 'not-configured') {
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                void (this.state.ready ? this.syncNow() : this.firstSync(this.startToken));
            }, RETRY_MS);
        }
    }

    // ── Device database helpers ────────────────────────────────────────────
    private getMeta<T>(key: string): Promise<T | undefined> {
        return tx<T>(this.db!, META, 'readonly', s => s.get(key));
    }
    private setMeta(key: string, value: unknown): Promise<void> {
        return tx<void>(this.db!, META, 'readwrite', s => s.put(value, key));
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
        this.setState({ pending: (await getAllWithKeys(this.db!, OUTBOX)).length });
        this.emit();
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

    private async enqueue(entry: Omit<OutboxEntry, 'at'>) {
        await tx<void>(this.db!, OUTBOX, 'readwrite', s => s.put({ ...entry, at: Date.now() }, entry.id));
    }

    private async refreshPending() {
        this.setState({ pending: (await getAllWithKeys(this.db!, OUTBOX)).length });
    }

    // ── Changes made in the app ────────────────────────────────────────────
    private async writeRecord(key: string, value: any) {
        if (!this.db) throw new Error('Storage is not ready yet.');
        await this.enqueue({ id: `put:${key}`, type: 'put', key });
        await tx<void>(this.db, RECORDS, 'readwrite', s => { s.put(value, key); });
        this.applyLocal(key, value);
        this.emit();
        await this.refreshPending();
        void this.syncSoon();
    }

    private async removeRecord(key: string) {
        if (!this.db) throw new Error('Storage is not ready yet.');
        await this.enqueue({ id: `put:${key}`, type: 'delete', key });
        await tx<void>(this.db, RECORDS, 'readwrite', s => { s.delete(key); });
        this.applyLocal(key, null);
        this.emit();
        await this.refreshPending();
        void this.syncSoon();
    }

    private syncSoonTimer: ReturnType<typeof setTimeout> | null = null;
    private syncSoon() {
        if (!this.canUseCloud) return;
        if (this.syncSoonTimer) clearTimeout(this.syncSoonTimer);
        // Small delay so a burst of changes goes out together
        this.syncSoonTimer = setTimeout(() => { this.syncSoonTimer = null; void this.flush().catch(e => this.handleError(e)); }, 300);
    }

    put(c: Collection, record: { id: string }): Promise<void> {
        if (!safeId(record.id)) return Promise.reject(new Error(`Invalid id: ${record.id}`));
        return this.writeRecord(recordKey(c, record.id), stripUndefined(record));
    }

    async update(c: Collection, id: string, changes: Record<string, unknown>): Promise<void> {
        const current = (this.snapshot[c] as any[]).find(r => r.id === id);
        if (!current) return;
        return this.writeRecord(recordKey(c, id), stripUndefined({ ...current, ...changes }));
    }

    remove(c: Collection, id: string): Promise<void> {
        return this.removeRecord(recordKey(c, id));
    }

    async putSettings(changes: Partial<Settings>): Promise<void> {
        return this.writeRecord(SETTINGS_KEY, stripUndefined({ ...this.snapshot.settings, ...changes }));
    }

    /** Queue a memory's media (kept on this device) for upload. */
    async queueMedia(memoryId: string, fields: MediaField[]): Promise<void> {
        if (!this.db) return;
        for (const field of fields) await this.enqueue({ id: `media:${memoryId}:${field}`, type: 'media', memoryId, field });
        await this.refreshPending();
        void this.syncSoon();
    }

    async deleteMedia(memoryId: string): Promise<void> {
        if (!this.db) return;
        await this.enqueue({ id: `media-delete:${memoryId}`, type: 'deleteMedia', memoryId });
        await this.refreshPending();
        void this.syncSoon();
    }

    // ── Sending ────────────────────────────────────────────────────────────
    flush(): Promise<void> {
        if (!this.canUseCloud || !this.db) return Promise.resolve();
        if (!this.flushing) {
            this.flushing = this.doFlush().finally(() => { this.flushing = null; });
        }
        return this.flushing;
    }

    private async doFlush() {
        const db = this.db!;
        const entries = (await getAllWithKeys(db, OUTBOX)).map(([, v]) => v as OutboxEntry).sort((a, b) => a.at - b.at);
        if (entries.length === 0) return;
        this.setState({ status: 'syncing' });
        let wroteData = false;

        // Records first (small, quick), in batches
        const records = entries.filter(e => e.type === 'put' || e.type === 'delete');
        for (let i = 0; i < records.length; i += 40) {
            const batch = records.slice(i, i + 40);
            const puts: { key: string; text: string }[] = [];
            const deletes: string[] = [];
            for (const e of batch) {
                if (e.type === 'delete') { deletes.push(e.key!); continue; }
                const value = await tx<any>(db, RECORDS, 'readonly', s => s.get(e.key!));
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
            if (deletes.length) await cloud.delete(deletes);
            // Remove only entries that weren't replaced by a newer change meanwhile
            await this.removeSent(batch);
            for (const k of deletes) delete this.etags[k];
            // Remember which version is ours, so it isn't downloaded again — and a
            // later change from another device is still noticed
            for (const p of puts) {
                if (written[p.key]) this.etags[p.key] = written[p.key];
                else delete this.etags[p.key];
            }
            wroteData = true;
        }

        for (const e of entries.filter(e => e.type === 'deleteMedia')) {
            await cloud.deletePrefix(`media/${e.memoryId}/`);
            for (const f of MEDIA_FIELDS) this.mediaSynced.delete(`${e.memoryId}:${f}`);
            await this.removeSent([e]);
        }

        if (wroteData) {
            await this.bumpVersion();
            await this.setMeta('etags', this.etags);
        }

        for (const e of entries.filter(e => e.type === 'media')) {
            await this.uploadMedia(e.memoryId!, e.field!);
            await this.removeSent([e]);
        }
        await this.setMeta('mediaSynced', [...this.mediaSynced]);

        await this.refreshPending();
        this.setState({ status: 'synced', message: undefined, lastSynced: new Date().toISOString() });
    }

    private async removeSent(sent: OutboxEntry[]) {
        await tx<void>(this.db!, OUTBOX, 'readwrite', s => {
            for (const e of sent) {
                const req = s.get(e.id);
                req.onsuccess = () => { if (req.result && req.result.at === e.at) s.delete(e.id); };
            }
        });
    }

    private async bumpVersion() {
        const v = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await cloud.putText([{ key: VERSION_KEY, text: v, contentType: 'text/plain' }]);
        this.lastVersion = v;
        await this.setMeta('version', v);
    }

    private async uploadMedia(memoryId: string, field: MediaField) {
        if (!safeId(memoryId)) return;
        const value = await getLocal<unknown>(`${memoryId}:${field}`, { localOnly: true });
        const up = await toUploadable(value);
        if (!up) return; // not on this device (another device uploads it)
        const base = mediaBase(memoryId, field);
        const parts = Math.max(1, Math.ceil(up.blob.size / MEDIA_PIECE_BYTES));
        for (let p = 0; p < parts; p++) {
            const piece = up.blob.slice(p * MEDIA_PIECE_BYTES, (p + 1) * MEDIA_PIECE_BYTES);
            await cloud.putBin(`${base}/part-${String(p).padStart(4, '0')}`, piece, 'application/octet-stream');
        }
        // The index goes last: a reader only sees complete files
        await cloud.putText([{ key: `${base}/index.json`, text: JSON.stringify({ kind: up.kind, type: up.type, size: up.blob.size, parts }) }]);
        this.mediaSynced.add(`${memoryId}:${field}`);
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
        for (let p = 0; p < index.parts; p++) pieces.push(await cloud.getBin(`${base}/part-${String(p).padStart(4, '0')}`));
        const value = await fromDownloaded(new Blob(pieces, { type: index.type }), index.kind);
        // Keep it on this device from now on (and don't upload it back)
        await putLocal(`${memoryId}:${field}`, value).catch(() => {});
        this.mediaSynced.add(`${memoryId}:${field}`);
        if (this.db) void this.setMeta('mediaSynced', [...this.mediaSynced]);
        return value;
    }

    /** Media saved on this device before cloud sync existed: upload it once. */
    private async queueUnsyncedMedia() {
        const flagFields: [string, MediaField][] = [
            ['localMedia', 'audio'], ['localImage', 'image'], ['localPdf', 'pdf'],
            ['localNotebook', 'notebook'], ['localStructuredTranscript', 'structuredTranscript'],
        ];
        for (const m of this.snapshot.memories as any[]) {
            const fields: MediaField[] = [];
            for (const [flag, field] of flagFields) {
                if (m[flag] && !this.mediaSynced.has(`${m.id}:${field}`)) {
                    const local = await getLocal(`${m.id}:${field}`, { localOnly: true });
                    if (local !== undefined) fields.push(field);
                }
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
        if (!force && !fullDue) {
            const { [VERSION_KEY]: v } = await cloud.getMany([VERSION_KEY]);
            if (v && v === this.lastVersion) {
                this.setState({ status: this.state.pending ? this.state.status : 'synced', message: undefined, lastSynced: new Date().toISOString() });
                return;
            }
        }
        this.setState({ status: 'syncing' });
        const remote = await cloud.list('db/');
        this.lastFullCheck = Date.now();
        const pendingKeys = new Set((await getAllWithKeys(db, OUTBOX)).map(([, e]) => (e as OutboxEntry).key).filter(Boolean) as string[]);

        const remoteKeys = new Set<string>();
        const toFetch: string[] = [];
        let version: string | null = null;
        for (const item of remote) {
            if (item.key === VERSION_KEY || item.key === MIGRATED_KEY) continue;
            if (item.key !== SETTINGS_KEY && !parseKey(item.key)) continue;
            remoteKeys.add(item.key);
            if (pendingKeys.has(item.key)) continue; // our newer change wins
            if (this.etags[item.key] !== item.etag) toFetch.push(item.key);
        }
        if (remote.some(i => i.key === VERSION_KEY)) {
            const { [VERSION_KEY]: v } = await cloud.getMany([VERSION_KEY]);
            version = v ?? null;
        }

        let changed = false;
        if (toFetch.length) {
            const texts = await cloud.getMany(toFetch);
            const etagOf = new Map(remote.map(i => [i.key, i.etag]));
            await tx<void>(db, RECORDS, 'readwrite', s => {
                for (const key of toFetch) {
                    const text = texts[key];
                    if (text == null) continue;
                    try {
                        const value = JSON.parse(text);
                        s.put(value, key);
                        this.applyLocal(key, value);
                        this.etags[key] = etagOf.get(key)!;
                        changed = true;
                    } catch (e) {
                        console.warn('Skipping unreadable record', key, e);
                    }
                }
            });
        }

        // Deleted on another device: only things we had seen in the cloud before
        const gone = Object.keys(this.etags).filter(k => !remoteKeys.has(k) && !pendingKeys.has(k));
        if (gone.length) {
            await tx<void>(db, RECORDS, 'readwrite', s => {
                for (const key of gone) {
                    s.delete(key);
                    this.applyLocal(key, null);
                    delete this.etags[key];
                }
            });
            changed = true;
        }

        if (version) { this.lastVersion = version; await this.setMeta('version', version); }
        await this.setMeta('etags', this.etags);
        if (changed) this.emit();
        this.setState({ status: this.state.pending ? 'syncing' : 'synced', message: undefined, lastSynced: new Date().toISOString() });
    }

    // ── One-time copy of the old Firestore data ────────────────────────────
    private async migrateIfNeeded() {
        if (await this.getMeta<boolean>('migrated')) return;
        const marker = await cloud.getMany([MIGRATED_KEY]);
        if (marker[MIGRATED_KEY]) {
            await this.setMeta('migrated', true);
            return;
        }
        this.setState({ status: 'syncing', message: 'Copying your existing notes to cloud storage…' });
        const old = legacyReader
            ? await legacyReader(this.uid!)
            : await (await import('./firestoreExport')).readFirestoreData(this.uid!);
        const have = new Set(Object.keys(this.etags));
        let copied = 0;
        for (const c of ['memories', 'tasks', 'events'] as Collection[]) {
            for (const record of old[c] as any[]) {
                if (!record?.id || !safeId(String(record.id))) continue;
                const key = recordKey(c, String(record.id));
                if (have.has(key)) continue; // already in B2 (e.g. copied by the other device)
                await tx<void>(this.db!, RECORDS, 'readwrite', s => { s.put(stripUndefined(record), key); });
                await this.enqueue({ id: `put:${key}`, type: 'put', key });
                this.applyLocal(key, record);
                copied++;
            }
        }
        if (old.settings && !have.has(SETTINGS_KEY)) {
            const merged = {
                courses: Array.from(new Set([...(this.snapshot.settings.courses || []), ...(old.settings.courses || [])])),
                moodleToken: this.snapshot.settings.moodleToken || old.settings.moodleToken || null,
            };
            await tx<void>(this.db!, RECORDS, 'readwrite', s => { s.put(merged, SETTINGS_KEY); });
            await this.enqueue({ id: `put:${SETTINGS_KEY}`, type: 'put', key: SETTINGS_KEY });
            this.applyLocal(SETTINGS_KEY, merged);
        }
        this.emit();
        await this.refreshPending();
        await this.flush();
        await cloud.putText([{ key: MIGRATED_KEY, text: JSON.stringify({ at: new Date().toISOString(), copied }) }]);
        await this.setMeta('migrated', true);
        this.setState({ message: undefined });
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
export const setLegacyReader = (fn: typeof legacyReader) => { legacyReader = fn; };

export const syncEngine = new SyncEngine();

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { void syncEngine.syncNow(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void syncEngine.syncNow();
    });
}

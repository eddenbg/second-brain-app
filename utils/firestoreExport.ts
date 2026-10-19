import type { AnyMemory, Task, CalendarEvent } from '../types';
import { db } from './firebase';

// One-time read of everything the app stored in Firestore before moving to
// B2 (see cloudSync.migrateIfNeeded). Firestore is never written again.
// Reads come from the server only: a partial offline cache must never be
// copied over as if it were complete (it throws instead, and is retried).

export interface FirestoreData {
    memories: AnyMemory[];
    tasks: Task[];
    events: CalendarEvent[];
    settings: { courses?: string[]; moodleToken?: string | null } | null;
}

export async function readFirestoreData(uid: string): Promise<FirestoreData> {
    if (!db || (db as any).type === 'mock') return { memories: [], tasks: [], events: [], settings: null };
    const { collection, getDocsFromServer, doc, getDocFromServer } = await import('firebase/firestore');
    const read = async <T>(name: string): Promise<T[]> => {
        const snap = await getDocsFromServer(collection(db, 'users', uid, name));
        return snap.docs.map(d => ({ ...d.data(), id: d.id })) as T[];
    };
    let results;
    try {
        results = await Promise.all([
            read<AnyMemory>('memories'),
            read<Task>('tasks'),
            read<CalendarEvent>('events'),
            getDocFromServer(doc(db, 'users', uid, 'settings', 'general')),
        ]);
    } catch (e: any) {
        // This account can't read anything there (never used Firestore): nothing to copy.
        // Any other error (offline, server busy) is thrown, and the copy is retried.
        if (e?.code === 'permission-denied') return { memories: [], tasks: [], events: [], settings: null };
        throw e;
    }
    const [memories, tasks, events, settingsSnap] = results;
    const s = settingsSnap.exists() ? (settingsSnap.data() as any) : null;
    return {
        memories,
        tasks,
        events,
        settings: s ? { courses: s.courses || [], moodleToken: s.moodleToken ?? null } : null,
    };
}

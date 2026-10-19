import type { AnyMemory, Task, CalendarEvent } from '../types';
import { db } from './firebase';
import { listPending } from './mediaStore';

// One-time read of everything the app stored in Firestore before moving to
// B2 (see cloudSync.migrateIfNeeded). Firestore is never written again.

export interface FirestoreData {
    memories: AnyMemory[];
    tasks: Task[];
    events: CalendarEvent[];
    settings: { courses?: string[]; moodleToken?: string | null } | null;
}

export async function readFirestoreData(uid: string): Promise<FirestoreData> {
    if (!db || (db as any).type === 'mock') return { memories: [], tasks: [], events: [], settings: null };
    const { collection, getDocs, doc, getDoc } = await import('firebase/firestore');
    const read = async <T>(name: string): Promise<T[]> => {
        const snap = await getDocs(collection(db, 'users', uid, name));
        return snap.docs.map(d => ({ ...d.data(), id: d.id })) as T[];
    };
    const [memories, tasks, events, settingsSnap] = await Promise.all([
        read<AnyMemory>('memories'),
        read<Task>('tasks'),
        read<CalendarEvent>('events'),
        getDoc(doc(db, 'users', uid, 'settings', 'general')),
    ]);
    // Saves that had failed under the old setup and were kept on this device
    const pending = (await listPending()) as AnyMemory[];
    const known = new Set(memories.map(m => m.id));
    for (const p of pending) if (p?.id && !known.has(p.id)) memories.push(p);

    const s = settingsSnap.exists() ? (settingsSnap.data() as any) : null;
    return {
        memories,
        tasks,
        events,
        settings: s ? { courses: s.courses || [], moodleToken: s.moodleToken ?? null } : null,
    };
}

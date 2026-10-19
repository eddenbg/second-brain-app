import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory, Task, CalendarEvent } from '../types';
import { auth } from '../utils/firebase';
import { onAuthStateChanged, User, signInAnonymously, linkWithRedirect, signInWithRedirect, getRedirectResult, signInWithCredential, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth';
import { googleProvider } from '../utils/firebase';
import { safeSetItem, isNearQuota, stripMediaForCache } from '../utils/safeStorage';
import { prepareMemoryForCloud } from '../utils/memoryPrep';
import { deleteLocalFor, getLocal } from '../utils/mediaStore';
import { syncEngine, MediaField, SyncState } from '../utils/cloudSync';

// All data lives in Backblaze B2 (via utils/cloudSync.ts), with a full copy on
// this device so the app opens instantly and works offline. Firebase is used
// only for Google sign-in (to know whose data to load).

export const MEMORY_SAVE_FAILED_EVENT = 'second-brain:memory-save-failed';

export const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed — please try again';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
    moodleToken?: string;
}

// Lightweight copy shown while the device database opens (and before the very
// first sync after updating from the Firestore version)
const LOCAL_STORAGE_KEY = 'second_brain_local_data';

const newId = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [moodleToken, setMoodleToken] = useState<string | null>(null);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [courses, setCourses] = useState<string[]>([]);

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [syncState, setSyncState] = useState<SyncState>({ status: 'starting', pending: 0, ready: false });

    // 1. Quick first paint from the last session's copy
    useEffect(() => {
        try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                setMemories(data.memories || []);
                setTasks(data.tasks || []);
                setSavedCourses(data.courses || []);
                setMoodleToken(data.moodleToken || null);
                setCalendarEvents(data.events || []);
            }
        } catch (e) {
            console.error("Failed to read local storage", e);
        }
    }, []);

    // 2. Handle Auth state — auto sign-in anonymously (no login screen)
    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }

        let authUnsubscribe: (() => void) | undefined;

        const init = async () => {
            // Google sign-in uses a full-page redirect (popups are blocked in
            // installed PWAs). On every load, collect the redirect result
            // FIRST — before the auth listener runs and before any sign-in UI
            // shows — so the returning user is applied without a manual reload.
            try {
                const result = await getRedirectResult(auth);
                if (result?.user) {
                    setUser(result.user);
                }
            } catch (e: any) {
                if (e?.code === 'auth/credential-already-in-use') {
                    // Google account already linked to another Firebase UID — sign into that account directly
                    const credential = GoogleAuthProvider.credentialFromError(e);
                    if (credential) {
                        try {
                            const signedIn = await signInWithCredential(auth, credential);
                            setUser(signedIn.user);
                        } catch (inner) {
                            console.error('Google sign-in failed', inner);
                            setAuthError(SIGN_IN_FAILED_MESSAGE);
                        }
                    }
                } else {
                    console.error('Google sign-in redirect failed', e?.code, e?.message);
                    setAuthError(SIGN_IN_FAILED_MESSAGE);
                }
            }

            // Now set up the auth state listener
            authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                if (currentUser) {
                    setUser(currentUser);
                    setLoading(false);
                } else {
                    // Signed out: reflect it in the UI right away, then fall
                    // back to an anonymous session.
                    setUser(null);
                    try {
                        await signInAnonymously(auth);
                    } catch (e) {
                        console.error("Anonymous sign-in failed", e);
                        setLoading(false);
                    }
                }
            });
        };

        init();

        return () => authUnsubscribe?.();
    }, []);

    // 3. Open this account's data and keep it in sync with B2
    useEffect(() => {
        if (!user) return;
        let unsubData: (() => void) | undefined;
        let unsubState: (() => void) | undefined;
        void syncEngine.start(user.uid, !user.isAnonymous).then(() => {
            unsubState = syncEngine.subscribeState(setSyncState);
            unsubData = syncEngine.subscribe((snap) => {
                // Until the first sync has finished, don't replace the quick
                // copy with an empty device database
                const empty = snap.memories.length === 0 && snap.tasks.length === 0 && snap.events.length === 0;
                if (empty && !syncEngine.isReady()) return;
                setMemories(snap.memories);
                setTasks(snap.tasks);
                setCalendarEvents(snap.events);
                setSavedCourses(snap.settings.courses || []);
                setMoodleToken(snap.settings.moodleToken || null);
            });
        }).catch(e => console.error('Could not open device storage', e));
        return () => { unsubData?.(); unsubState?.(); };
    }, [user]);

    // When the first sync finishes, show whatever it produced (even if empty)
    useEffect(() => {
        if (!syncState.ready) return;
        const snap = syncEngine.getSnapshot();
        setMemories(snap.memories);
        setTasks(snap.tasks);
        setCalendarEvents(snap.events);
        setSavedCourses(snap.settings.courses || []);
        setMoodleToken(snap.settings.moodleToken || null);
    }, [syncState.ready]);

    // 4. Derived courses from memories + savedCourses
    useEffect(() => {
        const extracted = Array.from(new Set(
            memories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        ));
        const uniqueCourses = Array.from(new Set([...extracted, ...savedCourses]))
            .filter(c => c !== 'General')
            .sort();

        setCourses(uniqueCourses);
    }, [memories, savedCourses]);

    // 5. Small copy for the next quick start (media stripped; the full data is
    //    in the device database). Best-effort: trimmed if storage is tight.
    useEffect(() => {
        let cached = memories.map(m => stripMediaForCache(m)).slice(0, 300);
        const serialize = () => JSON.stringify({ memories: cached, tasks, courses: savedCourses, moodleToken, events: calendarEvents });
        let payload = serialize();
        while (cached.length > 0 && isNearQuota(LOCAL_STORAGE_KEY, payload)) {
            cached = cached.slice(0, Math.floor(cached.length * 0.75));
            payload = serialize();
        }
        safeSetItem(LOCAL_STORAGE_KEY, payload);
    }, [memories, tasks, savedCourses, moodleToken, calendarEvents]);

    // --- Changes ---
    const performSync = useCallback(async () => { await syncEngine.syncNow(true); }, []);

    const addMemory = useCallback(async (memoryData: Omit<AnyMemory, 'id' | 'date'>) => {
        const newMemory = {
            ...memoryData,
            // Suffix keeps ids unique when several items are saved in the same millisecond
            id: newId(),
            date: new Date().toISOString(),
        } as AnyMemory;
        // Large parts (audio, PDF, photo, long drawings) go to the device store,
        // and from there to B2 as separate files
        const record = await prepareMemoryForCloud(newMemory);
        try {
            await syncEngine.put('memories', record);
        } catch (e) {
            console.error('Saving failed', e);
            window.dispatchEvent(new CustomEvent(MEMORY_SAVE_FAILED_EVENT));
            return;
        }
        const r = record as any;
        const media: MediaField[] = [];
        if (r.localMedia) media.push('audio');
        if (r.localImage) media.push('image');
        if (r.localPdf) media.push('pdf');
        if (r.localNotebook) media.push('notebook');
        if (r.localStructuredTranscript) media.push('structuredTranscript');
        for (const f of ['transcript', 'extractedText'] as MediaField[]) {
            if (await getLocal(`${newMemory.id}:${f}`, { localOnly: true }) !== undefined) media.push(f);
        }
        if (media.length) void syncEngine.queueMedia(newMemory.id, media);
        // Fire-and-forget: generate AI topic tags
        (async () => {
            try {
                const { generateTopicsForMemory } = await import('../services/geminiService');
                const content = (newMemory as any).transcript || (newMemory as any).extractedText ||
                               (newMemory as any).content || (newMemory as any).description ||
                               (newMemory as any).summary || '';
                const topics = await generateTopicsForMemory(newMemory.title, content);
                if (topics.length > 0) await syncEngine.update('memories', newMemory.id, { topics });
            } catch { /* topic generation is best-effort */ }
        })();
    }, []);

    const deleteMemory = useCallback(async (id: string) => {
        await syncEngine.remove('memories', id);
        void syncEngine.deleteMedia(id);
        void deleteLocalFor(id);
    }, []);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        for (const id of ids) {
            await syncEngine.remove('memories', id);
            void syncEngine.deleteMedia(id);
            void deleteLocalFor(id);
        }
    }, []);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        await syncEngine.update('memories', id, updates as Record<string, unknown>);
    }, []);

    const addTask = useCallback(async (taskData: Omit<Task, 'id' | 'createdAt'>) => {
        const newTask: Task = { ...taskData, id: newId(), createdAt: new Date().toISOString() };
        await syncEngine.put('tasks', newTask).catch(err => console.error('addTask failed:', err));
    }, []);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        await syncEngine.update('tasks', id, updates as Record<string, unknown>);
    }, []);

    const deleteTask = useCallback(async (id: string) => {
        await syncEngine.remove('tasks', id);
    }, []);

    const addCalendarEvent = useCallback(async (event: Omit<CalendarEvent, 'id'>) => {
        const newEvent: CalendarEvent = { ...event, id: `manual-${Date.now()}`, source: 'manual' };
        await syncEngine.put('events', newEvent).catch(e => console.error('Saving event failed', e));
    }, []);

    const deleteCalendarEvent = useCallback(async (eventId: string) => {
        await syncEngine.remove('events', eventId).catch(e => console.error('Deleting event failed', e));
    }, []);

    // Accepts one or several names
    const addCourse = useCallback(async (courseName: string | string[]) => {
        const names = (Array.isArray(courseName) ? courseName : [courseName]).map(n => n.trim()).filter(Boolean);
        if (names.length === 0) return;
        const current = syncEngine.getSnapshot().settings.courses || [];
        await syncEngine.putSettings({ courses: Array.from(new Set([...current, ...names])) });
    }, []);

    const deleteCourse = useCallback(async (courseName: string) => {
        const current = syncEngine.getSnapshot().settings.courses || [];
        await syncEngine.putSettings({ courses: current.filter(c => c !== courseName) });
        // Delete all memories belonging to this course
        const courseMemories = syncEngine.getSnapshot().memories.filter(m => m.category === 'college' && (m as any).course === courseName);
        for (const m of courseMemories) {
            await syncEngine.remove('memories', m.id);
            void syncEngine.deleteMedia(m.id);
            void deleteLocalFor(m.id);
        }
    }, []);

    const saveMoodleToken = useCallback(async (token: string | null) => {
        await syncEngine.putSettings({ moodleToken: token });
    }, []);

    // Full-page redirect to Google. The result is picked up by
    // getRedirectResult when the app loads again (see the auth effect above).
    const signInWithGoogle = useCallback(async () => {
        if (!auth) throw new Error('Firebase not configured');
        if (auth.currentUser?.isAnonymous) {
            // Link so the anonymous session's data carries over to the Google account
            await linkWithRedirect(auth.currentUser, googleProvider);
        } else {
            await signInWithRedirect(auth, googleProvider);
        }
    }, []);

    const clearAuthError = useCallback(() => setAuthError(null), []);

    const signOut = useCallback(async () => {
        if (!auth) return;
        // onAuthStateChanged sets user to null immediately (UI shows Sign In),
        // then starts a fresh anonymous session.
        await firebaseSignOut(auth);
    }, []);

    return {
        memories, tasks, courses, moodleToken,
        addMemory, deleteMemory, bulkDeleteMemories, updateMemory,
        addTask, updateTask, deleteTask, addCourse, deleteCourse, saveMoodleToken,
        user, loading, performSync,
        isSyncing: syncState.status === 'syncing',
        syncState,
        syncError: syncState.status === 'error' ? syncState.message || 'Sync failed' : null,
        storageWarning: null as string | null,
        hasUnsavedChanges: syncState.pending > 0,
        authError, clearAuthError,
        fetchFromCloud: performSync,
        signInWithGoogle, signOut,
        calendarEvents, addCalendarEvent, deleteCalendarEvent,
        isAnonymous: user?.isAnonymous ?? true,
    };
};

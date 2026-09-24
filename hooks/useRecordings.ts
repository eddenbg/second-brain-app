import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnyMemory, WebMemory, Task } from '../types';
import { db, auth } from '../utils/firebase';
import { 
    collection, 
    doc, 
    writeBatch,
    query,
    orderBy,
    onSnapshot
} from 'firebase/firestore';
import { onAuthStateChanged, User, signInAnonymously, linkWithRedirect, signInWithRedirect, getRedirectResult, signInWithCredential, GoogleAuthProvider, signOut as firebaseSignOut, OAuthCredential } from 'firebase/auth';
import { saveGoogleToken } from '../services/googleCalendarService';
import { saveDriveToken } from '../services/googleDriveService';
import { googleProvider } from '../utils/firebase';
import { safeSetItem, isNearQuota, stripMediaForCache, alertStorageFull } from '../utils/safeStorage';
import { GOOGLE_TOKEN_REFRESHED_EVENT } from '../services/googleAuthEvents';

export const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed — please try again';

/** Store the Google API token from a sign-in and tell the app it's fresh. */
const storeGoogleAccessToken = (credential: OAuthCredential | null) => {
    const token = credential?.accessToken;
    if (!token) return;
    saveGoogleToken(token);
    saveDriveToken(token);
    try { window.dispatchEvent(new Event(GOOGLE_TOKEN_REFRESHED_EVENT)); } catch { /* non-browser */ }
};

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
    moodleToken?: string;
}

const LOCAL_STORAGE_KEY = 'second_brain_local_data';

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [moodleToken, setMoodleToken] = useState<string | null>(null);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [storageWarning, setStorageWarning] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);

    const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingTaskIdsRef = useRef<Set<string>>(new Set());

    // 1. Initial Load from LocalStorage (for speed)
    useEffect(() => {
        try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                setMemories(data.memories || []);
                setTasks(data.tasks || []);
                setSavedCourses(data.courses || []);
                setMoodleToken(data.moodleToken || null);
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
            // shows — so the returning user and their Google token are applied
            // without a manual reload.
            try {
                const result = await getRedirectResult(auth);
                if (result?.user) {
                    storeGoogleAccessToken(GoogleAuthProvider.credentialFromResult(result));
                    setUser(result.user);
                }
            } catch (e: any) {
                if (e?.code === 'auth/credential-already-in-use') {
                    // Google account already linked to another Firebase UID — sign into that account directly
                    const credential = GoogleAuthProvider.credentialFromError(e);
                    if (credential) {
                        try {
                            const signedIn = await signInWithCredential(auth, credential);
                            storeGoogleAccessToken(credential);
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

            // Now set up the auth state listener — token is guaranteed to be stored
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

    // 3. Real-time Listeners for Memories and Tasks
    useEffect(() => {
        if (!user || !db || (db as any).type === 'mock') return;

        // Memories Listener
        const memoriesRef = collection(db, 'users', user.uid, 'memories');
        const qMemories = query(memoriesRef, orderBy('date', 'desc'));
        const unsubMemories = onSnapshot(qMemories, (snapshot) => {
            const remoteMemories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AnyMemory[];
            setMemories(remoteMemories);
        });

        // Tasks Listener
        const tasksRef = collection(db, 'users', user.uid, 'tasks');
        const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
            const remoteTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];
            setTasks(prev => {
                const pendingIds = pendingTaskIdsRef.current;
                if (pendingIds.size === 0) return remoteTasks;
                // Merge: keep optimistic tasks not yet confirmed in remote snapshot
                const remoteIds = new Set(remoteTasks.map(t => t.id));
                const stillPending = prev.filter(t => pendingIds.has(t.id) && !remoteIds.has(t.id));
                return [...remoteTasks, ...stillPending];
            });
        });

        return () => {
            unsubMemories();
            unsubTasks();
        };
    }, [user]);

    // 3b. Separate Real-time Listener for Settings to ensure cross-device sync
    useEffect(() => {
        if (!user || !db || (db as any).type === 'mock') return;
        
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
        const unsubSettings = onSnapshot(settingsRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setSavedCourses(data.courses || []);
                setMoodleToken(data.moodleToken || null);
            } else {
                setSavedCourses([]);
                setMoodleToken(null);
            }
        });

        return () => unsubSettings();

    }, [user]);

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

    // 5. Save to local storage for offline persistent cache.
    // Media (images/audio/video) is stripped — it lives in Firestore only.
    // If the cache is full, the oldest 3 memories are dropped from the local
    // copy (they remain in Firestore) and the write is retried; the user is
    // told once. A failed write never throws.
    useEffect(() => {
        const serialize = (mems: AnyMemory[]) =>
            JSON.stringify({ memories: mems, tasks, courses: savedCourses, moodleToken });

        // Newest first, so trimming from the end drops the oldest entries
        let cached = memories
            .map(m => stripMediaForCache(m))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        let payload = serialize(cached);
        let evicted = false;

        const shrink = () => {
            // Drop the oldest 3 first; fall back to bigger cuts if still too large
            const next = cached.length > 12 && evicted
                ? Math.floor(cached.length * 0.75)
                : Math.max(0, cached.length - 3);
            cached = cached.slice(0, next);
            payload = serialize(cached);
            evicted = true;
        };

        while (cached.length > 0 && isNearQuota(LOCAL_STORAGE_KEY, payload)) shrink();

        let saved = safeSetItem(LOCAL_STORAGE_KEY, payload);
        while (!saved && cached.length > 0) {
            shrink();
            saved = safeSetItem(LOCAL_STORAGE_KEY, payload);
        }

        if (evicted && saved) alertStorageFull();
        setStorageWarning(saved ? null : 'Offline storage is full. Your data is still saved to the cloud.');
    }, [memories, tasks, savedCourses, moodleToken]);

    // --- Cloud Sync Action ---
    const performSync = useCallback(async () => {
        if (!user || !db || (db as any).type === 'mock') return;
        setIsSyncing(true);
        setSyncError(null);
        try {
            const batch = writeBatch(db);
            
            for (const mem of memories) {
                const docRef = doc(db, 'users', user.uid, 'memories', mem.id);
                batch.set(docRef, mem);
            }

            for (const task of tasks) {
                const docRef = doc(db, 'users', user.uid, 'tasks', task.id);
                batch.set(docRef, task);
            }

            const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
            batch.set(settingsRef, { courses: savedCourses, moodleToken }, { merge: true });

            await batch.commit();
        } catch (e) {
            console.error('Sync failed', e);
            setSyncError('Sync failed. Please try again.');
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks, savedCourses, moodleToken]);

    const addMemory = useCallback(async (memoryData: Omit<AnyMemory, 'id' | 'date'>) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const newMemory = {
            ...memoryData,
            id: Date.now().toString(),
            date: new Date().toISOString(),
        } as AnyMemory;
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', user.uid, 'memories', newMemory.id), newMemory);
        // Fire-and-forget: generate AI topic tags and patch the document
        (async () => {
            try {
                const { generateTopicsForMemory } = await import('../services/geminiService');
                const { updateDoc } = await import('firebase/firestore');
                const content = (newMemory as any).transcript || (newMemory as any).extractedText ||
                               (newMemory as any).content || (newMemory as any).description ||
                               (newMemory as any).summary || '';
                const topics = await generateTopicsForMemory(newMemory.title, content);
                if (topics.length > 0) {
                    await updateDoc(doc(db, 'users', user.uid, 'memories', newMemory.id), { topics } as any);
                }
            } catch { /* topic generation is best-effort */ }
        })();
    }, [user]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
    }, [user]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'memories', id), updates as any);
    }, [user]);

    const addTask = useCallback(async (taskData: Omit<Task, 'id' | 'createdAt'>) => {
        const newTask: Task = { ...taskData, id: Date.now().toString(), createdAt: new Date().toISOString() };
        pendingTaskIdsRef.current.add(newTask.id);
        setTasks(prev => [...prev, newTask]); // optimistic — shows immediately
        if (!user || !db || (db as any).type === 'mock') {
            pendingTaskIdsRef.current.delete(newTask.id);
            return;
        }
        try {
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid, 'tasks', newTask.id), newTask);
        } catch (err) {
            console.error('addTask failed:', err);
            setTasks(prev => prev.filter(t => t.id !== newTask.id)); // rollback on error
        } finally {
            pendingTaskIdsRef.current.delete(newTask.id);
        }
    }, [user]);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'tasks', id), updates as any);
    }, [user]);

    const deleteTask = useCallback(async (id: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
    }, [user]);

    const addCourse = useCallback(async (courseName: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const updated = [...new Set([...savedCourses, courseName])];
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: updated, moodleToken }, { merge: true });
    }, [user, savedCourses, moodleToken]);

    const deleteCourse = useCallback(async (courseName: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { setDoc, deleteDoc } = await import('firebase/firestore');
        // Remove from savedCourses
        const updatedCourses = savedCourses.filter(c => c !== courseName);
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: updatedCourses, moodleToken }, { merge: true });
        // Delete all memories belonging to this course
        const courseMemories = memories.filter(m => m.category === 'college' && (m as any).course === courseName);
        await Promise.all(courseMemories.map(m => deleteDoc(doc(db, 'users', user.uid, 'memories', m.id))));
    }, [user, savedCourses, moodleToken, memories]);

    const saveMoodleToken = useCallback(async (token: string | null) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: savedCourses, moodleToken: token }, { merge: true });
        setMoodleToken(token);
    }, [user, savedCourses]);

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
        user, loading, isSyncing, hasUnsavedChanges, syncError, storageWarning, performSync,
        authError, clearAuthError,
        fetchFromCloud: performSync,
        signInWithGoogle, signOut,
        isAnonymous: user?.isAnonymous ?? true,
    };
};

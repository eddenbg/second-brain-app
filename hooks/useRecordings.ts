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
import { onAuthStateChanged, User, signInAnonymously, linkWithRedirect, signInWithRedirect, linkWithPopup, signInWithPopup, getRedirectResult, signInWithCredential, GoogleAuthProvider, signOut as firebaseSignOut, UserCredential } from 'firebase/auth';
import { saveGoogleToken } from '../services/googleCalendarService';
import { saveDriveToken } from '../services/googleDriveService';
import { googleProvider } from '../utils/firebase';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
    moodleToken?: string;
}

const LOCAL_STORAGE_KEY = 'second_brain_local_data';

/**
 * Firestore rejects any document containing an undefined value, failing the whole
 * write. Several fields are built as `x || undefined` (videoDataUrl, summary,
 * notebook.backgroundImageUrl when no background was set), so a perfectly ordinary
 * lecture could not be saved at all. Drop those keys instead of sending them.
 */
const stripUndefined = (value: any): any => {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined) continue;
            out[k] = stripUndefined(v);
        }
        return out;
    }
    return value;
};

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

    const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingTaskIdsRef = useRef<Set<string>>(new Set());

    // 1. Initial Load from LocalStorage (for speed)
    useEffect(() => {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                setMemories(data.memories || []);
                setTasks(data.tasks || []);
                setSavedCourses(data.courses || []);
                setMoodleToken(data.moodleToken || null);
            } catch (e) {
                console.error("Failed to parse local storage", e);
            }
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
            // Await redirect result FIRST so the Google token is stored before
            // onAuthStateChanged fires and the UI reads from localStorage.
            //
            // Every outcome here is recorded to localStorage so Settings can show
            // what happened. Previously failures were swallowed, so a broken
            // redirect looked identical to never having tapped the button.
            const redirectWasPending = localStorage.getItem('auth_redirect_pending');
            try {
                const result = await getRedirectResult(auth);
                if (result) {
                    localStorage.removeItem('auth_redirect_pending');
                    localStorage.removeItem('last_auth_error');
                    const credential = GoogleAuthProvider.credentialFromResult(result);
                    const token = credential?.accessToken;
                    if (token) {
                        saveGoogleToken(token);
                        saveDriveToken(token);
                    }
                } else if (redirectWasPending) {
                    // Came back from Google but Firebase had no result waiting —
                    // the classic partitioned-storage / authDomain mismatch.
                    localStorage.removeItem('auth_redirect_pending');
                    localStorage.setItem(
                        'last_auth_error',
                        'Returned from Google but no sign-in result was found (auth/no-redirect-result). ' +
                        `authDomain=${(auth as any)?.config?.authDomain ?? 'unknown'}`
                    );
                }
            } catch (e: any) {
                localStorage.removeItem('auth_redirect_pending');
                localStorage.setItem('last_auth_error', `${e?.code || 'unknown'}: ${e?.message || e}`);
                if (e.code === 'auth/credential-already-in-use') {
                    // Google account already linked to another Firebase UID — sign into that account directly
                    const credential = GoogleAuthProvider.credentialFromError(e);
                    if (credential) {
                        signInWithCredential(auth, credential)
                            .then(() => localStorage.removeItem('last_auth_error'))
                            .catch(console.error);
                    }
                }
            }

            // Now set up the auth state listener — token is guaranteed to be stored
            authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                if (currentUser) {
                    setUser(currentUser);
                    setLoading(false);
                } else {
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
        const unsubMemories = onSnapshot(
            qMemories,
            (snapshot) => {
                const remoteMemories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AnyMemory[];
                setMemories(remoteMemories);
            },
            (error) => {
                console.error('Memories listener error:', error);
            }
        );

        // Tasks Listener
        const tasksRef = collection(db, 'users', user.uid, 'tasks');
        const unsubTasks = onSnapshot(
            tasksRef,
            (snapshot) => {
                const remoteTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];
                setTasks(prev => {
                    const pendingIds = pendingTaskIdsRef.current;
                    if (pendingIds.size === 0) return remoteTasks;
                    // Merge: keep optimistic tasks not yet confirmed in remote snapshot
                    const remoteIds = new Set(remoteTasks.map(t => t.id));
                    const stillPending = prev.filter(t => pendingIds.has(t.id) && !remoteIds.has(t.id));
                    return [...remoteTasks, ...stillPending];
                });
            },
            (error) => {
                console.error('Tasks listener error:', error);
            }
        );

        return () => {
            unsubMemories();
            unsubTasks();
        };
    }, [user]);

    // 3b. Separate Real-time Listener for Settings to ensure cross-device sync
    useEffect(() => {
        if (!user || !db || (db as any).type === 'mock') return;

        const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
        const unsubSettings = onSnapshot(
            settingsRef,
            (doc) => {
                if (doc.exists()) {
                    const data = doc.data();
                    setSavedCourses(data.courses || []);
                    setMoodleToken(data.moodleToken || null);
                } else {
                    setSavedCourses([]);
                    setMoodleToken(null);
                }
            },
            (error) => {
                console.error('Settings listener error:', error);
            }
        );

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

    // 5. Save to local storage for offline persistent cache
    useEffect(() => {
        const data = { memories, tasks, courses: savedCourses, moodleToken };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
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

    // Reports failure instead of throwing into a promise nobody awaits. A rejected
    // write here used to disappear entirely, so a recording that was never stored
    // looked saved: the screen simply returned to the list without it.
    const addMemory = useCallback(async (memoryData: Omit<AnyMemory, 'id' | 'date'>): Promise<{ ok: boolean; reason?: string }> => {
        if (!db || (db as any).type === 'mock') {
            return { ok: false, reason: 'Storage is unavailable. Check your connection and try again.' };
        }
        if (!user) {
            return { ok: false, reason: 'Not signed in yet, so there is nowhere to save. Open Settings and sign in with Google.' };
        }
        const newMemory = stripUndefined({
            ...memoryData,
            id: Date.now().toString(),
            date: new Date().toISOString(),
        }) as AnyMemory;
        const { setDoc } = await import('firebase/firestore');
        try {
            await setDoc(doc(db, 'users', user.uid, 'memories', newMemory.id), newMemory);
        } catch (e: any) {
            console.error('addMemory failed', e);
            const denied = e?.code === 'permission-denied' || /insufficient permissions/i.test(e?.message || '');
            return {
                ok: false,
                reason: denied
                    ? 'The database rejected the save (missing or insufficient permissions). The Firestore security rules for this project need updating — nothing can be saved until then.'
                    : (e?.message || 'Could not save.'),
            };
        }
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

        return { ok: true };
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

    // Returns why it failed rather than silently doing nothing: without this the
    // Add Course button looked broken when the user simply was not signed in yet.
    // Callers that do not care can ignore the result.
    const addCourse = useCallback(async (courseName: string): Promise<{ ok: boolean; reason?: string }> => {
        if (!db || (db as any).type === 'mock') {
            return { ok: false, reason: 'Storage is unavailable. Check your connection and try again.' };
        }
        if (!user) {
            return { ok: false, reason: 'Waiting for sign-in. Give it a moment, then try again.' };
        }
        try {
            const updated = [...new Set([...savedCourses, courseName])];
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: updated, moodleToken }, { merge: true });
            return { ok: true };
        } catch (e: any) {
            console.error('addCourse failed', e);
            return { ok: false, reason: e?.message || 'Could not save the course.' };
        }
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

    const signInWithGoogle = useCallback(async () => {
        if (!auth) throw new Error('Firebase not configured');

        const storeGoogleTokenFromResult = (result: UserCredential) => {
            const credential = GoogleAuthProvider.credentialFromResult(result);
            const token = credential?.accessToken;
            if (token) {
                saveGoogleToken(token);
                saveDriveToken(token);
            }
        };

        const tryPopup = async () => {
            let result: UserCredential;
            if (auth.currentUser?.isAnonymous) {
                result = await linkWithPopup(auth.currentUser, googleProvider);
            } else {
                result = await signInWithPopup(auth, googleProvider);
            }
            storeGoogleTokenFromResult(result);
        };

        const tryRedirect = async () => {
            // Breadcrumb so that, on the way back, we can tell "user never tried"
            // apart from "redirect came back empty".
            localStorage.setItem('auth_redirect_pending', String(Date.now()));
            try {
                if (auth.currentUser?.isAnonymous) {
                    await linkWithRedirect(auth.currentUser, googleProvider);
                } else {
                    await signInWithRedirect(auth, googleProvider);
                }
            } catch (e: any) {
                localStorage.removeItem('auth_redirect_pending');
                localStorage.setItem('last_auth_error', `${e?.code || 'unknown'}: ${e?.message || e}`);
                throw e;
            }
        };

        // Try the popup FIRST, in every mode including the installed PWA.
        //
        // The redirect flow hands the browser off to a cross-origin handler on
        // firebaseapp.com and depends on state surviving that round trip, which is
        // exactly what has been failing here. The popup keeps the whole exchange in
        // one context and sidesteps that entirely. Standalone used to skip straight
        // to redirect on the assumption popups are always blocked; that assumption
        // cost us the one flow that does not depend on third-party storage. If the
        // popup really is blocked we still fall back, so this is never worse.
        try {
            await tryPopup();
            localStorage.removeItem('last_auth_error');
            return;
        } catch (e: any) {
            const code = e?.code || '';

            if (code === 'auth/credential-already-in-use') {
                // Google account already attached to a previous anonymous user.
                const credential = GoogleAuthProvider.credentialFromError(e);
                if (credential) {
                    await signInWithCredential(auth, credential);
                    localStorage.removeItem('last_auth_error');
                    return;
                }
            }

            const popupUnavailable =
                code === 'auth/popup-blocked' ||
                code === 'auth/popup-closed-by-user' ||
                code === 'auth/cancelled-popup-request' ||
                code === 'auth/popup-cancelled' ||
                code === 'auth/operation-not-supported-in-this-environment';

            if (!popupUnavailable) {
                localStorage.setItem('last_auth_error', `${code || 'unknown'}: ${e?.message || e}`);
                throw e;
            }

            // Note why we fell back, so a later redirect failure is traceable to
            // its cause rather than looking like the only thing that was tried.
            localStorage.setItem('auth_popup_fallback_reason', code || 'unknown');
            await tryRedirect();
        }
    }, []);

    const signOut = useCallback(async () => {
        if (!auth) return;
        await firebaseSignOut(auth);
    }, []);

    return {
        memories, tasks, courses, moodleToken,
        addMemory, deleteMemory, bulkDeleteMemories, updateMemory,
        addTask, updateTask, deleteTask, addCourse, deleteCourse, saveMoodleToken,
        user, loading, isSyncing, hasUnsavedChanges, syncError, performSync,
        fetchFromCloud: performSync,
        signInWithGoogle, signOut,
        isAnonymous: user?.isAnonymous ?? true,
    };
};

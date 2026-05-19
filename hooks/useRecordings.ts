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
import { onAuthStateChanged, User, signInAnonymously, linkWithRedirect, signInWithRedirect, linkWithPopup, signInWithPopup, getRedirectResult, signInWithCredential, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth';
import { googleProvider } from '../utils/firebase';

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

    const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        // Handle post-redirect after Google sign-in (fires once when app loads back after redirect)
        getRedirectResult(auth).then((_result) => {
            // onAuthStateChanged handles user state update automatically
        }).catch((e: any) => {
            if (e.code === 'auth/credential-already-in-use') {
                // Google account already linked to another Firebase UID — sign into that account directly
                const credential = GoogleAuthProvider.credentialFromError(e);
                if (credential) {
                    signInWithCredential(auth, credential).catch(console.error);
                }
            }
        });

        const authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
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

        return () => authUnsubscribe();
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
            setTasks(remoteTasks);
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
        if (!user || !db || (db as any).type === 'mock') return;
        const newTask: Task = { ...taskData, id: Date.now().toString(), createdAt: new Date().toISOString() };
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', user.uid, 'tasks', newTask.id), newTask);
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

    const signInWithGoogle = useCallback(async () => {
        if (!auth) throw new Error('Firebase not configured');

        const tryPopup = async () => {
            if (auth.currentUser?.isAnonymous) {
                await linkWithPopup(auth.currentUser, googleProvider);
            } else {
                await signInWithPopup(auth, googleProvider);
            }
        };

        const tryRedirect = async () => {
            if (auth.currentUser?.isAnonymous) {
                await linkWithRedirect(auth.currentUser, googleProvider);
            } else {
                await signInWithRedirect(auth, googleProvider);
            }
        };

        try {
            await tryPopup();
        } catch (e: any) {
            if (
                e.code === 'auth/popup-blocked' ||
                e.code === 'auth/popup-cancelled' ||
                e.code === 'auth/cancelled-popup-request'
            ) {
                // Popup blocked (strict PWA mode) — fall back to redirect
                await tryRedirect();
            } else if (e.code === 'auth/credential-already-in-use') {
                // Google account already belongs to another UID — sign in directly
                const credential = GoogleAuthProvider.credentialFromError(e);
                if (credential) await signInWithCredential(auth, credential);
            } else {
                throw e;
            }
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

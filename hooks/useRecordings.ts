
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
import { onAuthStateChanged, User, GoogleAuthProvider, linkWithPopup, unlink } from 'firebase/auth';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
    moodleToken?: string;
    isGoogleConnected?: boolean;
}

const LOCAL_STORAGE_KEY = 'second_brain_local_data';
const SYNC_DELAY_MS = 2000; // 2 seconds of inactivity before auto-sync

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [moodleToken, setMoodleToken] = useState<string | null>(null);
    const [isGoogleConnected, setIsGoogleConnected] = useState(false);
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
                setIsGoogleConnected(data.isGoogleConnected || false);
            } catch (e) {
                console.error("Failed to parse local storage", e);
            }
        }
    }, []);

    // 2. Handle Auth state & Setup Real-time Listeners
    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }

        const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
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
                setIsGoogleConnected(data.isGoogleConnected || false);
            } else {
                setSavedCourses([]);
                setMoodleToken(null);
                setIsGoogleConnected(false);
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
        const data = { memories, tasks, courses: savedCourses, moodleToken, isGoogleConnected };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }, [memories, tasks, savedCourses, moodleToken, isGoogleConnected]);

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
            batch.set(settingsRef, { courses: savedCourses, moodleToken, isGoogleConnected }, { merge: true });

            await batch.commit();
            setHasUnsavedChanges(false);
        } catch (error: any) {
            console.error("Sync failed", error);
            setSyncError("Cloud connection lost.");
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks, savedCourses, moodleToken, isGoogleConnected]);

    // Auto-Sync Trigger
    useEffect(() => {
        if (hasUnsavedChanges && user && !isSyncing) {
            if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
            autoSyncTimerRef.current = setTimeout(() => {
                performSync();
            }, SYNC_DELAY_MS);
        }
        return () => {
            if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
        };
    }, [hasUnsavedChanges, user, performSync, isSyncing]);

    // --- Actions ---
    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        const id = Date.now().toString();
        const newMemory = { ...memory, id, date: new Date().toISOString() } as AnyMemory;
        setMemories(prev => [newMemory, ...prev]);
        setHasUnsavedChanges(true);
        return id;
    }, []);

    const deleteMemory = useCallback(async (id: string) => {
        setMemories(prev => prev.filter(m => m.id !== id));
        setHasUnsavedChanges(true);
    }, []);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        setMemories(prev => prev.map(m => m.id === id ? { ...m, ...updates } as AnyMemory : m));
        setHasUnsavedChanges(true);
    }, []);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        setMemories(prev => prev.filter(m => !ids.includes(m.id)));
        setHasUnsavedChanges(true);
    }, []);

    const addTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt'>) => {
        const id = (Date.now() + 1).toString();
        const newTask = { ...task, id, createdAt: new Date().toISOString() } as Task;
        setTasks(prev => [newTask, ...prev]);
        setHasUnsavedChanges(true);
    }, []);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
        setHasUnsavedChanges(true);
    }, []);

    const deleteTask = useCallback(async (id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id));
        setHasUnsavedChanges(true);
    }, []);

    const addCourse = useCallback(async (courseName: string) => {
        const name = courseName.trim();
        if (!name) return;
        setSavedCourses(prev => {
            if (prev.includes(name)) return prev;
            return [...prev, name];
        });
        setHasUnsavedChanges(true);
    }, []);

    const saveMoodleToken = useCallback(async (token: string) => {
        setMoodleToken(token);
        setHasUnsavedChanges(true);
    }, []);

    const connectGoogleCalendar = useCallback(async () => {
        if (!auth.currentUser) return;
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
        try {
            const result = await linkWithPopup(auth.currentUser, provider);
            const credential = GoogleAuthProvider.credentialFromResult(result);
            const accessToken = credential?.accessToken;
            if (accessToken) {
                localStorage.setItem('google_access_token', accessToken);
                setIsGoogleConnected(true);
                setHasUnsavedChanges(true);
            }
        } catch (error: any) {
            console.error("Failed to link Google Account", error);
            alert(`Could not connect to Google: ${error.message}`);
        }
    }, []);

    const disconnectGoogleCalendar = useCallback(async () => {
        if (!auth.currentUser) return;
        try {
            await unlink(auth.currentUser, 'google.com');
            localStorage.removeItem('google_access_token');
            setIsGoogleConnected(false);
            setHasUnsavedChanges(true);
        } catch (error: any) {
            console.error("Failed to unlink Google Account", error);
            alert(`Could not disconnect from Google: ${error.message}`);
        }
    }, []);

    return { 
        memories, tasks, courses, moodleToken, isGoogleConnected,
        addMemory, deleteMemory, bulkDeleteMemories, updateMemory, 
        addTask, updateTask, deleteTask, addCourse, saveMoodleToken,
        connectGoogleCalendar, disconnectGoogleCalendar,
        user, loading, isSyncing, hasUnsavedChanges, syncError, performSync,
        fetchFromCloud: performSync
    };
};
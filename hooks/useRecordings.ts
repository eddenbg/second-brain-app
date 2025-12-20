
import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory, WebMemory, Task } from '../types';
import { db, auth } from '../utils/firebase';
import { 
    collection, 
    getDocs,
    doc, 
    setDoc,
    writeBatch,
    query,
    orderBy
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
}

const LOCAL_STORAGE_KEY = 'second_brain_local_data';

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    // Load initial data from LocalStorage
    useEffect(() => {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                setMemories(data.memories || []);
                setTasks(data.tasks || []);
                setSavedCourses(data.courses || []);
            } catch (e) {
                console.error("Failed to parse local storage", e);
            }
        }
    }, []);

    // Derived courses from memories
    useEffect(() => {
        const extracted = Array.from(new Set(
            memories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        ));
        const uniqueCourses = Array.from(new Set([...extracted, ...savedCourses])).sort();
        setCourses(uniqueCourses);
    }, [memories, savedCourses]);

    // Handle Auth state
    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Save to local storage whenever state changes
    useEffect(() => {
        const data = { memories, tasks, courses: savedCourses };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }, [memories, tasks, savedCourses]);

    // --- Manual Cloud Actions ---

    const fetchFromCloud = useCallback(async () => {
        if (!user || !db || (db as any).type === 'mock') return;
        setIsSyncing(true);
        setSyncError(null);
        try {
            // 1. Fetch Memories
            const memoriesRef = collection(db, 'users', user.uid, 'memories');
            const qMemories = query(memoriesRef, orderBy('date', 'desc'));
            const memSnap = await getDocs(qMemories);
            const loadedMemories = memSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AnyMemory[];
            
            // 2. Fetch Tasks
            const tasksRef = collection(db, 'users', user.uid, 'tasks');
            const taskSnap = await getDocs(tasksRef);
            const loadedTasks = taskSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];

            // 3. Update local state
            setMemories(loadedMemories);
            setTasks(loadedTasks);
            setHasUnsavedChanges(false);
        } catch (error: any) {
            setSyncError("Failed to fetch from cloud: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    }, [user]);

    const performSync = useCallback(async () => {
        if (!user || !db || (db as any).type === 'mock') return;
        setIsSyncing(true);
        setSyncError(null);
        try {
            const batch = writeBatch(db);

            // This is a "Replace" strategy: we clear and rewrite to ensure the cloud matches the local exactly
            // For a single user, this is the most reliable way to avoid duplication or conflicts.
            
            // 1. Save Memories
            for (const mem of memories) {
                const docRef = doc(db, 'users', user.uid, 'memories', mem.id);
                batch.set(docRef, mem);
            }

            // 2. Save Tasks
            for (const task of tasks) {
                const docRef = doc(db, 'users', user.uid, 'tasks', task.id);
                batch.set(docRef, task);
            }

            // 3. Save Settings/Courses
            const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
            batch.set(settingsRef, { courses: savedCourses }, { merge: true });

            await batch.commit();
            setHasUnsavedChanges(false);
        } catch (error: any) {
            console.error("Sync failed", error);
            setSyncError("Sync failed: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks, savedCourses]);

    // --- Local Actions ---

    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        const id = Date.now().toString(); // Local ID generation
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
        setSavedCourses(prev => [...new Set([...prev, name])]);
        setHasUnsavedChanges(true);
    }, []);

    return { 
        memories, 
        tasks,
        courses,
        addMemory, 
        deleteMemory, 
        bulkDeleteMemories, 
        updateMemory, 
        addTask, 
        updateTask,
        deleteTask,
        addCourse, 
        user,
        loading,
        isSyncing,
        hasUnsavedChanges,
        syncError,
        performSync,
        fetchFromCloud
    };
};

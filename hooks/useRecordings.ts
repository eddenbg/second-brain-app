
import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory, WebMemory, Task } from '../types';
import { db, auth } from '../utils/firebase';
import { 
    collection, 
    query, 
    onSnapshot, 
    addDoc, 
    deleteDoc, 
    doc, 
    updateDoc, 
    orderBy
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
}

const LOCAL_STORAGE_KEY = 'second_brain_demo_data';

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    // 1. Listen for User Login/Logout
    useEffect(() => {
        // @ts-ignore
        if (auth && auth.type === 'mock') {
             // @ts-ignore
             const unsubscribe = auth.onAuthStateChanged((currentUser) => {
                setUser(currentUser);
                if (!currentUser) {
                    setMemories([]);
                    setTasks([]);
                    setCourses([]);
                }
                setLoading(false);
             });
             return () => unsubscribe();
        }

        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) {
                setMemories([]);
                setTasks([]);
                setCourses([]);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // 2. Subscribe to Database Changes (Real-time Sync) OR Local Storage
    useEffect(() => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            // Demo Mode: Load from Local Storage
            const loadLocalData = () => {
                try {
                    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                    if (stored) {
                        const data = JSON.parse(stored);
                        setMemories(data.memories || []);
                        setTasks(data.tasks || []);
                        
                        const extractedCourses = Array.from(new Set(
                            (data.memories || [])
                                .filter((m: AnyMemory) => m.category === 'college' && m.course)
                                .map((m: AnyMemory) => m.course as string)
                        )).sort() as string[];
                        setCourses(extractedCourses);
                    }
                } catch (e) {
                    console.error("Failed to load local demo data", e);
                }
            };
            loadLocalData();
            return;
        }

        try {
            // Subscribe to Memories
            const memoriesRef = collection(db, 'users', user.uid, 'memories');
            const qMemories = query(memoriesRef, orderBy('date', 'desc'));

            const unsubMemories = onSnapshot(qMemories, (snapshot) => {
                const loadedMemories = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as AnyMemory[];
                setMemories(loadedMemories);
                
                const extractedCourses = Array.from(new Set(
                    loadedMemories
                        .filter(m => m.category === 'college' && m.course)
                        .map(m => m.course as string)
                )).sort();
                
                setCourses(extractedCourses);
            }, (error) => {
                console.warn("Firestore memories snapshot error:", error);
            });

            // Subscribe to Tasks
            const tasksRef = collection(db, 'users', user.uid, 'tasks');
            const qTasks = query(tasksRef, orderBy('createdAt', 'desc'));
            
            const unsubTasks = onSnapshot(qTasks, (snapshot) => {
                const loadedTasks = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Task[];
                setTasks(loadedTasks);
            }, (error) => {
                 console.warn("Firestore tasks snapshot error:", error);
            });

            return () => {
                unsubMemories();
                unsubTasks();
            };
        } catch (e) {
            console.warn("Firestore subscription failed", e);
        }
    }, [user]);

    const saveToLocalStorage = (newMemories: AnyMemory[], newTasks: Task[]) => {
        const data = { memories: newMemories, tasks: newTasks };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        setMemories(newMemories);
        setTasks(newTasks);
        
        const extractedCourses = Array.from(new Set(
            newMemories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        )).sort() as string[];
        setCourses(extractedCourses);
    };

    // --- Memory Actions ---
    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        if (!user) return;
        setIsSyncing(true);

        const newMemoryBase = {
            ...memory,
            date: new Date().toISOString(),
            userId: user.uid
        };

        // @ts-ignore
        if (db && db.type === 'mock') {
            const newMemory = { ...newMemoryBase, id: Date.now().toString() } as unknown as AnyMemory;
            const updatedMemories = [newMemory, ...memories];
            saveToLocalStorage(updatedMemories, tasks);
            setIsSyncing(false);
            return;
        }

        try {
            await addDoc(collection(db, 'users', user.uid, 'memories'), newMemoryBase);
        } catch (error) {
            console.error("Error adding memory:", error);
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => m.id !== id);
            saveToLocalStorage(updatedMemories, tasks);
            return;
        }

        try {
            await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
        } catch (error) {
            console.error("Error deleting memory:", error);
        }
    }, [user, memories, tasks]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.map(m => m.id === id ? { ...m, ...updates } : m);
            saveToLocalStorage(updatedMemories, tasks);
            return;
        }

        try {
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating memory:", error);
        }
    }, [user, memories, tasks]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => !ids.includes(m.id));
            saveToLocalStorage(updatedMemories, tasks);
            return;
        }

        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user, memories, tasks]);

    // --- Task Actions ---
    const addTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt'>) => {
        if (!user) return;
        setIsSyncing(true);

        const newTaskBase = {
            ...task,
            createdAt: new Date().toISOString(),
            userId: user.uid
        };

        // @ts-ignore
        if (db && db.type === 'mock') {
            const newTask = { ...newTaskBase, id: Date.now().toString() } as unknown as Task;
            const updatedTasks = [newTask, ...tasks];
            saveToLocalStorage(memories, updatedTasks);
            setIsSyncing(false);
            return;
        }

        try {
            await addDoc(collection(db, 'users', user.uid, 'tasks'), newTaskBase);
        } catch (error) {
            console.error("Error adding task:", error);
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks]);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedTasks = tasks.map(t => t.id === id ? { ...t, ...updates } : t);
            saveToLocalStorage(memories, updatedTasks);
            return;
        }

        try {
            const docRef = doc(db, 'users', user.uid, 'tasks', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating task:", error);
        }
    }, [user, memories, tasks]);

    const deleteTask = useCallback(async (id: string) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedTasks = tasks.filter(t => t.id !== id);
            saveToLocalStorage(memories, updatedTasks);
            return;
        }

        try {
             await deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
        } catch (error) {
            console.error("Error deleting task:", error);
        }
    }, [user, memories, tasks]);

    const addCourse = useCallback((courseName: string) => {
        if (!courseName.trim()) return;
        setCourses(prev => [...new Set([...prev, courseName.trim()])]);
    }, []);

    const syncSharedClips = async () => 0;
    const loadBackup = () => {}; 

    return { 
        memories, 
        tasks,
        addMemory, 
        deleteMemory, 
        bulkDeleteMemories, 
        updateMemory, 
        addTask,
        updateTask,
        deleteTask,
        syncSharedClips, 
        pendingClipsCount: 0, 
        courses, 
        addCourse, 
        isSyncing, 
        loadBackup,
        user,
        loading
    };
};

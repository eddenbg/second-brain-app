
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
    orderBy,
    setDoc,
    arrayUnion
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
    
    // Split courses into those found in memories vs those manually added
    const [derivedCourses, setDerivedCourses] = useState<string[]>([]);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [courses, setCourses] = useState<string[]>([]);

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    // Combine derived and saved courses
    useEffect(() => {
        const uniqueCourses = Array.from(new Set([...derivedCourses, ...savedCourses])).sort();
        setCourses(uniqueCourses);
    }, [derivedCourses, savedCourses]);

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
                    setDerivedCourses([]);
                    setSavedCourses([]);
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
                setDerivedCourses([]);
                setSavedCourses([]);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // 2. Subscribe to Database Changes (Real-time Sync) OR Local Storage
    useEffect(() => {
        if (!user) return;
        setSyncError(null);

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
                        setSavedCourses(data.courses || []);
                        
                        const extracted = Array.from(new Set(
                            (data.memories || [])
                                .filter((m: AnyMemory) => m.category === 'college' && m.course)
                                .map((m: AnyMemory) => m.course as string)
                        )) as string[];
                        setDerivedCourses(extracted);
                    }
                } catch (e) {
                    console.error("Failed to load local demo data", e);
                }
            };
            loadLocalData();
            return;
        }

        try {
            // A. Subscribe to Memories
            const memoriesRef = collection(db, 'users', user.uid, 'memories');
            const qMemories = query(memoriesRef, orderBy('date', 'desc'));

            const unsubMemories = onSnapshot(qMemories, (snapshot) => {
                const loadedMemories = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as AnyMemory[];
                setMemories(loadedMemories);
                setSyncError(null);
                
                const extracted = Array.from(new Set(
                    loadedMemories
                        .filter(m => m.category === 'college' && m.course)
                        .map(m => m.course as string)
                ));
                setDerivedCourses(extracted);
            }, (error) => {
                console.warn("Firestore memories snapshot error:", error);
                if (error.code === 'permission-denied') {
                    setSyncError("Database Permission Denied. Please check Firestore Rules in Firebase Console.");
                } else {
                    setSyncError(`Sync Error: ${error.message}`);
                }
            });

            // B. Subscribe to Tasks
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
                 // Error is likely caught by the memories listener already
            });

            // C. Subscribe to Saved Courses (Settings)
            const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
            const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data && data.courses && Array.isArray(data.courses)) {
                        setSavedCourses(data.courses);
                    }
                } else {
                    // Initialize if missing
                    setSavedCourses([]);
                }
            }, (error) => {
                console.warn("Firestore settings snapshot error:", error);
            });

            return () => {
                unsubMemories();
                unsubTasks();
                unsubSettings();
            };
        } catch (e) {
            console.warn("Firestore subscription failed", e);
            setSyncError("Failed to connect to database.");
        }
    }, [user]);

    const saveToLocalStorage = (newMemories: AnyMemory[], newTasks: Task[], newSavedCourses: string[]) => {
        const data = { memories: newMemories, tasks: newTasks, courses: newSavedCourses };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        setMemories(newMemories);
        setTasks(newTasks);
        setSavedCourses(newSavedCourses);
        
        const extracted = Array.from(new Set(
            newMemories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        ));
        setDerivedCourses(extracted);
    };

    // --- Memory Actions ---
    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        if (!user) return null;
        setIsSyncing(true);

        const newMemoryBase = {
            ...memory,
            date: new Date().toISOString(),
            userId: user.uid
        };

        // @ts-ignore
        if (db && db.type === 'mock') {
            const id = Date.now().toString();
            const newMemory = { ...newMemoryBase, id } as unknown as AnyMemory;
            const updatedMemories = [newMemory, ...memories];
            saveToLocalStorage(updatedMemories, tasks, savedCourses);
            setIsSyncing(false);
            return id;
        }

        try {
            const docRef = await addDoc(collection(db, 'users', user.uid, 'memories'), newMemoryBase);
            return docRef.id;
        } catch (error) {
            console.error("Error adding memory:", error);
            return null;
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks, savedCourses]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => m.id !== id);
            saveToLocalStorage(updatedMemories, tasks, savedCourses);
            return;
        }

        try {
            await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
        } catch (error) {
            console.error("Error deleting memory:", error);
        }
    }, [user, memories, tasks, savedCourses]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.map(m => m.id === id ? { ...m, ...updates } as AnyMemory : m);
            saveToLocalStorage(updatedMemories, tasks, savedCourses);
            return;
        }

        try {
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating memory:", error);
        }
    }, [user, memories, tasks, savedCourses]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => !ids.includes(m.id));
            saveToLocalStorage(updatedMemories, tasks, savedCourses);
            return;
        }

        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user, memories, tasks, savedCourses]);

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
            saveToLocalStorage(memories, updatedTasks, savedCourses);
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
    }, [user, memories, tasks, savedCourses]);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedTasks = tasks.map(t => t.id === id ? { ...t, ...updates } : t);
            saveToLocalStorage(memories, updatedTasks, savedCourses);
            return;
        }

        try {
            const docRef = doc(db, 'users', user.uid, 'tasks', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating task:", error);
        }
    }, [user, memories, tasks, savedCourses]);

    const deleteTask = useCallback(async (id: string) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedTasks = tasks.filter(t => t.id !== id);
            saveToLocalStorage(memories, updatedTasks, savedCourses);
            return;
        }

        try {
             await deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
        } catch (error) {
            console.error("Error deleting task:", error);
        }
    }, [user, memories, tasks, savedCourses]);

    // --- Course Actions ---
    const addCourse = useCallback(async (courseName: string) => {
        if (!user || !courseName.trim()) return;
        const name = courseName.trim();
        
        // @ts-ignore
        if (db && db.type === 'mock') {
            const newSaved = [...new Set([...savedCourses, name])];
            saveToLocalStorage(memories, tasks, newSaved);
            return;
        }

        try {
            const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
            await setDoc(settingsRef, {
                courses: arrayUnion(name)
            }, { merge: true });
        } catch (error) {
            console.error("Error adding course:", error);
        }
    }, [user, memories, tasks, savedCourses]);

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
        loading,
        syncError
    };
};

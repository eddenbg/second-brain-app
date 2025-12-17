
import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory, WebMemory } from '../types';
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
}

const LOCAL_STORAGE_KEY = 'second_brain_demo_data';

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
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
                        setMemories(data);
                        const extractedCourses = Array.from(new Set(
                            data
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
            const memoriesRef = collection(db, 'users', user.uid, 'memories');
            const q = query(memoriesRef, orderBy('date', 'desc'));

            const unsubscribe = onSnapshot(q, (snapshot) => {
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
                console.warn("Firestore snapshot error:", error);
            });

            return () => unsubscribe();
        } catch (e) {
            console.warn("Firestore subscription failed", e);
        }
    }, [user]);

    const saveToLocalStorage = (newMemories: AnyMemory[]) => {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newMemories));
        setMemories(newMemories);
        const extractedCourses = Array.from(new Set(
            newMemories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        )).sort() as string[];
        setCourses(extractedCourses);
    };

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
            // Demo Mode
            const newMemory = { ...newMemoryBase, id: Date.now().toString() } as unknown as AnyMemory;
            const updatedMemories = [newMemory, ...memories];
            saveToLocalStorage(updatedMemories);
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
    }, [user, memories]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => m.id !== id);
            saveToLocalStorage(updatedMemories);
            return;
        }

        try {
            await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
        } catch (error) {
            console.error("Error deleting memory:", error);
        }
    }, [user, memories]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.map(m => m.id === id ? { ...m, ...updates } : m);
            saveToLocalStorage(updatedMemories);
            return;
        }

        try {
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating memory:", error);
        }
    }, [user, memories]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user) return;

        // @ts-ignore
        if (db && db.type === 'mock') {
            const updatedMemories = memories.filter(m => !ids.includes(m.id));
            saveToLocalStorage(updatedMemories);
            return;
        }

        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user, memories]);

    const addCourse = useCallback((courseName: string) => {
        if (!courseName.trim()) return;
        setCourses(prev => [...new Set([...prev, courseName.trim()])]);
    }, []);

    const syncSharedClips = async () => 0;
    const loadBackup = () => {}; 

    return { 
        memories, 
        addMemory, 
        deleteMemory, 
        bulkDeleteMemories, 
        updateMemory, 
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

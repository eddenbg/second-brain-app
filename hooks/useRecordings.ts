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

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    // Monitor Auth State
    useEffect(() => {
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

    // Subscribe to Memories Data
    useEffect(() => {
        if (!user) return;

        const memoriesRef = collection(db, 'users', user.uid, 'memories');
        const q = query(memoriesRef, orderBy('date', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedMemories = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as AnyMemory[];
            setMemories(loadedMemories);
            
            // Extract unique courses from memories
            const extractedCourses = Array.from(new Set(
                loadedMemories
                    .filter(m => m.category === 'college' && m.course)
                    .map(m => m.course as string)
            )).sort();
            
            setCourses(extractedCourses);
        });

        return () => unsubscribe();
    }, [user]);

    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        if (!user) return;
        setIsSyncing(true);
        try {
            const newMemory = {
                ...memory,
                date: new Date().toISOString(),
                userId: user.uid
            };
            await addDoc(collection(db, 'users', user.uid, 'memories'), newMemory);
        } catch (error) {
            console.error("Error adding memory:", error);
        } finally {
            setIsSyncing(false);
        }
    }, [user]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
        } catch (error) {
            console.error("Error deleting memory:", error);
        }
    }, [user]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user) return;
        try {
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating memory:", error);
        }
    }, [user]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user) return;
        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user]);

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
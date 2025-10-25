import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { getFirebase } from '../utils/firebase';
import { collection, doc, onSnapshot, addDoc, deleteDoc, updateDoc, writeBatch, query, orderBy, setDoc } from 'firebase/firestore';
import type { AnyMemory, WebMemory } from '../types';

export const useRecordings = (user: User | null) => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [pendingClipsCount, setPendingClipsCount] = useState(0);

    // This part for Netlify share target is disabled as it's not supported in this environment.
    const fetchPendingClipsCount = useCallback(async () => {
        // This feature relies on Netlify functions which are not available.
        setPendingClipsCount(0);
    }, []);

    useEffect(() => {
        // Disabled polling for pending clips.
        fetchPendingClipsCount();
    }, [fetchPendingClipsCount]);


    // Firebase logic
    useEffect(() => {
        if (!user) {
            setMemories([]);
            setCourses([]);
            return;
        }

        let memoriesUnsubscribe: (() => void) | undefined;
        let coursesUnsubscribe: (() => void) | undefined;

        const setupListeners = async () => {
            const { db } = await getFirebase();
            if (!db) return;
            
            // Memories listener
            const memoriesCollectionRef = collection(db, 'users', user.uid, 'memories');
            const q = query(memoriesCollectionRef, orderBy('date', 'desc'));
            memoriesUnsubscribe = onSnapshot(q, (snapshot) => {
                const memoriesData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                })) as AnyMemory[];
                setMemories(memoriesData);
            }, (error) => {
                console.error("Error listening to memories:", error);
            });

            // Courses listener
            const userDocRef = doc(db, 'users', user.uid);
            coursesUnsubscribe = onSnapshot(userDocRef, (doc) => {
                if (doc.exists()) {
                    setCourses(doc.data().manualCourses || []);
                } else {
                    setCourses([]);
                }
            }, (error) => {
                 console.error("Error listening to courses:", error);
            });
        };

        setupListeners();

        return () => {
            if (memoriesUnsubscribe) memoriesUnsubscribe();
            if (coursesUnsubscribe) coursesUnsubscribe();
        };
    }, [user]);

    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        if (!user) return;
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");
            const memoriesCollectionRef = collection(db, 'users', user.uid, 'memories');
            
            // FIX: Spreading a discriminated union (`Omit<AnyMemory,...>`) creates an object
            // that TypeScript cannot verify as a valid `AnyMemory`. This was causing an error
            // on the `setMemories` call. Casting through `any` bypasses this strict check.
            // This is safe because downstream code discriminates memories by `type`.
            const newMemory: AnyMemory = {
                ...memory,
                id: crypto.randomUUID(), // Temp client-side id, Firestore will generate its own.
                date: new Date().toISOString(),
            } as unknown as AnyMemory;
            
            const { id, ...memoryData } = newMemory;

            await addDoc(memoriesCollectionRef, memoryData);
        } catch (error) {
            console.error("Error adding memory:", error);
        }
    }, [user]);
    
    // syncSharedClips is disabled as it relies on Netlify functions.
    const syncSharedClips = useCallback(async (): Promise<number> => {
        if (!user) return 0;
        console.warn("Web clip syncing is disabled in this environment.");
        setPendingClipsCount(0);
        return 0;
    }, [user]);


    const deleteMemory = useCallback(async (id: string) => {
        if (!user) return;
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await deleteDoc(docRef);
        } catch (error) {
            console.error("Error deleting memory:", error);
        }
    }, [user]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user || ids.length === 0) return;
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");
            const batch = writeBatch(db);
            ids.forEach(id => {
                const docRef = doc(db, 'users', user.uid, 'memories', id);
                batch.delete(docRef);
            });
            await batch.commit();
        } catch (error) {
            console.error("Error bulk deleting memories:", error);
        }
    }, [user]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user) return;
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");
            const docRef = doc(db, 'users', user.uid, 'memories', id);
            await updateDoc(docRef, updates);
        } catch (error) {
            console.error("Error updating memory:", error);
        }
    }, [user]);

    const addCourse = useCallback(async (courseName: string) => {
        if (!user || !courseName.trim()) return;
        const newCourses = [...new Set([...courses, courseName.trim()])];
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");
            const userDocRef = doc(db, 'users', user.uid);
            await setDoc(userDocRef, { manualCourses: newCourses }, { merge: true });
        } catch (error) {
            console.error("Error adding course:", error);
        }
    }, [user, courses]);

    return { memories, addMemory, deleteMemory, bulkDeleteMemories, updateMemory, syncSharedClips, pendingClipsCount, courses, addCourse };
};
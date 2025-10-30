import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { getFirebase } from '../utils/firebase';
import { collection, doc, onSnapshot, addDoc, deleteDoc, updateDoc, writeBatch, query, orderBy, setDoc } from 'firebase/firestore';
import type { AnyMemory, WebMemory } from '../types';

// FIX: Updated the SharedClip interface to accurately represent the data from the blob store.
// The previous type was incorrect and was missing the 'date' property.
interface SharedClip {
    key: string;
    data: {
        id: string;
        url: string;
        title: string;
        content: string;
        date: string;
    };
}

export const useRecordings = (user: User | null) => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [pendingClipsCount, setPendingClipsCount] = useState(0);

    const fetchPendingClipsCount = useCallback(async () => {
        try {
            const response = await fetch('/netlify/functions/getSharedClips');
            if (response.ok) {
                const clips: SharedClip[] = await response.json();
                setPendingClipsCount(clips.length);
            } else {
                setPendingClipsCount(0);
            }
        } catch (error) {
            console.error("Error fetching pending clips count:", error);
            setPendingClipsCount(0);
        }
    }, []);

    useEffect(() => {
        if (user) {
            fetchPendingClipsCount();
            const intervalId = setInterval(fetchPendingClipsCount, 30000); // Poll every 30 seconds
            return () => clearInterval(intervalId);
        }
    }, [user, fetchPendingClipsCount]);


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
    
    const syncSharedClips = useCallback(async (): Promise<number> => {
        if (!user) return 0;
        try {
            const { db } = await getFirebase();
            if (!db) throw new Error("Firestore not available");

            const response = await fetch('/netlify/functions/getSharedClips');
            if (!response.ok) throw new Error("Failed to fetch clips");

            const clipsToSync: SharedClip[] = await response.json();
            if (clipsToSync.length === 0) {
                setPendingClipsCount(0);
                return 0;
            }

            const batch = writeBatch(db);
            const memoriesCollectionRef = collection(db, 'users', user.uid, 'memories');

            clipsToSync.forEach(clip => {
                const newMemory = {
                    ...clip.data,
                    type: 'web',
                    category: 'personal',
                    date: new Date(clip.data.date || Date.now()).toISOString(),
                };
                const docRef = doc(memoriesCollectionRef); // Create a new doc with a generated ID
                batch.set(docRef, newMemory);
            });

            await batch.commit();

            // After successful sync, delete clips from blobs
            for (const clip of clipsToSync) {
                await fetch('/netlify/functions/deleteSharedClip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: clip.key }),
                });
            }
            
            setPendingClipsCount(0);
            return clipsToSync.length;

        } catch (error) {
            console.error("Error syncing web clips:", error);
            return 0;
        }
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
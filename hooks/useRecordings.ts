import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory, WebMemory } from '../types';

const MEMORIES_STORAGE_KEY = 'second-brain-memories';

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [pendingClipsCount, setPendingClipsCount] = useState(0);

    useEffect(() => {
        try {
            const storedMemories = localStorage.getItem(MEMORIES_STORAGE_KEY);
            if (storedMemories) {
                setMemories(JSON.parse(storedMemories));
            }
        } catch (error) {
            console.error("Failed to load memories from localStorage", error);
        }
        fetchPendingClipsCount();
    }, []);

    const fetchPendingClipsCount = useCallback(async () => {
        try {
            const response = await fetch('/netlify/functions/getSharedClips');
            if (response.ok) {
                const clips = await response.json();
                setPendingClipsCount(clips.length);
            }
        } catch (error) {
            console.error("Failed to fetch pending clips count", error);
        }
    }, []);

    const syncSharedClips = useCallback(async (): Promise<number> => {
        try {
            const response = await fetch('/netlify/functions/getSharedClips');
            if (!response.ok) throw new Error("Failed to fetch shared clips");
            
            const sharedClips: (Omit<WebMemory, 'id' | 'date' | 'category'> & { id: string, date: string })[] = await response.json();

            if (sharedClips.length > 0) {
                const newMemories = sharedClips.map(clip => ({
                    ...clip,
                    type: 'web',
                    category: 'personal',
                } as AnyMemory));

                let addedCount = 0;
                setMemories(prev => {
                    const existingIds = new Set(prev.map(m => m.id));
                    const trulyNewMemories = newMemories.filter(m => !existingIds.has(m.id));
                    addedCount = trulyNewMemories.length;

                    if (addedCount === 0) return prev;

                    const updatedMemories = [...prev, ...trulyNewMemories].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                    localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
                    return updatedMemories;
                });

                // Delete them from the server after syncing
                for (const clip of sharedClips) {
                    await fetch('/netlify/functions/deleteSharedClip', {
                        method: 'POST',
                        body: JSON.stringify({ key: clip.id }),
                    });
                }
                setPendingClipsCount(0);
                return addedCount;
            }
            setPendingClipsCount(0);
            return 0;
        } catch (error) {
            console.error("Failed to sync shared clips", error);
            return 0;
        }
    }, []);

    const addMemory = useCallback((memory: Omit<AnyMemory, 'id' | 'date'>) => {
        setMemories(prev => {
            // FIX: Spreading a discriminated union (`Omit<AnyMemory,...>`) creates an object
            // that TypeScript cannot verify as a valid `AnyMemory`. This was causing an error
            // on the `setMemories` call. Casting through `any` bypasses this strict check.
            // This is safe because downstream code discriminates memories by `type`.
            const newMemory: AnyMemory = {
                ...memory,
                id: crypto.randomUUID(),
                date: new Date().toISOString(),
            } as unknown as AnyMemory;
            const updatedMemories = [newMemory, ...prev];
            localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
            return updatedMemories;
        });
    }, []);

    const deleteMemory = useCallback((id: string) => {
        setMemories(prev => {
            const updatedMemories = prev.filter(mem => mem.id !== id);
            localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
            return updatedMemories;
        });
    }, []);

    const bulkDeleteMemories = useCallback((ids: string[]) => {
        setMemories(prev => {
            const updatedMemories = prev.filter(mem => !ids.includes(mem.id));
            localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
            return updatedMemories;
        });
    }, []);

    const updateMemory = useCallback((id: string, updates: Partial<AnyMemory>) => {
        setMemories(prev => {
            // FIX: Spreading a discriminated union with a partial update can lead to an invalid type.
            // The cast ensures TypeScript treats the result as a valid `AnyMemory`.
            const updatedMemories = prev.map(mem => mem.id === id ? ({ ...mem, ...updates } as AnyMemory) : mem);
            localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
            return updatedMemories;
        });
    }, []);
    
    useEffect(() => {
        fetchPendingClipsCount();
        const interval = setInterval(fetchPendingClipsCount, 30000); // Check for new clips every 30s
        return () => clearInterval(interval);
    }, [fetchPendingClipsCount]);


    return { memories, addMemory, deleteMemory, bulkDeleteMemories, updateMemory, syncSharedClips, pendingClipsCount };
};
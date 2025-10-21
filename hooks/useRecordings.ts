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

    const syncSharedClips = useCallback(async () => {
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

                setMemories(prev => {
                    const updatedMemories = [...prev, ...newMemories].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
            }
            setPendingClipsCount(0);
        } catch (error) {
            console.error("Failed to sync shared clips", error);
        }
    }, []);

    const addMemory = useCallback((memory: Omit<AnyMemory, 'id' | 'date'>) => {
        setMemories(prev => {
            const newMemory: AnyMemory = {
                ...memory,
                id: crypto.randomUUID(),
                date: new Date().toISOString(),
            } as AnyMemory;
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

    const updateMemory = useCallback((id: string, updates: Partial<AnyMemory>) => {
        setMemories(prev => {
            const updatedMemories = prev.map(mem => mem.id === id ? { ...mem, ...updates } : mem);
            localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(updatedMemories));
            return updatedMemories;
        });
    }, []);
    
    useEffect(() => {
        fetchPendingClipsCount();
        const interval = setInterval(fetchPendingClipsCount, 30000); // Check for new clips every 30s
        return () => clearInterval(interval);
    }, [fetchPendingClipsCount]);


    return { memories, addMemory, deleteMemory, updateMemory, syncSharedClips, pendingClipsCount };
};

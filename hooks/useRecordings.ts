import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnyMemory, WebMemory } from '../types';

// Debounce hook
const useDebounce = (callback: (...args: any[]) => void, delay: number) => {
    const timeoutRef = useRef<number | null>(null);
    return (...args: any[]) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
            callback(...args);
        }, delay);
    };
};

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

interface StoredData {
    memories: AnyMemory[];
    courses: string[];
}
const LOCAL_STORAGE_KEY = 'second-brain-data';

export const useRecordings = (syncId: string | null) => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [pendingClipsCount, setPendingClipsCount] = useState(0);

    // Load initial data from local storage
    useEffect(() => {
        try {
            const localData = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (localData) {
                const parsed: StoredData = JSON.parse(localData);
                setMemories(parsed.memories || []);
                setCourses(parsed.courses || []);
            }
        } catch (error) {
            console.error("Failed to load data from local storage", error);
        }
    }, []);

    // Persist to local storage whenever data changes
    useEffect(() => {
        try {
            const data: StoredData = { memories, courses };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.error("Failed to save data to local storage", error);
        }
    }, [memories, courses]);

    const pushToRemote = useCallback(async (data: StoredData) => {
        if (!syncId || isSyncing) return;
        setIsSyncing(true);
        try {
            await fetch(`/netlify/functions/sync?syncId=${syncId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
        } catch (error) {
            console.error("Failed to push data to remote", error);
        } finally {
            setIsSyncing(false);
        }
    }, [syncId, isSyncing]);

    const debouncedPush = useDebounce(pushToRemote, 2000);

    // Effect to trigger debounced push when data changes
    useEffect(() => {
        if (syncId) {
            debouncedPush({ memories, courses });
        }
    }, [memories, courses, syncId, debouncedPush]);

    // Pull from remote when syncId is available
    useEffect(() => {
        const pullFromRemote = async () => {
            if (!syncId) return;
            setIsSyncing(true);
            try {
                const response = await fetch(`/netlify/functions/sync?syncId=${syncId}`);
                if (response.ok) {
                    const data: StoredData = await response.json();
                    setMemories(data.memories || []);
                    setCourses(data.courses || []);
                }
            } catch (error) {
                console.error("Failed to pull data from remote", error);
            } finally {
                setIsSyncing(false);
            }
        };
        pullFromRemote();
    }, [syncId]);

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
        fetchPendingClipsCount();
        const intervalId = setInterval(fetchPendingClipsCount, 30000); // Poll every 30 seconds
        return () => clearInterval(intervalId);
    }, [fetchPendingClipsCount]);

    const addMemory = useCallback(async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
        const newMemory: AnyMemory = {
            ...memory,
            id: crypto.randomUUID(),
            date: new Date().toISOString(),
        } as unknown as AnyMemory;
        setMemories(prev => [newMemory, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }, []);

    const syncSharedClips = useCallback(async (): Promise<number> => {
        try {
            const response = await fetch('/netlify/functions/getSharedClips');
            if (!response.ok) throw new Error("Failed to fetch clips");

            const clipsToSync: SharedClip[] = await response.json();
            if (clipsToSync.length === 0) {
                setPendingClipsCount(0);
                return 0;
            }

            const newMemories = clipsToSync.map(clip => {
                const newMemory: WebMemory = {
                    type: 'web',
                    category: 'personal',
                    id: crypto.randomUUID(),
                    date: new Date(clip.data.date || Date.now()).toISOString(),
                    url: clip.data.url,
                    title: clip.data.title,
                    content: clip.data.content,
                };
                return newMemory;
            });
            
            setMemories(prev => [...newMemories, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));

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
    }, []);

    const deleteMemory = useCallback(async (id: string) => {
        setMemories(prev => prev.filter(m => m.id !== id));
    }, []);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        const idSet = new Set(ids);
        setMemories(prev => prev.filter(m => !idSet.has(m.id)));
    }, []);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        setMemories(prev => prev.map(m => m.id === id ? { ...m, ...updates } as unknown as AnyMemory : m));
    }, []);

    const addCourse = useCallback(async (courseName: string) => {
        if (!courseName.trim()) return;
        setCourses(prev => [...new Set([...prev, courseName.trim()])]);
    }, []);

    return { memories, addMemory, deleteMemory, bulkDeleteMemories, updateMemory, syncSharedClips, pendingClipsCount, courses, addCourse, isSyncing };
};
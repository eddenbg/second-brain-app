
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

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
}
const LOCAL_STORAGE_KEY = 'second-brain-data';

export const useRecordings = (syncId: string | null) => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
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
        if (!syncId || isSyncing || isOffline) return;
        setIsSyncing(true);
        try {
            const response = await fetch(`/api/sync?syncId=${syncId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                setIsOffline(true);
            }
        } catch (error) {
            console.error("Failed to push data to remote", error);
            setIsOffline(true);
        } finally {
            setIsSyncing(false);
        }
    }, [syncId, isSyncing, isOffline]);

    const debouncedPush = useDebounce(pushToRemote, 2000);

    // Effect to trigger debounced push when data changes
    useEffect(() => {
        if (syncId && !isOffline) {
            debouncedPush({ memories, courses });
        }
    }, [memories, courses, syncId, debouncedPush, isOffline]);

    // Pull from remote when syncId is available
    useEffect(() => {
        const pullFromRemote = async () => {
            if (!syncId || isOffline) return;
            setIsSyncing(true);
            try {
                const response = await fetch(`/api/sync?syncId=${syncId}`);
                
                const contentType = response.headers.get("content-type");
                if (!response.ok || (contentType && contentType.includes("text/html"))) {
                    console.log("Backend unavailable, switching to Local Mode.");
                    setIsOffline(true);
                    return;
                }

                const data: StoredData = await response.json();
                
                const remoteHasData = data.memories && data.memories.length > 0;
                const localHasData = memories.length > 0;

                if (remoteHasData) {
                    setMemories(data.memories || []);
                    setCourses(data.courses || []);
                } else if (localHasData && !remoteHasData) {
                    pushToRemote({ memories, courses });
                }
            } catch (error) {
                console.error("Failed to pull data from remote, switching to offline mode", error);
                setIsOffline(true);
            } finally {
                setIsSyncing(false);
            }
        };
        pullFromRemote();
    }, [syncId]);

    const fetchPendingClipsCount = useCallback(async () => {
        if (isOffline) return;
        try {
            const response = await fetch('/api/shared-clips');
            const contentType = response.headers.get("content-type");
            if (response.ok && contentType && !contentType.includes("text/html")) {
                const clips: SharedClip[] = await response.json();
                setPendingClipsCount(clips.length);
            } else {
                setPendingClipsCount(0);
            }
        } catch (error) {
            setPendingClipsCount(0);
        }
    }, [isOffline]);

    useEffect(() => {
        fetchPendingClipsCount();
        const intervalId = setInterval(fetchPendingClipsCount, 30000);
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
        if (isOffline) return 0;
        try {
            const response = await fetch('/api/shared-clips');
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

            for (const clip of clipsToSync) {
                await fetch('/api/shared-clips', {
                    method: 'DELETE',
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
    }, [isOffline]);

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

    const loadBackup = useCallback((data: StoredData) => {
        if (data.memories) setMemories(data.memories);
        if (data.courses) setCourses(data.courses);
        // Force save to local storage immediately
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }, []);

    return { 
        memories, 
        addMemory, 
        deleteMemory, 
        bulkDeleteMemories, 
        updateMemory, 
        syncSharedClips, 
        pendingClipsCount, 
        courses, 
        addCourse, 
        isSyncing, 
        loadBackup 
    };
};

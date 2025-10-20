import { useState, useEffect, useCallback } from 'react';
import type { AnyMemory } from '../types';

const STORAGE_KEY = 'personal-memory-ai-memories';

export function useMemories() {
  const [memories, setMemories] = useState<AnyMemory[]>([]);

  useEffect(() => {
    try {
      const storedMemories = localStorage.getItem(STORAGE_KEY);
      if (storedMemories) {
        setMemories(JSON.parse(storedMemories));
      }
    } catch (error) {
      console.error("Failed to load memories from localStorage", error);
    }
  }, []);

  const saveMemories = useCallback((updatedMemories: AnyMemory[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMemories));
      setMemories(updatedMemories);
    } catch (error) {
      console.error("Failed to save memories to localStorage", error);
    }
  }, []);

  const addMemory = useCallback((newMemory: AnyMemory) => {
    const updatedMemories = [newMemory, ...memories];
    saveMemories(updatedMemories);
  }, [memories, saveMemories]);

  const deleteMemory = useCallback((id: string) => {
    const updatedMemories = memories.filter(mem => mem.id !== id);
    saveMemories(updatedMemories);
  }, [memories, saveMemories]);

  const updateMemoryTitle = useCallback((id: string, newTitle: string) => {
    const updatedMemories = memories.map(mem => 
      mem.id === id ? { ...mem, title: newTitle } : mem
    );
    saveMemories(updatedMemories);
  }, [memories, saveMemories]);

  return { memories, addMemory, deleteMemory, updateMemoryTitle };
}

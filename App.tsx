
import type { AnyMemory, Task } from '../types';

export interface SearchResult {
    item: AnyMemory | Task;
    type: 'memory' | 'task';
    score: number;
    link: string;
}

/**
 * Simple fuzzy search for memories and tasks.
 * In a real V2, this could be vector-based, but for now we use weighted keyword matching.
 */
export function searchMemories(
    query: string, 
    memories: AnyMemory[], 
    tasks: Task[]
): SearchResult[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results: SearchResult[] = [];

    // Search Memories
    memories.forEach(m => {
        let score = 0;
        const title = (m.title || '').toLowerCase();
        const content = ('content' in m ? m.content : 'transcript' in m ? m.transcript : 'extractedText' in m ? m.extractedText : '').toLowerCase();
        
        if (title.includes(q)) score += 10;
        if (content.includes(q)) score += 5;
        
        if (score > 0) {
            results.push({
                item: m,
                type: 'memory',
                score,
                link: getDeepLink(m)
            });
        }
    });

    // Search Tasks
    tasks.forEach(t => {
        let score = 0;
        const title = t.title.toLowerCase();
        const desc = (t.description || '').toLowerCase();

        if (title.includes(q)) score += 10;
        if (desc.includes(q)) score += 5;

        if (score > 0) {
            results.push({
                item: t,
                type: 'task',
                score,
                link: `#task-${t.id}` // Simplified link
            });
        }
    });

    return results.sort((a, b) => b.score - a.score);
}

function getDeepLink(memory: AnyMemory): string {
    // Logic to determine the internal route/tab for the memory
    const category = memory.category === 'college' ? 'college' : 'personal';
    return `/${category}/${memory.type}/${memory.id}`;
}

import React, { useState, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import type { AnyMemory } from '../types';

interface SearchBarProps {
    memories: AnyMemory[];
    onResults: (filtered: AnyMemory[]) => void;
    placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({
    memories,
    onResults,
    placeholder = 'Search notes, recordings, web clips...'
}) => {
    const [query, setQuery] = useState('');

    const handleSearch = useCallback((searchQuery: string) => {
        setQuery(searchQuery);

        if (!searchQuery.trim()) {
            onResults(memories);
            return;
        }

        const lowerQuery = searchQuery.toLowerCase();
        const filtered = memories.filter(mem => {
            // Search across title
            if (mem.title.toLowerCase().includes(lowerQuery)) return true;

            // Search across transcripts (for voice notes)
            if ((mem as any).transcript?.toLowerCase().includes(lowerQuery)) return true;

            // Search across summaries
            if ((mem as any).summary?.toLowerCase().includes(lowerQuery)) return true;

            // Search across extracted text (for documents)
            if ((mem as any).extractedText?.toLowerCase().includes(lowerQuery)) return true;

            // Search across content (for web clips)
            if ((mem as any).content?.toLowerCase().includes(lowerQuery)) return true;

            // Search across description (for physical items)
            if ((mem as any).description?.toLowerCase().includes(lowerQuery)) return true;

            // Search across tags
            if (mem.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))) return true;

            // Search across topics
            if (mem.topics?.some(topic => topic.toLowerCase().includes(lowerQuery))) return true;

            return false;
        });

        onResults(filtered);
    }, [memories, onResults]);

    const clearSearch = useCallback(() => {
        setQuery('');
        onResults(memories);
    }, [memories, onResults]);

    return (
        <div className="w-full flex items-center gap-3">
            <div className="flex-grow relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 pointer-events-none" strokeWidth={3} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={placeholder}
                    className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white/10 border-2 border-white/20 text-white placeholder-white/40 font-bold text-sm focus:outline-none focus:border-white/60 focus:bg-white/15 transition-all"
                />
            </div>
            {query && (
                <button
                    onClick={clearSearch}
                    className="p-3 rounded-xl bg-white/10 hover:bg-white/20 transition-all active:scale-90"
                    aria-label="Clear search"
                >
                    <X className="w-5 h-5 text-white" strokeWidth={3} />
                </button>
            )}
        </div>
    );
};

export default SearchBar;

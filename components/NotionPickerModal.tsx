import React, { useState, useEffect, useCallback } from 'react';
import type { NotionPage } from '../services/notionService';
import { searchNotionPages } from '../services/notionService';
import { XIcon, SearchIcon, Loader2Icon } from './Icons';

interface NotionPickerModalProps {
    token: string;
    onClose: () => void;
    onImport: (page: NotionPage) => void;
    importedUrls: Set<string>;
}

const NOTION_LOGO = (
    <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center shrink-0">
        <span className="text-white font-black text-base leading-none">N</span>
    </div>
);

const NotionPickerModal: React.FC<NotionPickerModalProps> = ({ token, onClose, onImport, importedUrls }) => {
    const [pages, setPages] = useState<NotionPage[]>([]);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadPages = useCallback(async (q: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const results = await searchNotionPages(token, q);
            setPages(results);
        } catch (e: any) {
            setError(e.message?.includes('401') || e.message?.includes('403')
                ? 'Invalid token. Check your integration token in Settings.'
                : 'Could not load Notion pages. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => { loadPages(''); }, [loadPages]);

    useEffect(() => {
        const id = setTimeout(() => loadPages(query), 400);
        return () => clearTimeout(id);
    }, [query, loadPages]);

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                <header className="flex items-center gap-4 px-6 py-4 border-b-2 border-gray-700 shrink-0">
                    <div className="w-10 h-10 bg-black rounded-2xl flex items-center justify-center shrink-0">
                        {NOTION_LOGO}
                    </div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter flex-grow">Notion Pages</h2>
                    <button onClick={onClose} className="p-2 bg-gray-700 rounded-xl">
                        <XIcon className="w-6 h-6 text-white" />
                    </button>
                </header>

                <div className="px-4 py-3 shrink-0">
                    <div className="relative">
                        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search pages..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            className="w-full bg-gray-900 pl-10 pr-4 py-3 rounded-2xl border-2 border-gray-700 text-white font-bold text-sm outline-none focus:border-purple-500"
                        />
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto px-4 pb-6 space-y-2 min-h-0">
                    {isLoading && (
                        <div className="flex justify-center py-12">
                            <Loader2Icon className="w-8 h-8 animate-spin text-purple-400" />
                        </div>
                    )}
                    {error && <p className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>}
                    {!isLoading && !error && pages.length === 0 && (
                        <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                            No pages found — make sure you shared them with your integration
                        </p>
                    )}
                    {!isLoading && pages.map(page => {
                        const isImported = importedUrls.has(page.url);
                        return (
                            <div key={page.id} className="flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-sm">N</span>
                                </div>
                                <div className="flex-grow min-w-0">
                                    <p className="font-black text-white text-sm truncate">{page.title || 'Untitled'}</p>
                                    <p className="text-[10px] text-gray-500 font-bold mt-0.5">
                                        {new Date(page.lastEdited).toLocaleDateString()}
                                    </p>
                                </div>
                                <button
                                    onClick={() => !isImported && onImport(page)}
                                    disabled={isImported}
                                    className={`px-4 py-2 rounded-xl font-black text-xs uppercase shrink-0 transition-all ${
                                        isImported
                                            ? 'bg-green-800 text-green-400'
                                            : 'bg-purple-600 text-white active:scale-95'
                                    }`}
                                >
                                    {isImported ? 'Added ✓' : 'Import'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default NotionPickerModal;

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { NotionPage } from '../services/notionService';
import { searchNotionPages } from '../services/notionService';
import { XIcon, SearchIcon, Loader2Icon, ArrowLeftIcon } from './Icons';

interface NotionPickerModalProps {
    token: string;
    onClose: () => void;
    onImport: (page: NotionPage) => void;
    importedUrls: Set<string>;
}

const NotionPickerModal: React.FC<NotionPickerModalProps> = ({ token, onClose, onImport, importedUrls }) => {
    const [allPages, setAllPages] = useState<NotionPage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [navStack, setNavStack] = useState<Array<{ id: string | null; title: string }>>(
        [{ id: null, title: 'Workspace' }]
    );
    const [searchMode, setSearchMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<NotionPage[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const currentNav = navStack[navStack.length - 1];

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        searchNotionPages(token, '')
            .then(setAllPages)
            .catch((e: any) => setError(
                e.message?.includes('401') || e.message?.includes('403')
                    ? 'Invalid token. Check your integration token in Settings.'
                    : 'Could not load Notion pages. Please try again.'
            ))
            .finally(() => setIsLoading(false));
    }, [token]);

    const visiblePages = useMemo(() => {
        if (currentNav.id === null) return allPages.filter(p => !p.parentId);
        return allPages.filter(p => p.parentId === currentNav.id);
    }, [allPages, currentNav.id]);

    const parentIds = useMemo(() => new Set(allPages.map(p => p.parentId).filter(Boolean)), [allPages]);

    useEffect(() => {
        if (!searchMode || !searchQuery.trim()) { setSearchResults([]); return; }
        const id = setTimeout(async () => {
            setIsSearching(true);
            try {
                const results = await searchNotionPages(token, searchQuery);
                setSearchResults(results);
            } catch { setSearchResults([]); }
            finally { setIsSearching(false); }
        }, 400);
        return () => clearTimeout(id);
    }, [searchQuery, token, searchMode]);

    const openPage = (page: NotionPage) => {
        setNavStack(prev => [...prev, { id: page.id, title: page.title || 'Untitled' }]);
    };

    const goBack = () => {
        if (navStack.length > 1) setNavStack(prev => prev.slice(0, -1));
    };

    const goToIndex = (index: number) => {
        setNavStack(prev => prev.slice(0, index + 1));
    };

    const toggleSearch = () => {
        setSearchMode(s => !s);
        setSearchQuery('');
    };

    const displayPages = searchMode && searchQuery.trim() ? searchResults : visiblePages;
    const isCurrentlyLoading = isLoading || (searchMode && isSearching);

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                <header className="flex items-center gap-3 px-4 py-3 border-b-2 border-gray-700 shrink-0">
                    {navStack.length > 1 && !searchMode ? (
                        <button onClick={goBack} className="p-2 bg-gray-700 rounded-xl shrink-0">
                            <ArrowLeftIcon className="w-5 h-5 text-white" />
                        </button>
                    ) : (
                        <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center shrink-0">
                            <span className="text-white font-black text-base leading-none">N</span>
                        </div>
                    )}
                    <div className="flex-grow min-w-0">
                        {searchMode ? (
                            <input
                                autoFocus
                                dir="auto"
                                type="text"
                                placeholder="Search pages..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-gray-900 px-3 py-2 rounded-xl border-2 border-purple-500 text-white font-bold text-sm outline-none"
                            />
                        ) : (
                            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                                {navStack.map((crumb, i) => (
                                    <React.Fragment key={`${crumb.id}-${i}`}>
                                        {i > 0 && <span className="text-gray-500 text-xs shrink-0">›</span>}
                                        <button
                                            onClick={() => goToIndex(i)}
                                            dir="auto"
                                            className={`text-xs font-black shrink-0 truncate max-w-[100px] ${i === navStack.length - 1 ? 'text-white' : 'text-gray-400'}`}
                                        >
                                            {crumb.title}
                                        </button>
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                    <button onClick={toggleSearch} className={`p-2 rounded-xl shrink-0 ${searchMode ? 'bg-purple-600' : 'bg-gray-700'}`}>
                        <SearchIcon className="w-4 h-4 text-white" />
                    </button>
                    <button onClick={onClose} className="p-2 bg-gray-700 rounded-xl shrink-0">
                        <XIcon className="w-5 h-5 text-white" />
                    </button>
                </header>

                <div className="flex-grow overflow-y-auto px-4 py-3 space-y-2 min-h-0">
                    {isCurrentlyLoading && (
                        <div className="flex justify-center py-12">
                            <Loader2Icon className="w-8 h-8 animate-spin text-purple-400" />
                        </div>
                    )}
                    {error && <p className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>}
                    {!isCurrentlyLoading && !error && displayPages.length === 0 && (
                        <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                            {searchMode && searchQuery ? 'No pages found' : 'No pages here — make sure you shared them with your integration'}
                        </p>
                    )}
                    {!isCurrentlyLoading && displayPages.map(page => {
                        const isImported = importedUrls.has(page.url);
                        const hasChildren = parentIds.has(page.id);

                        return (
                            <div key={page.id} className="flex items-center gap-3 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                                {hasChildren && !searchMode ? (
                                    <button
                                        onClick={() => openPage(page)}
                                        className="flex items-center gap-3 flex-grow min-w-0 text-left"
                                    >
                                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shrink-0">
                                            <span className="text-white font-black text-sm">N</span>
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <p dir="auto" className="font-black text-white text-sm truncate">{page.title || 'Untitled'}</p>
                                            <p className="text-[10px] text-gray-500 font-bold mt-0.5">
                                                {new Date(page.lastEdited).toLocaleDateString()} · {allPages.filter(p => p.parentId === page.id).length} sub-pages
                                            </p>
                                        </div>
                                        <span className="text-gray-500 text-lg shrink-0">›</span>
                                    </button>
                                ) : (
                                    <>
                                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center shrink-0">
                                            <span className="text-white font-black text-sm">N</span>
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <p dir="auto" className="font-black text-white text-sm truncate">{page.title || 'Untitled'}</p>
                                            <p className="text-[10px] text-gray-500 font-bold mt-0.5">
                                                {new Date(page.lastEdited).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </>
                                )}
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

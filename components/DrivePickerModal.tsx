import React, { useState, useEffect, useCallback } from 'react';
import type { DriveFile, DriveItem } from '../services/googleDriveService';
import { listDriveFolder, listDriveFiles, getStoredDriveToken } from '../services/googleDriveService';
import { XIcon, SearchIcon, Loader2Icon, FileTextIcon, FolderIcon, ArrowLeftIcon } from './Icons';

interface DrivePickerModalProps {
    onClose: () => void;
    onImport: (file: DriveFile) => void;
    importedIds: Set<string>;
}

const mimeLabel = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.includes('document')) return 'Doc';
    if (mimeType.includes('spreadsheet')) return 'Sheet';
    if (mimeType.includes('presentation')) return 'Slides';
    if (mimeType.includes('text')) return 'Text';
    return 'File';
};

const mimeColor = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'text-red-400';
    if (mimeType.includes('document')) return 'text-blue-400';
    if (mimeType.includes('spreadsheet')) return 'text-green-400';
    if (mimeType.includes('presentation')) return 'text-orange-400';
    return 'text-gray-400';
};

const DRIVE_LOGO = (
    <svg viewBox="0 0 87.3 78" className="w-6 h-6">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.6C.4 50 0 51.55 0 53.1h27.5z" fill="#00AC47"/>
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 11.9z" fill="#EA4335"/>
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832D"/>
        <path d="M59.85 53.1H27.5L13.75 76.9c1.35.8 2.9 1.1 4.45 1.1h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684FC"/>
        <path d="M73.4 26.85l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28.1H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
    </svg>
);

const DrivePickerModal: React.FC<DrivePickerModalProps> = ({ onClose, onImport, importedIds }) => {
    const [token] = useState<string | null>(() => getStoredDriveToken());
    const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>(
        [{ id: 'root', name: 'My Drive' }]
    );
    const [items, setItems] = useState<DriveItem[]>([]);
    const [searchMode, setSearchMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currentFolder = folderStack[folderStack.length - 1];

    const loadFolder = useCallback(async (folderId: string) => {
        if (!token) return;
        setIsLoading(true);
        setError(null);
        try {
            const results = await listDriveFolder(token, folderId);
            setItems(results);
        } catch (e: any) {
            if (e.message?.includes('401')) {
                setError('Session expired. Go to Settings → Account & Sync, sign out and sign back in.');
            } else {
                setError('Could not load folder. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (token && !searchMode) loadFolder(currentFolder.id);
    }, [token, currentFolder.id, searchMode, loadFolder]);

    useEffect(() => {
        if (!token || !searchMode) return;
        if (!searchQuery.trim()) { loadFolder(currentFolder.id); return; }
        const id = setTimeout(async () => {
            setIsLoading(true);
            setError(null);
            try {
                const results = await listDriveFiles(token, searchQuery);
                setItems(results.map(f => ({ ...f, isFolder: false })));
            } catch (e: any) {
                setError('Search failed. Please try again.');
            } finally {
                setIsLoading(false);
            }
        }, 400);
        return () => clearTimeout(id);
    }, [searchQuery, token, searchMode, currentFolder.id, loadFolder]);

    const openFolder = (folder: DriveItem) => {
        setFolderStack(prev => [...prev, { id: folder.id, name: folder.name }]);
    };

    const goBack = () => {
        if (folderStack.length > 1) setFolderStack(prev => prev.slice(0, -1));
    };

    const goToIndex = (index: number) => {
        setFolderStack(prev => prev.slice(0, index + 1));
    };

    const toggleSearch = () => {
        setSearchMode(s => !s);
        setSearchQuery('');
        if (searchMode) loadFolder(currentFolder.id);
    };

    if (!token) {
        return (
            <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
                <div className="bg-gray-800 rounded-t-[2.5rem] w-full flex flex-col border-t-4 border-gray-700 mt-auto" onClick={e => e.stopPropagation()}>
                    <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />
                    <div className="flex flex-col items-center gap-6 p-10 text-center">
                        <p className="text-gray-300 font-bold text-sm leading-relaxed">
                            Your Google Drive session has expired or isn't connected yet.
                        </p>
                        <p className="text-gray-500 text-sm leading-relaxed">
                            Go to <strong className="text-white">Settings → Account & Sync</strong>, sign out, then sign back in with Google to get a fresh session.
                        </p>
                        <button onClick={onClose} className="px-8 py-4 bg-gray-700 text-white font-black rounded-2xl uppercase text-sm">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                {/* Header */}
                <header className="flex items-center gap-3 px-4 py-3 border-b-2 border-gray-700 shrink-0">
                    {folderStack.length > 1 && !searchMode ? (
                        <button onClick={goBack} className="p-2 bg-gray-700 rounded-xl shrink-0">
                            <ArrowLeftIcon className="w-5 h-5 text-white" />
                        </button>
                    ) : (
                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0">
                            {DRIVE_LOGO}
                        </div>
                    )}
                    <div className="flex-grow min-w-0">
                        {searchMode ? (
                            <input
                                autoFocus
                                dir="auto"
                                type="text"
                                placeholder="Search Drive..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-gray-900 px-3 py-2 rounded-xl border-2 border-blue-500 text-white font-bold text-sm outline-none"
                            />
                        ) : (
                            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                                {folderStack.map((crumb, i) => (
                                    <React.Fragment key={crumb.id}>
                                        {i > 0 && <span className="text-gray-500 text-xs shrink-0">›</span>}
                                        <button
                                            onClick={() => goToIndex(i)}
                                            className={`text-xs font-black shrink-0 truncate max-w-[100px] ${i === folderStack.length - 1 ? 'text-white' : 'text-gray-400'}`}
                                            dir="auto"
                                        >
                                            {crumb.name}
                                        </button>
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    </div>
                    <button onClick={toggleSearch} className={`p-2 rounded-xl shrink-0 ${searchMode ? 'bg-blue-600' : 'bg-gray-700'}`}>
                        <SearchIcon className="w-4 h-4 text-white" />
                    </button>
                    <button onClick={onClose} className="p-2 bg-gray-700 rounded-xl shrink-0">
                        <XIcon className="w-5 h-5 text-white" />
                    </button>
                </header>

                {/* Content */}
                <div className="flex-grow overflow-y-auto px-4 py-3 space-y-2 min-h-0">
                    {isLoading && (
                        <div className="flex justify-center py-12">
                            <Loader2Icon className="w-8 h-8 animate-spin text-blue-400" />
                        </div>
                    )}
                    {error && <p className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>}
                    {!isLoading && !error && items.length === 0 && (
                        <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                            {searchMode && searchQuery ? 'No files found' : 'This folder is empty'}
                        </p>
                    )}
                    {!isLoading && items.map(item => {
                        if (item.isFolder) {
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => openFolder(item)}
                                    className="w-full flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700 active:scale-98 transition-all text-left"
                                >
                                    <FolderIcon className="w-8 h-8 text-yellow-400 shrink-0" />
                                    <p dir="auto" className="font-black text-white text-sm flex-grow min-w-0 truncate text-left">
                                        {item.name}
                                    </p>
                                    <span className="text-gray-500 text-lg shrink-0">›</span>
                                </button>
                            );
                        }

                        const isImported = importedIds.has(item.id);
                        return (
                            <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                                <div className="shrink-0">
                                    <div className={`text-[10px] font-black uppercase tracking-wider ${mimeColor(item.mimeType)}`}>
                                        {mimeLabel(item.mimeType)}
                                    </div>
                                    <FileTextIcon className={`w-8 h-8 ${mimeColor(item.mimeType)}`} />
                                </div>
                                <div className="flex-grow min-w-0">
                                    <p dir="auto" className="font-black text-white text-sm truncate">{item.name}</p>
                                    <p className="text-[10px] text-gray-500 font-bold mt-0.5">
                                        {new Date(item.modifiedTime).toLocaleDateString()}
                                        {item.size ? ` · ${Math.round(parseInt(item.size) / 1024)}KB` : ''}
                                    </p>
                                </div>
                                <button
                                    onClick={() => !isImported && onImport(item)}
                                    disabled={isImported}
                                    className={`px-4 py-2 rounded-xl font-black text-xs uppercase shrink-0 transition-all ${
                                        isImported
                                            ? 'bg-green-800 text-green-400'
                                            : 'bg-blue-600 text-white active:scale-95'
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

export default DrivePickerModal;

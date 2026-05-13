import React, { useState, useEffect, useCallback } from 'react';
import type { DriveFile } from '../services/googleDriveService';
import { listDriveFiles, connectGoogleDrive, getStoredDriveToken } from '../services/googleDriveService';
import { XIcon, SearchIcon, Loader2Icon, FileTextIcon } from './Icons';
import { getStoredGoogleClientId } from '../services/googleCalendarService';

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

const DrivePickerModal: React.FC<DrivePickerModalProps> = ({ onClose, onImport, importedIds }) => {
    const [token, setToken] = useState<string | null>(getStoredDriveToken());
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasClientId = !!getStoredGoogleClientId();

    const loadFiles = useCallback(async (t: string, q: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const results = await listDriveFiles(t, q);
            setFiles(results);
        } catch (e: any) {
            if (e.message?.includes('401')) {
                setToken(null);
                setError('Session expired. Please reconnect.');
            } else {
                setError('Could not load Drive files. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (token) loadFiles(token, '');
    }, [token, loadFiles]);

    useEffect(() => {
        if (!token) return;
        const id = setTimeout(() => loadFiles(token, query), 400);
        return () => clearTimeout(id);
    }, [query, token, loadFiles]);

    const handleConnect = async () => {
        setIsConnecting(true);
        try {
            const t = await connectGoogleDrive();
            setToken(t);
        } catch (e) {
            setError('Could not connect to Google Drive.');
        } finally {
            setIsConnecting(false);
        }
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

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                <header className="flex items-center gap-4 px-6 py-4 border-b-2 border-gray-700 shrink-0">
                    <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shrink-0">
                        {DRIVE_LOGO}
                    </div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter flex-grow">Google Drive</h2>
                    <button onClick={onClose} className="p-2 bg-gray-700 rounded-xl">
                        <XIcon className="w-6 h-6 text-white" />
                    </button>
                </header>

                {!token ? (
                    <div className="flex flex-col items-center gap-6 p-10">
                        {!hasClientId ? (
                            <>
                                <p className="text-gray-400 font-bold text-center text-sm leading-relaxed">
                                    Set up a Google Client ID in Settings → Google Calendar first, then come back to connect Drive.
                                </p>
                                <button onClick={onClose} className="px-8 py-4 bg-gray-700 text-white font-black rounded-2xl uppercase text-sm">
                                    Close
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-400 font-bold text-center text-sm">Connect your Google Drive to browse and import files.</p>
                                {error && <p className="text-red-400 text-sm font-bold">{error}</p>}
                                <button
                                    onClick={handleConnect}
                                    disabled={isConnecting}
                                    className="px-10 py-5 bg-white text-gray-900 font-black rounded-2xl uppercase text-sm flex items-center gap-3 shadow-xl"
                                >
                                    {isConnecting ? <Loader2Icon className="w-5 h-5 animate-spin" /> : DRIVE_LOGO}
                                    Connect Google Drive
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="px-4 py-3 shrink-0">
                            <div className="relative">
                                <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search Drive..."
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    className="w-full bg-gray-900 pl-10 pr-4 py-3 rounded-2xl border-2 border-gray-700 text-white font-bold text-sm outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex-grow overflow-y-auto px-4 pb-6 space-y-2 min-h-0">
                            {isLoading && (
                                <div className="flex justify-center py-12">
                                    <Loader2Icon className="w-8 h-8 animate-spin text-blue-400" />
                                </div>
                            )}
                            {error && <p className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>}
                            {!isLoading && !error && files.length === 0 && (
                                <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">No files found</p>
                            )}
                            {!isLoading && files.map(file => {
                                const isImported = importedIds.has(file.id);
                                return (
                                    <div key={file.id} className="flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                                        <div className="shrink-0">
                                            <div className={`text-[10px] font-black uppercase tracking-wider ${mimeColor(file.mimeType)}`}>
                                                {mimeLabel(file.mimeType)}
                                            </div>
                                            <FileTextIcon className={`w-8 h-8 ${mimeColor(file.mimeType)}`} />
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <p className="font-black text-white text-sm truncate">{file.name}</p>
                                            <p className="text-[10px] text-gray-500 font-bold mt-0.5">
                                                {new Date(file.modifiedTime).toLocaleDateString()}
                                                {file.size ? ` · ${Math.round(parseInt(file.size) / 1024)}KB` : ''}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => !isImported && onImport(file)}
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
                    </>
                )}
            </div>
        </div>
    );
};

export default DrivePickerModal;

import React, { useState } from 'react';
import { Folder, Plus, ArrowLeft, X } from 'lucide-react';
import type { AnyMemory } from '../types';

interface FolderOrganizerProps {
    memories: AnyMemory[];
    onUpdateMemory: (id: string, updates: Partial<AnyMemory>) => void;
    onClose: () => void;
}

const FolderOrganizer: React.FC<FolderOrganizerProps> = ({ memories, onUpdateMemory, onClose }) => {
    const [currentPath, setCurrentPath] = useState<string>('');
    const [newFolderName, setNewFolderName] = useState('');
    const [showNewFolder, setShowNewFolder] = useState(false);

    // Get all unique folders
    const allFolders = new Set<string>();
    memories.forEach(m => {
        if ((m as any).folderPath) {
            const parts = (m as any).folderPath.split('/').filter(Boolean);
            for (let i = 1; i <= parts.length; i++) {
                allFolders.add(parts.slice(0, i).join('/'));
            }
        }
    });

    // Get subfolders for current path
    const subfolders = Array.from(allFolders).filter(folder => {
        if (currentPath) {
            return folder.startsWith(currentPath + '/') && !folder.slice((currentPath + '/').length).includes('/');
        } else {
            return !folder.includes('/');
        }
    });

    // Get memories in current path
    const memoriesInPath = memories.filter(m => {
        const memPath = (m as any).folderPath || '';
        if (currentPath) {
            return memPath.startsWith(currentPath) && memPath !== currentPath;
        } else {
            return !memPath;
        }
    });

    const handleCreateFolder = () => {
        if (!newFolderName.trim()) return;
        const newPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
        setNewFolderName('');
        setShowNewFolder(false);
        // Folder will appear when user moves a memory there
    };

    const handleMoveMemory = (memoryId: string) => {
        onUpdateMemory(memoryId, { folderPath: currentPath || undefined } as Partial<AnyMemory>);
    };

    return (
        <div className="fixed inset-0 bg-black/95 z-[200] flex flex-col p-3 sm:p-4"
             style={{ paddingTop: 'max(var(--sat), 12px)' }}>
            <div className="bg-gray-800 w-full max-w-2xl mx-auto my-auto rounded-[2rem] border-4 border-gray-700 flex flex-col max-h-[90vh] overflow-hidden shadow-2xl">
                <header className="p-5 sm:p-6 border-b-4 border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setCurrentPath(currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '')}
                            className={`p-2 rounded-lg transition-all ${currentPath ? 'bg-gray-700 hover:bg-gray-600' : 'opacity-30 cursor-not-allowed'}`}
                            disabled={!currentPath}
                            aria-label="Go up one level"
                        >
                            <ArrowLeft size={20} strokeWidth={3} />
                        </button>
                        <h2 className="text-lg sm:text-xl font-black text-white uppercase">
                            {currentPath ? currentPath.split('/').pop() : 'Folders'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="text-white/60 hover:text-white text-2xl">✕</button>
                </header>

                <div className="flex-grow overflow-y-auto p-5 sm:p-6 space-y-4">
                    {/* Subfolders */}
                    {subfolders.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-black text-white/50 uppercase">Folders</p>
                            {subfolders.map(folder => (
                                <button
                                    key={folder}
                                    onClick={() => setCurrentPath(folder)}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-700 hover:bg-gray-600 transition-all text-left"
                                >
                                    <Folder className="w-5 h-5 text-blue-400 flex-shrink-0" strokeWidth={3} />
                                    <span className="font-bold uppercase text-sm">{folder.split('/').pop()}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Memories in this folder */}
                    {memoriesInPath.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-black text-white/50 uppercase">Memories</p>
                            {memoriesInPath.map(mem => (
                                <div
                                    key={mem.id}
                                    className="flex items-center gap-3 p-3 rounded-lg bg-gray-700 text-left"
                                >
                                    <div className="flex-grow min-w-0">
                                        <p className="font-bold text-sm truncate">{mem.title}</p>
                                        <p className="text-xs text-gray-400">{mem.type}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* New folder input */}
                    {showNewFolder && (
                        <div className="flex gap-2 p-3 rounded-lg bg-gray-700">
                            <input
                                type="text"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder="Folder name..."
                                className="flex-grow px-3 py-2 rounded-lg bg-gray-800 text-white border-2 border-gray-600 focus:border-blue-500 outline-none"
                                autoFocus
                            />
                            <button
                                onClick={handleCreateFolder}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm uppercase transition-all active:scale-95"
                                style={{ minHeight: 'unset' }}
                            >
                                Create
                            </button>
                        </div>
                    )}

                    {/* Empty state */}
                    {subfolders.length === 0 && memoriesInPath.length === 0 && (
                        <div className="py-12 text-center opacity-40">
                            <Folder size={48} className="mx-auto mb-3" strokeWidth={2} />
                            <p className="text-sm uppercase">No folders or memories</p>
                        </div>
                    )}
                </div>

                <div className="border-t-4 border-gray-700 p-4 flex gap-3 bg-gray-900/50">
                    <button
                        onClick={() => setShowNewFolder(!showNewFolder)}
                        className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-sm uppercase transition-all active:scale-95"
                    >
                        <Plus size={18} strokeWidth={3} />
                        New Folder
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-grow px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-black text-sm uppercase transition-all active:scale-95"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FolderOrganizer;

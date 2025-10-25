import React, { useState, useEffect } from 'react';
import type { AnyMemory, WebMemory } from '../types';
import { TrashIcon, CheckIcon, RefreshCwIcon } from './Icons';

interface WebClipsViewProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WebMemory>) => void;
  onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
  syncSharedClips: () => Promise<number>;
  pendingClipsCount: number;
  bulkDelete: (ids: string[]) => void;
}

const WebClipsView: React.FC<WebClipsViewProps> = ({ memories, onDelete, onUpdate, syncSharedClips, pendingClipsCount, bulkDelete }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [editingCell, setEditingCell] = useState<{ memoryId: string; field: 'title' | 'contentType' | 'tags' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
        inputRef.current.focus();
    }
  }, [editingCell]);


  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    const count = await syncSharedClips();
    setIsSyncing(false);
    setSyncMessage(count > 0 ? `Synced ${count} new clip(s)!` : 'No new clips to sync.');
    setTimeout(() => setSyncMessage(null), 3000);
  }

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        return newSet;
    });
  };

  const handleBulkDelete = () => {
      bulkDelete(Array.from(selectedIds));
      setIsSelectMode(false);
      setSelectedIds(new Set());
  };

  const startEditing = (memory: WebMemory, field: 'title' | 'contentType' | 'tags') => {
    if (isSelectMode) return;
    setEditingCell({ memoryId: memory.id, field });
    if (field === 'tags') {
        setEditValue(memory.tags?.join(', ') || '');
    } else {
        setEditValue(memory[field] || '');
    }
  };

  const handleSaveEdit = () => {
    if (!editingCell) return;
    const { memoryId, field } = editingCell;
    
    const updates: Partial<WebMemory> = {};
    if (field === 'tags') {
        updates.tags = editValue.split(',').map(t => t.trim()).filter(Boolean);
    } else {
        updates[field] = editValue;
    }

    onUpdate(memoryId, updates);
    setEditingCell(null);
  };
  
  const renderCell = (memory: WebMemory, field: 'title' | 'contentType' | 'tags') => {
    const isEditing = editingCell?.memoryId === memory.id && editingCell?.field === field;
    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') setEditingCell(null);
                }}
                className="w-full bg-gray-600 text-white p-1 rounded-md border border-blue-500 focus:outline-none"
            />
        );
    }
    
    let displayValue: string;
    if (field === 'tags') {
        displayValue = memory.tags?.join(', ') || '';
    } else {
        displayValue = memory[field] || '';
    }
    
    return (
        <span onClick={() => startEditing(memory, field)} className="cursor-pointer hover:bg-gray-700 p-1 rounded-md min-h-[24px] block">
           {displayValue || <span className="text-gray-500">empty</span>}
        </span>
    );
  }

  return (
    <div className="space-y-4">
      {syncMessage && (
        <div className="text-center p-2 bg-gray-700 rounded-lg text-white animate-fade-in-up fixed top-20 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-sm">
            {syncMessage}
        </div>
      )}

      <div className="space-y-4">
          <div className="flex justify-between items-center border-b border-gray-700 pb-2">
            <h2 className="text-2xl font-bold text-white">My Web Clips</h2>
            <div className="flex items-center gap-4">
                {memories.length > 0 && (
                    <button 
                        onClick={() => {
                            setIsSelectMode(!isSelectMode);
                            setSelectedIds(new Set());
                        }} 
                        className="px-4 py-2 text-md font-semibold rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                    >
                        {isSelectMode ? 'Cancel' : 'Select'}
                    </button>
                )}
                <button onClick={handleSync} disabled={isSyncing} className="relative p-2 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50">
                    <RefreshCwIcon className={`w-6 h-6 ${isSyncing ? 'animate-spin' : ''}`} />
                    {pendingClipsCount > 0 && !isSyncing && (
                        <span className="absolute top-0 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">{pendingClipsCount}</span>
                    )}
                </button>
            </div>
          </div>
          
          {memories.length > 0 ? (
                <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
                    <table className="w-full text-left table-auto">
                        <thead className="border-b border-gray-700">
                            <tr>
                                {isSelectMode && <th className="p-3 w-12"></th>}
                                <th className="p-3 text-sm font-semibold text-gray-400 tracking-wider">Title</th>
                                <th className="p-3 text-sm font-semibold text-gray-400 tracking-wider">Date</th>
                                <th className="p-3 text-sm font-semibold text-gray-400 tracking-wider">Type</th>
                                <th className="p-3 text-sm font-semibold text-gray-400 tracking-wider">Tags</th>
                                <th className="p-3 text-sm font-semibold text-gray-400 tracking-wider w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(memories as WebMemory[]).map((mem, index) => (
                                <tr key={mem.id} className={`border-b border-gray-700 last:border-b-0 ${selectedIds.has(mem.id) ? 'bg-blue-900 bg-opacity-50' : ''}`}>
                                    {isSelectMode && (
                                        <td className="p-3 align-top" onClick={() => toggleSelection(mem.id)}>
                                            <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center cursor-pointer ${selectedIds.has(mem.id) ? 'bg-blue-500 border-blue-400' : 'border-gray-500'}`}>
                                                {selectedIds.has(mem.id) && <CheckIcon className="w-4 h-4 text-white" />}
                                            </div>
                                        </td>
                                    )}
                                    <td className="p-2 text-white align-top min-w-[200px]">{renderCell(mem, 'title')}</td>
                                    <td className="p-3 text-gray-400 text-sm align-top whitespace-nowrap">{new Date(mem.date).toLocaleDateString()}</td>
                                    <td className="p-2 text-gray-300 align-top min-w-[120px]">{renderCell(mem, 'contentType')}</td>
                                    <td className="p-2 text-gray-300 align-top min-w-[150px]">{renderCell(mem, 'tags')}</td>
                                    <td className="p-2 align-top text-center">
                                        <button onClick={() => onDelete(mem.id)} aria-label="Delete memory" className="p-2 text-gray-500 hover:text-red-500 focus:outline-none rounded-full"><TrashIcon className="w-5 h-5"/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
          ) : (
               <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                  <h2 className="text-2xl font-semibold text-white">No Clips Yet</h2>
                  <p className="mt-2 text-gray-400">Share content from other apps to see it here.</p>
              </div>
          )}
      </div>
      {isSelectMode && selectedIds.size > 0 && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 w-11/12 max-w-sm">
              <button onClick={handleBulkDelete} className="w-full bg-red-600 text-white font-bold py-4 px-4 rounded-lg shadow-lg flex items-center justify-center gap-2">
                  <TrashIcon className="w-6 h-6"/> Delete ({selectedIds.size})
              </button>
          </div>
      )}
    </div>
  );
};

export default WebClipsView;
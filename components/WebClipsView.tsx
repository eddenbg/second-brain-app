
import React, { useState, useEffect } from 'react';
import type { AnyMemory, WebMemory } from '../types';
import { TrashIcon, CheckIcon, RefreshCwIcon, PlusCircleIcon, GlobeIcon, EditIcon, XIcon } from './Icons';
import AddWebMemoryModal from './AddWebMemoryModal';

interface WebClipsViewProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WebMemory>) => void;
  onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
  syncSharedClips: () => Promise<number>;
  pendingClipsCount: number;
  bulkDelete: (ids: string[]) => void;
}

const ClipItem: React.FC<{
    memory: WebMemory;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<WebMemory>) => void;
    isSelectMode: boolean;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
}> = ({ memory, onDelete, onUpdate, isSelectMode, isSelected, onToggleSelect }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(memory.title);

    const handleSave = () => {
        if (editValue.trim()) {
            onUpdate(memory.id, { title: editValue.trim() });
            setIsEditing(false);
        }
    };

    return (
        <div className={`bg-gray-800 rounded-3xl p-6 border-4 transition-all mb-6 shadow-xl ${isSelected ? 'border-blue-500 scale-[1.02]' : 'border-gray-700'}`}>
            <div className="flex gap-6 items-start">
                {isSelectMode && (
                    <button 
                        onClick={() => onToggleSelect(memory.id)}
                        className={`flex-shrink-0 w-12 h-12 rounded-2xl border-4 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-600 border-blue-400' : 'border-gray-500'}`}
                    >
                        {isSelected && <CheckIcon className="w-8 h-8 text-white" />}
                    </button>
                )}
                
                <div className="flex-shrink-0 pt-1">
                    <GlobeIcon className="w-12 h-12 text-blue-400" />
                </div>

                <div className="flex-grow space-y-2 overflow-hidden">
                    {isEditing ? (
                        <div className="flex gap-3">
                            <input 
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="flex-grow bg-gray-700 text-white text-2xl p-4 rounded-2xl border-4 border-blue-500 focus:outline-none"
                                autoFocus
                            />
                            <button onClick={handleSave} className="p-4 bg-green-600 rounded-2xl"><CheckIcon className="w-8 h-8"/></button>
                        </div>
                    ) : (
                        <h3 className="text-2xl font-black text-white leading-tight break-words">{memory.title}</h3>
                    )}
                    
                    <div className="flex flex-wrap gap-2">
                        <span className="text-xl text-gray-400 font-bold">{new Date(memory.date).toLocaleDateString()}</span>
                        {memory.contentType && (
                            <span className="bg-blue-900 text-blue-200 text-sm font-black px-3 py-1 rounded-full uppercase">{memory.contentType}</span>
                        )}
                    </div>
                    
                    {memory.tags && memory.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                            {memory.tags.map(tag => (
                                <span key={tag} className="bg-gray-700 text-gray-300 text-lg font-bold px-4 py-1 rounded-xl border-2 border-gray-600">#{tag}</span>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3">
                    <button onClick={() => setIsEditing(!isEditing)} className="p-4 bg-gray-700 text-blue-400 rounded-2xl hover:bg-gray-600"><EditIcon className="w-10 h-10"/></button>
                    <button onClick={() => onDelete(memory.id)} className="p-4 bg-gray-700 text-red-500 rounded-2xl hover:bg-gray-600"><TrashIcon className="w-10 h-10"/></button>
                </div>
            </div>
            
            <a 
                href={memory.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="mt-6 w-full flex items-center justify-center gap-4 py-5 bg-blue-600 text-white text-2xl font-black rounded-2xl shadow-lg border-b-8 border-blue-800 active:border-b-0 active:translate-y-2"
            >
                OPEN LINK
            </a>
        </div>
    );
}

const WebClipsView: React.FC<WebClipsViewProps> = ({ memories, onDelete, onUpdate, onSave, syncSharedClips, pendingClipsCount, bulkDelete }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    await syncSharedClips();
    setIsSyncing(false);
  }

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        return newSet;
    });
  };

  const handleBulkDelete = () => {
      bulkDelete(Array.from(selectedIds));
      setIsSelectMode(false);
      setSelectedIds(new Set());
  };
  
  const handleSaveClip = (mem: Omit<WebMemory, 'id'|'date'|'category'>) => {
    onSave({ ...mem, category: 'personal' });
    setShowAddModal(false);
  };

  return (
    <div className="space-y-8">
      {showAddModal && <AddWebMemoryModal onClose={() => setShowAddModal(false)} onSave={handleSaveClip} />}

      <div className="space-y-8">
          <div className="flex justify-between items-center border-b-4 border-gray-700 pb-4">
            <h2 className="text-3xl font-black text-white uppercase tracking-tight">Archives</h2>
            <div className="flex items-center gap-4">
                <button onClick={() => setShowAddModal(true)} className="p-4 rounded-2xl bg-blue-600 text-white shadow-xl hover:scale-110 transition-transform">
                    <PlusCircleIcon className="w-12 h-12" />
                </button>
                {memories.length > 0 && (
                    <button 
                        onClick={() => {
                            setIsSelectMode(!isSelectMode);
                            setSelectedIds(new Set());
                        }} 
                        className="px-6 py-4 text-xl font-black rounded-2xl bg-gray-700 text-gray-300 border-2 border-gray-600"
                    >
                        {isSelectMode ? 'DONE' : 'SELECT'}
                    </button>
                )}
                <button onClick={handleSync} disabled={isSyncing} className="relative p-4 rounded-2xl bg-gray-700 text-gray-300 border-2 border-gray-600">
                    <RefreshCwIcon className={`w-10 h-10 ${isSyncing ? 'animate-spin' : ''}`} />
                    {pendingClipsCount > 0 && !isSyncing && (
                        <span className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-lg font-black text-white border-2 border-gray-900">{pendingClipsCount}</span>
                    )}
                </button>
            </div>
          </div>
          
          {memories.length > 0 ? (
                <div className="pb-40">
                    {(memories as WebMemory[]).map((mem) => (
                        <ClipItem 
                            key={mem.id}
                            memory={mem}
                            onDelete={onDelete}
                            onUpdate={onUpdate}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(mem.id)}
                            onToggleSelect={toggleSelection}
                        />
                    ))}
                </div>
          ) : (
               <div className="text-center py-24 px-8 bg-gray-800 rounded-3xl border-4 border-gray-700 border-dashed">
                  <GlobeIcon className="w-24 h-24 text-gray-600 mx-auto mb-6" />
                  <h2 className="text-3xl font-black text-white mb-4">No Web Clips</h2>
                  <p className="text-2xl text-gray-400 font-bold">Add links manually or share content from your browser to save it here.</p>
              </div>
          )}
      </div>

      {isSelectMode && selectedIds.size > 0 && (
          <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-30 w-11/12 max-w-md">
              <button onClick={handleBulkDelete} className="w-full bg-red-600 text-white font-black text-2xl py-6 px-4 rounded-3xl shadow-2xl flex items-center justify-center gap-4 border-b-8 border-red-800 active:border-b-0 active:translate-y-2">
                  <TrashIcon className="w-12 h-12"/> DELETE ({selectedIds.size})
              </button>
          </div>
      )}
    </div>
  );
};

export default WebClipsView;

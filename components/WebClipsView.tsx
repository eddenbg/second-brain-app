import React, { useState } from 'react';
import type { AnyMemory, WebMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, GlobeIcon, MapPinIcon, LinkIcon, MicIcon, UploadIcon } from './Icons';
import AddWebMemoryModal from './AddWebMemoryModal';

interface WebClipsViewProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WebMemory>) => void;
  onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
  syncSharedClips: () => Promise<void>;
  pendingClipsCount: number;
}

// ... (ClipItem component remains the same)
const ClipItem: React.FC<{ memory: WebMemory; onDelete: (id: string) => void; onUpdate: (id: string, updates: Partial<WebMemory>) => void; }> = ({ memory, onDelete, onUpdate }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(memory.title);

    const handleUpdate = () => {
        if (title.trim()) {
            onUpdate(memory.id, { title: title.trim() });
            setIsEditing(false);
        }
    };
    
    const handleCancel = () => {
        setTitle(memory.title);
        setIsEditing(false);
    };
    
    return (
        <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700">
            <div className="p-4 flex justify-between items-center cursor-pointer gap-4" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-shrink-0"><GlobeIcon className="w-6 h-6 text-green-400"/></div>
                <div className="flex-grow">
                    {isEditing ? (
                        <input
                           type="text"
                           value={title}
                           onChange={(e) => setTitle(e.target.value)}
                           onClick={(e) => e.stopPropagation()}
                           className="w-full bg-gray-700 text-white text-lg p-2 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                           autoFocus
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') handleUpdate();
                               if (e.key === 'Escape') handleCancel();
                           }}
                        />
                    ) : (
                        <h3 className="text-xl font-semibold text-white">{memory.title}</h3>
                    )}
                    <p className="text-sm text-gray-400">{new Date(memory.date).toLocaleString()}</p>
                </div>
                <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
            {isExpanded && (
                <div className="p-4 border-t border-gray-700 space-y-4">
                    <div className="flex items-center justify-end space-x-2">
                        {isEditing ? (
                             <>
                                <button onClick={handleUpdate} aria-label="Save title" className="p-2 text-green-400 hover:text-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 rounded-full"><CheckIcon className="w-6 h-6"/></button>
                                <button onClick={handleCancel} aria-label="Cancel edit" className="p-2 text-gray-400 hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded-full"><XIcon className="w-6 h-6"/></button>
                            </>
                        ) : (
                            <button onClick={() => setIsEditing(true)} aria-label="Edit title" className="p-2 text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"><EditIcon className="w-6 h-6"/></button>
                        )}
                        <button onClick={() => onDelete(memory.id)} aria-label="Delete memory" className="p-2 text-red-500 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 rounded-full"><TrashIcon className="w-6 h-6"/></button>
                    </div>

                    {memory.location && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <MapPinIcon className="w-5 h-5" />
                            <a href={`https://www.google.com/maps?q=${memory.location.latitude},${memory.location.longitude}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline">
                                View Location
                            </a>
                        </div>
                    )}
                    
                    {memory.url && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <LinkIcon className="w-5 h-5" />
                            <a href={memory.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline truncate">
                                {memory.url}
                            </a>
                        </div>
                    )}
                    
                    {memory.tags && memory.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {memory.tags.map(tag => <span key={tag} className="bg-gray-700 text-gray-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">{tag}</span>)}
                      </div>
                    )}

                    <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                        <p className="text-gray-200 whitespace-pre-wrap">{memory.content}</p>
                    </div>

                    {memory.voiceNote && (
                        <div>
                            <h4 className="flex items-center gap-2 text-lg font-semibold text-gray-300 mb-2"><MicIcon className="w-5 h-5"/> My Note:</h4>
                                <div className="bg-gray-900 p-4 rounded-md max-h-40 overflow-y-auto border border-gray-600">
                                <p className="text-gray-200 whitespace-pre-wrap">{memory.voiceNote.transcript}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

const WebClipsView: React.FC<WebClipsViewProps> = ({ memories, onSave, onDelete, onUpdate, syncSharedClips, pendingClipsCount }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    await syncSharedClips();
    setIsSyncing(false);
  }

  const handleSave = (memory: Omit<WebMemory, 'id' | 'date'| 'category'>) => {
      onSave({
        ...memory,
        category: 'personal'
      });
      setShowAddModal(false);
  }

  return (
    <div className="space-y-8">
      {showAddModal && <AddWebMemoryModal onSave={handleSave} onClose={() => setShowAddModal(false)} />}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => setShowAddModal(true)} className="w-full flex flex-col items-center justify-center gap-2 p-6 bg-green-600 rounded-lg hover:bg-green-700 border-2 border-dashed border-green-400 hover:border-green-300 transition-colors">
            <LinkIcon className="w-10 h-10 text-white"/>
            <span className="text-xl font-semibold text-white">Add New Web Clip</span>
        </button>
        <button onClick={handleSync} disabled={isSyncing || pendingClipsCount === 0} className="relative w-full flex flex-col items-center justify-center gap-2 p-6 bg-indigo-600 rounded-lg hover:bg-indigo-700 border-2 border-dashed border-indigo-400 hover:border-indigo-300 transition-colors disabled:bg-gray-600 disabled:border-gray-500 disabled:cursor-not-allowed">
            {pendingClipsCount > 0 && (
              <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">{pendingClipsCount}</span>
            )}
            <UploadIcon className="w-10 h-10 text-white"/>
            <span className="text-xl font-semibold text-white">{isSyncing ? 'Syncing...' : 'Sync New Clips'}</span>
        </button>
      </div>

      <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white border-b border-gray-700 pb-2">My Web Clips</h2>
          
          {memories.length > 0 ? (
              memories.map(mem => (
                  <ClipItem key={mem.id} memory={mem as WebMemory} onDelete={onDelete} onUpdate={onUpdate}/>
              ))
          ) : (
               <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                  <h2 className="text-2xl font-semibold text-white">No Clips Yet</h2>
                  <p className="mt-2 text-gray-400">Add a clip manually or share one from your browser.</p>
              </div>
          )}
      </div>
    </div>
  );
};

export default WebClipsView;
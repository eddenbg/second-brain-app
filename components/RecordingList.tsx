import React, { useState, useMemo } from 'react';
import type { AnyMemory, VoiceMemory, WebMemory, PhysicalItemMemory, VideoItemMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, BrainCircuitIcon, MicIcon, GlobeIcon, CameraIcon, VideoIcon, MapPinIcon } from './Icons';

interface MemoryListProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onStartQASession: () => void;
}

const MemoryItem: React.FC<{ memory: AnyMemory; onDelete: (id: string) => void; onUpdateTitle: (id: string, newTitle: string) => void; }> = ({ memory, onDelete, onUpdateTitle }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(memory.title);

    const handleUpdate = () => {
        if (title.trim()) {
            onUpdateTitle(memory.id, title.trim());
            setIsEditing(false);
        }
    };
    
    const handleCancel = () => {
        setTitle(memory.title);
        setIsEditing(false);
    };
    
    const getIcon = () => {
        switch (memory.type) {
            case 'voice': return <MicIcon className="w-6 h-6 text-blue-400"/>;
            case 'web': return <GlobeIcon className="w-6 h-6 text-green-400"/>;
            case 'item': return <CameraIcon className="w-6 h-6 text-purple-400"/>;
            case 'video': return <VideoIcon className="w-6 h-6 text-orange-400"/>;
            default: return null;
        }
    }

    return (
        <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700">
            <div className="p-4 flex justify-between items-center cursor-pointer gap-4" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-shrink-0">{getIcon()}</div>
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

                    {memory.type === 'voice' && (
                         <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                            <p className="text-gray-200 whitespace-pre-wrap">{(memory as VoiceMemory).transcript}</p>
                        </div>
                    )}
                     {memory.type === 'web' && (
                        <div className="space-y-4">
                            {(memory as WebMemory).url && <p className="text-sm text-blue-400 break-all">Source: <a href={(memory as WebMemory).url} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-300">{(memory as WebMemory).url}</a></p>}
                            <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                                <p className="text-gray-200 whitespace-pre-wrap">{(memory as WebMemory).content}</p>
                            </div>
                        </div>
                    )}
                     {memory.type === 'item' && (
                        <div className="space-y-4">
                            <img src={(memory as PhysicalItemMemory).imageDataUrl} alt={memory.title} className="rounded-lg max-h-80 w-full object-contain bg-gray-900"/>
                            {(memory as PhysicalItemMemory).description && (
                                <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                                    <h4 className="text-lg font-semibold text-gray-300 mb-2">Description:</h4>
                                    <p className="text-gray-200 whitespace-pre-wrap">{(memory as PhysicalItemMemory).description}</p>
                                </div>
                            )}
                        </div>
                    )}
                    {memory.type === 'video' && (
                        <div className="space-y-4">
                            <video src={(memory as VideoItemMemory).videoDataUrl} controls className="rounded-lg max-h-80 w-full bg-gray-900"/>
                            {(memory as VideoItemMemory).description && (
                                <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                                    <h4 className="text-lg font-semibold text-gray-300 mb-2">Description:</h4>
                                    <p className="text-gray-200 whitespace-pre-wrap">{(memory as VideoItemMemory).description}</p>
                                </div>
                            )}
                             {(memory as VideoItemMemory).transcript && (
                                <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                                    <h4 className="text-lg font-semibold text-gray-300 mb-2">Transcript:</h4>
                                    <p className="text-gray-200 whitespace-pre-wrap">{(memory as VideoItemMemory).transcript}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {memory.voiceNote && (
                        <div>
                            <h4 className="text-lg font-semibold text-gray-300 mb-2">My Note:</h4>
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


const MemoryList: React.FC<MemoryListProps> = ({ memories, onDelete, onUpdateTitle, onStartQASession }) => {
  const [filter, setFilter] = useState<'all' | 'voice' | 'web' | 'item' | 'video'>('all');

  const filteredMemories = useMemo(() => {
      if (filter === 'all') return memories;
      return memories.filter(mem => mem.type === filter);
  }, [memories, filter]);

  if (memories.length === 0) {
    return (
      <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
        <h2 className="text-2xl font-semibold text-white">No Memories Yet</h2>
        <p className="mt-2 text-gray-400">Tap the record button or add a web clip to start.</p>
      </div>
    );
  }

  // FIX: Refactored TabButton props to a type alias to avoid potential TS parsing issues.
  type TabButtonProps = {
    afilter: 'all' | 'voice' | 'web' | 'item' | 'video';
    currentFilter: 'all' | 'voice' | 'web' | 'item' | 'video';
    children: React.ReactNode;
    count: number;
  };

  const TabButton = ({ afilter, currentFilter, children, count }: TabButtonProps) => (
    <button onClick={() => setFilter(afilter)} className={`px-4 py-2 text-lg font-semibold rounded-md transition-colors flex-shrink-0 ${currentFilter === afilter ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
        {children} <span className="text-sm opacity-75">{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white border-b border-gray-700 pb-2">My Memories</h2>
        
        <div className="flex space-x-2 sm:space-x-4 pb-2 overflow-x-auto">
            <TabButton afilter="all" currentFilter={filter} count={memories.length}>All</TabButton>
            <TabButton afilter="voice" currentFilter={filter} count={memories.filter(m => m.type === 'voice').length}>Voice</TabButton>
            <TabButton afilter="web" currentFilter={filter} count={memories.filter(m => m.type === 'web').length}>Web</TabButton>
            <TabButton afilter="item" currentFilter={filter} count={memories.filter(m => m.type === 'item').length}>Items</TabButton>
            <TabButton afilter="video" currentFilter={filter} count={memories.filter(m => m.type === 'video').length}>Video</TabButton>
        </div>

        <div className="bg-gray-800 p-4 rounded-lg border border-blue-500/50 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Unlock Insights from Your Memories</h3>
              <p className="text-gray-300 mt-1">Ask questions and get answers instantly from all your saved content.</p>
            </div>
            <button
              onClick={onStartQASession}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition-colors w-full sm:w-auto flex-shrink-0"
              aria-label="Ask AI about your memories"
            >
              <BrainCircuitIcon className="w-5 h-5" />
              <span>Ask AI</span>
            </button>
          </div>
        </div>

        {filteredMemories.length > 0 ? (
            filteredMemories.map(mem => (
                <MemoryItem key={mem.id} memory={mem} onDelete={onDelete} onUpdateTitle={onUpdateTitle}/>
            ))
        ) : (
             <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                <h2 className="text-2xl font-semibold text-white">No memories of this type</h2>
                <p className="mt-2 text-gray-400">Try selecting another category or adding a new memory.</p>
            </div>
        )}
    </div>
  );
};

export default MemoryList;
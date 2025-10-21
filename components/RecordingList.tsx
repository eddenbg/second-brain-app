import React, { useState } from 'react';
import type { AnyMemory, VoiceMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, MicIcon, MapPinIcon } from './Icons';
import Recorder from './Recorder';

interface VoiceNotesViewProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
}

const MemoItem: React.FC<{ memory: AnyMemory; onDelete: (id: string) => void; onUpdateTitle: (id: string, newTitle: string) => void; }> = ({ memory, onDelete, onUpdateTitle }) => {
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
    
    return (
        <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700">
            <div className="p-4 flex justify-between items-center cursor-pointer gap-4" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-shrink-0"><MicIcon className="w-6 h-6 text-blue-400"/></div>
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

                    <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                        <p className="text-gray-200 whitespace-pre-wrap">{(memory as VoiceMemory).transcript}</p>
                    </div>
                </div>
            )}
        </div>
    )
}


const VoiceNotesView: React.FC<VoiceNotesViewProps> = ({ memories, onDelete, onUpdateTitle, onSave }) => {
  const [isRecording, setIsRecording] = useState(false);

  const handleSave = (memory: Omit<VoiceMemory, 'id' | 'date'| 'category'>) => {
      onSave({
        ...memory,
        category: 'personal'
      });
      setIsRecording(false);
  }

  if (isRecording) {
    return (
        <Recorder 
            onSave={handleSave} 
            onCancel={() => setIsRecording(false)}
            titlePlaceholder={`My Memo - ${new Date().toLocaleString()}`}
            saveButtonText="Save Memo"
        />
    )
  }

  return (
    <div className="space-y-8">
      <button onClick={() => setIsRecording(true)} className="w-full flex flex-col items-center justify-center gap-2 p-6 bg-blue-600 rounded-lg hover:bg-blue-700 border-2 border-dashed border-blue-400 hover:border-blue-300 transition-colors">
          <MicIcon className="w-10 h-10 text-white"/>
          <span className="text-xl font-semibold text-white">Record New Voice Memo</span>
      </button>

      <div className="space-y-4">
          <h2 className="text-2xl font-bold text-white border-b border-gray-700 pb-2">My Memos</h2>
          
          {memories.length > 0 ? (
              memories.map(mem => (
                  <MemoItem key={mem.id} memory={mem} onDelete={onDelete} onUpdateTitle={onUpdateTitle}/>
              ))
          ) : (
               <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                  <h2 className="text-2xl font-semibold text-white">No Memos Yet</h2>
                  <p className="mt-2 text-gray-400">Tap the button above to record your first voice memo.</p>
              </div>
          )}
      </div>
    </div>
  );
};

export default VoiceNotesView;

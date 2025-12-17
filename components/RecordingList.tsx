
import React, { useState, useEffect, useRef } from 'react';
import Recorder from './Recorder';
import type { AnyMemory, VoiceMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, MicIcon, MapPinIcon } from './Icons';

interface VoiceNotesViewProps {
    memories: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDelete: (ids: string[]) => void;
}

const VoiceNoteItem: React.FC<{ 
    memory: AnyMemory; 
    onDelete: (id: string) => void; 
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void; 
    isSelectMode: boolean;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
}> = ({ memory, onDelete, onUpdate, isSelectMode, isSelected, onToggleSelect }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(memory.title);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const voiceMemory = memory as VoiceMemory;

    useEffect(() => {
        if (isEditing && titleInputRef.current) {
            titleInputRef.current.select();
        }
    }, [isEditing]);

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

    const handleHeaderClick = () => {
        if (isSelectMode) {
            onToggleSelect(memory.id);
        } else {
            setIsExpanded(!isExpanded);
        }
    };

    const toggleActionItem = (index: number) => {
        if (!voiceMemory.actionItems) return;
        const newItems = [...voiceMemory.actionItems];
        newItems[index].done = !newItems[index].done;
        onUpdate(memory.id, { actionItems: newItems });
    };

    const activeTaskCount = voiceMemory.actionItems?.filter(i => !i.done).length || 0;

    return (
        <div className={`bg-gray-800 rounded-lg shadow-md overflow-hidden border transition-colors ${isSelected ? 'border-blue-500' : 'border-gray-700'}`}>
            <div className="p-4 flex justify-between items-center cursor-pointer gap-4" onClick={handleHeaderClick}>
                {isSelectMode && (
                     <div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-400' : 'border-gray-500'}`}>
                        {isSelected && <CheckIcon className="w-4 h-4 text-white"/>}
                    </div>
                )}
                <div className="flex-shrink-0 relative">
                    <MicIcon className="w-6 h-6 text-blue-400"/>
                    {activeTaskCount > 0 && (
                        <div className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {activeTaskCount}
                        </div>
                    )}
                </div>
                <div className="flex-grow">
                    {isEditing ? (
                        <input
                           ref={titleInputRef}
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
                {!isSelectMode && <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />}
            </div>
            {isExpanded && !isSelectMode && (
                <div className="p-4 border-t border-gray-700 space-y-4">
                     {voiceMemory.actionItems && voiceMemory.actionItems.length > 0 && (
                        <div className="bg-gray-700 bg-opacity-30 rounded-lg p-3 border border-gray-600">
                            <h4 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wide">To-Do List</h4>
                            <ul className="space-y-2">
                                {voiceMemory.actionItems.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-3 p-1">
                                        <button 
                                            onClick={() => toggleActionItem(idx)}
                                            className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${item.done ? 'bg-green-600 border-green-600' : 'border-gray-400 hover:border-blue-400'}`}
                                            aria-label={item.done ? "Mark as not done" : "Mark as done"}
                                        >
                                            {item.done && <CheckIcon className="w-4 h-4 text-white"/>}
                                        </button>
                                        <span className={`text-gray-200 text-lg ${item.done ? 'line-through text-gray-500' : ''}`}>
                                            {item.text}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

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

                    {memory.tags && memory.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {memory.tags.map(tag => <span key={tag} className="bg-gray-700 text-gray-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">{tag}</span>)}
                      </div>
                    )}
                    {memory.location && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <MapPinIcon className="w-5 h-5" />
                            <a href={`https://www.google.com/maps?q=${memory.location.latitude},${memory.location.longitude}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline">
                                View Location
                            </a>
                        </div>
                    )}
                    <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                        <h4 className="text-lg font-semibold text-gray-300 mb-2">Transcript:</h4>
                        <p className="text-gray-200 whitespace-pre-wrap">{voiceMemory.transcript}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

const VoiceNotesView: React.FC<VoiceNotesViewProps> = ({ memories, onSave, onDelete, onUpdate, bulkDelete }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    
    const handleSaveNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSave({
            ...mem,
            category: 'personal',
        });
        setIsRecording(false);
    };

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

    if (isRecording) {
        return <Recorder 
            onSave={handleSaveNote} 
            onCancel={() => setIsRecording(false)}
            titlePlaceholder={`Voice Note - ${new Date().toLocaleDateString()}`}
            saveButtonText="Save Note"
        />;
    }

    return (
        <div className="space-y-8">
            <button onClick={() => setIsRecording(true)} className="w-full flex flex-col items-center justify-center gap-2 p-6 bg-blue-600 rounded-lg hover:bg-blue-700 border-2 border-dashed border-blue-400 hover:border-blue-300 transition-colors focus:ring-4 focus:ring-blue-400" aria-label="Record new thought or to-do">
                <MicIcon className="w-10 h-10 text-white"/>
                <span className="text-xl font-semibold text-white">Record Thoughts & To-Dos</span>
            </button>
            <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-gray-700 pb-2">
                    <h2 className="text-2xl font-bold text-white">My Voice Notes</h2>
                     {memories.length > 0 && (
                        <button 
                            onClick={() => {
                                setIsSelectMode(!isSelectMode);
                                setSelectedIds(new Set());
                            }} 
                            className="px-4 py-2 text-lg font-semibold rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                        >
                            {isSelectMode ? 'Cancel' : 'Select'}
                        </button>
                    )}
                </div>
                
                {memories.length === 0 ? (
                    <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                        <p className="mt-2 text-gray-400">
                            Tap the button above to record your first thought or to-do.
                        </p>
                    </div>
                ) : (
                    memories.map(mem => (
                        <VoiceNoteItem 
                            key={mem.id} 
                            memory={mem} 
                            onDelete={onDelete} 
                            onUpdate={onUpdate}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(mem.id)}
                            onToggleSelect={toggleSelection}
                        />
                    ))
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

export default VoiceNotesView;

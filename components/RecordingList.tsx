
import React, { useState, useEffect, useRef } from 'react';
import Recorder from './Recorder';
import type { AnyMemory, VoiceMemory, DocumentMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, MicIcon, MapPinIcon, FileTextIcon, EyeIcon } from './Icons';

interface VoiceNotesViewProps {
    voiceMemories: VoiceMemory[];
    documents: DocumentMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDelete: (ids: string[]) => void;
    onDocumentClick: (doc: DocumentMemory) => void;
}

const VoiceNoteItem: React.FC<{ 
    memory: VoiceMemory; 
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
        if (!memory.actionItems) return;
        const newItems = [...memory.actionItems];
        newItems[index].done = !newItems[index].done;
        onUpdate(memory.id, { actionItems: newItems });
    };

    const activeTaskCount = memory.actionItems?.filter(i => !i.done).length || 0;

    return (
        <div className={`bg-gray-800 rounded-2xl shadow-xl overflow-hidden border-4 transition-all mb-4 ${isSelected ? 'border-blue-500 scale-[1.02]' : 'border-gray-700'}`}>
            <div className="p-6 flex justify-between items-center cursor-pointer gap-5" onClick={handleHeaderClick}>
                {isSelectMode && (
                     <div className={`flex-shrink-0 w-10 h-10 rounded-xl border-4 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-400' : 'border-gray-500'}`}>
                        {isSelected && <CheckIcon className="w-7 h-7 text-white"/>}
                    </div>
                )}
                <div className="flex-shrink-0 relative">
                    <MicIcon className="w-10 h-10 text-blue-400"/>
                    {activeTaskCount > 0 && (
                        <div className="absolute -top-3 -right-3 bg-red-500 text-white text-sm font-black px-2 py-1 rounded-full border-2 border-gray-800">
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
                           className="w-full bg-gray-700 text-white text-2xl p-3 rounded-xl border-4 border-gray-600 focus:ring-4 focus:ring-blue-500"
                           autoFocus
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') handleUpdate();
                               if (e.key === 'Escape') handleCancel();
                           }}
                        />
                    ) : (
                        <h3 className="text-2xl font-black text-white leading-tight">{memory.title}</h3>
                    )}
                    <p className="text-lg text-gray-400 font-bold">{new Date(memory.date).toLocaleDateString()} {new Date(memory.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                </div>
                {!isSelectMode && <ChevronDownIcon className={`w-10 h-10 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />}
            </div>
            {isExpanded && !isSelectMode && (
                <div className="p-6 border-t-4 border-gray-700 space-y-6">
                     {memory.actionItems && memory.actionItems.length > 0 && (
                        <div className="bg-gray-900 rounded-2xl p-5 border-2 border-gray-600">
                            <h4 className="text-lg font-black text-blue-400 mb-4 uppercase tracking-widest">To-Do List</h4>
                            <ul className="space-y-4">
                                {memory.actionItems.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-4 p-2 bg-gray-800 rounded-xl border border-gray-700">
                                        <button 
                                            onClick={() => toggleActionItem(idx)}
                                            className={`flex-shrink-0 w-12 h-12 rounded-xl border-4 flex items-center justify-center transition-all ${item.done ? 'bg-green-600 border-green-600' : 'border-gray-500 hover:border-blue-400'}`}
                                            aria-label={item.done ? "Mark as not done" : "Mark as done"}
                                        >
                                            {item.done && <CheckIcon className="w-8 h-8 text-white"/>}
                                        </button>
                                        <span className={`text-gray-100 text-2xl font-medium pt-1 ${item.done ? 'line-through text-gray-500' : ''}`}>
                                            {item.text}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex items-center justify-end space-x-4">
                         {isEditing ? (
                             <>
                                <button onClick={handleUpdate} aria-label="Save" className="p-4 text-green-400 hover:text-green-300 bg-gray-700 rounded-2xl border-2 border-gray-600"><CheckIcon className="w-10 h-10"/></button>
                                <button onClick={handleCancel} aria-label="Cancel" className="p-4 text-gray-400 hover:text-gray-300 bg-gray-700 rounded-2xl border-2 border-gray-600"><XIcon className="w-10 h-10"/></button>
                            </>
                        ) : (
                            <button onClick={() => setIsEditing(true)} aria-label="Edit title" className="p-4 text-blue-400 hover:text-blue-300 bg-gray-700 rounded-2xl border-2 border-gray-600"><EditIcon className="w-10 h-10"/></button>
                        )}
                        <button onClick={() => onDelete(memory.id)} aria-label="Delete memory" className="p-4 text-red-500 hover:text-red-400 bg-gray-700 rounded-2xl border-2 border-gray-600"><TrashIcon className="w-10 h-10"/></button>
                    </div>

                    <div className="bg-gray-900 p-6 rounded-2xl max-h-96 overflow-y-auto border-4 border-gray-600">
                        <h4 className="text-xl font-black text-gray-400 mb-3 uppercase">Transcript</h4>
                        <p className="text-gray-200 text-2xl whitespace-pre-wrap leading-relaxed">{memory.transcript}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

const DocumentItem: React.FC<{ 
    memory: DocumentMemory; 
    onDelete: (id: string) => void; 
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void; 
    isSelectMode: boolean;
    isSelected: boolean;
    onToggleSelect: (id: string) => void;
    onClick: () => void;
}> = ({ memory, onDelete, onUpdate, isSelectMode, isSelected, onToggleSelect, onClick }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(memory.title);
    const titleInputRef = useRef<HTMLInputElement>(null);

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

    return (
        <div className={`bg-gray-800 rounded-2xl shadow-xl overflow-hidden border-4 transition-all mb-4 ${isSelected ? 'border-indigo-500 scale-[1.02]' : 'border-gray-700'}`}>
             <div className="p-6 flex justify-between items-center cursor-pointer gap-5" onClick={handleHeaderClick}>
                {isSelectMode && (
                     <div className={`flex-shrink-0 w-10 h-10 rounded-xl border-4 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-400' : 'border-gray-500'}`}>
                        {isSelected && <CheckIcon className="w-7 h-7 text-white"/>}
                    </div>
                )}
                <div className="flex-shrink-0"><FileTextIcon className="w-10 h-10 text-indigo-400"/></div>
                <div className="flex-grow overflow-hidden">
                     {isEditing ? (
                        <input
                           ref={titleInputRef}
                           type="text"
                           value={title}
                           onChange={(e) => setTitle(e.target.value)}
                           onClick={(e) => e.stopPropagation()}
                           className="w-full bg-gray-700 text-white text-2xl p-3 rounded-xl border-4 border-gray-600 focus:ring-4 focus:ring-blue-500"
                           autoFocus
                        />
                    ) : (
                        <div className="flex flex-col gap-1">
                             <h3 className="text-2xl font-black text-white truncate">{memory.title}</h3>
                             <span className="bg-indigo-900 text-indigo-200 text-xs font-black px-2 py-0.5 rounded w-fit uppercase">Document Scan</span>
                        </div>
                    )}
                    <p className="text-lg text-gray-400 font-bold mt-1">{new Date(memory.date).toLocaleDateString()}</p>
                </div>
                 {!isSelectMode && <ChevronDownIcon className={`w-10 h-10 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />}
            </div>
            {isExpanded && !isSelectMode && (
                 <div className="p-6 border-t-4 border-gray-700 space-y-6">
                     <button onClick={onClick} className="w-full flex items-center justify-center gap-4 px-6 py-5 bg-indigo-600 text-white font-black text-2xl rounded-2xl hover:bg-indigo-700 shadow-xl transition-all">
                         <EyeIcon className="w-10 h-10"/> VIEW DOCUMENT
                     </button>
                     <div className="flex items-center justify-end space-x-4">
                        {isEditing ? (
                            <>
                                <button onClick={handleUpdate} className="p-4 text-green-400 bg-gray-700 rounded-2xl border-2 border-gray-600"><CheckIcon className="w-10 h-10"/></button>
                                <button onClick={handleCancel} className="p-4 text-gray-400 bg-gray-700 rounded-2xl border-2 border-gray-600"><XIcon className="w-10 h-10"/></button>
                            </>
                        ) : (
                            <button onClick={() => setIsEditing(true)} className="p-4 text-blue-400 bg-gray-700 rounded-2xl border-2 border-gray-600"><EditIcon className="w-10 h-10"/></button>
                        )}
                        <button onClick={() => onDelete(memory.id)} className="p-4 text-red-500 bg-gray-700 rounded-2xl border-2 border-gray-600"><TrashIcon className="w-10 h-10"/></button>
                     </div>
                 </div>
            )}
        </div>
    )
}

const VoiceNotesView: React.FC<VoiceNotesViewProps> = ({ voiceMemories, documents, onSave, onDelete, onUpdate, bulkDelete, onDocumentClick }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    
    const handleSaveNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSave({ ...mem, category: 'personal' });
        setIsRecording(false);
    };

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

    const hasAnyContent = voiceMemories.length > 0 || documents.length > 0;

    return (
        <div className="space-y-10">
            {isRecording && (
                <Recorder 
                    onSave={handleSaveNote} 
                    onCancel={() => setIsRecording(false)}
                    titlePlaceholder={`Voice Note - ${new Date().toLocaleDateString()}`}
                    saveButtonText="Save Note"
                />
            )}

            <button onClick={() => setIsRecording(true)} className="w-full flex flex-col items-center justify-center gap-4 p-8 bg-blue-600 rounded-3xl hover:bg-blue-700 border-4 border-dashed border-blue-400 hover:border-blue-300 transition-all shadow-2xl group focus:ring-8 focus:ring-blue-400" aria-label="Record new thought or to-do">
                <MicIcon className="w-20 h-20 text-white group-active:scale-110 transition-transform"/>
                <span className="text-3xl font-black text-white uppercase tracking-tight">Record Thoughts</span>
            </button>

            <div className="space-y-6">
                <div className="flex justify-between items-center border-b-4 border-gray-700 pb-4">
                    <h2 className="text-3xl font-black text-white uppercase tracking-tight">My Notes</h2>
                     {hasAnyContent && (
                        <button 
                            onClick={() => {
                                setIsSelectMode(!isSelectMode);
                                setSelectedIds(new Set());
                            }} 
                            className="px-6 py-3 text-xl font-black rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors border-2 border-gray-600 uppercase tracking-widest"
                        >
                            {isSelectMode ? 'CANCEL' : 'SELECT'}
                        </button>
                    )}
                </div>
                
                {!hasAnyContent ? (
                    <div className="text-center py-20 px-8 bg-gray-800 rounded-3xl border-2 border-gray-700">
                        <p className="text-2xl text-gray-400 font-bold uppercase tracking-tight opacity-50">
                            Your personal vault is empty. 
                            <br/><br/> 
                            Tap the record button to start.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Documents Section */}
                        {documents.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-gray-400 font-black uppercase text-sm tracking-widest border-l-8 border-indigo-500 pl-4">Documents</h3>
                                {documents.map(doc => (
                                    <DocumentItem 
                                        key={doc.id}
                                        memory={doc}
                                        onDelete={onDelete}
                                        onUpdate={onUpdate}
                                        isSelectMode={isSelectMode}
                                        isSelected={selectedIds.has(doc.id)}
                                        onToggleSelect={toggleSelection}
                                        onClick={() => onDocumentClick(doc)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Voice Notes Section */}
                         {voiceMemories.length > 0 && (
                             <div className="space-y-4">
                                <h3 className="text-gray-400 font-black uppercase text-sm tracking-widest border-l-8 border-blue-500 pl-4">Voice Notes</h3>
                                {voiceMemories.map(mem => (
                                    <VoiceNoteItem 
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
                         )}
                    </div>
                )}
            </div>

            {isSelectMode && selectedIds.size > 0 && (
                <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-30 w-11/12 max-w-sm">
                    <button onClick={handleBulkDelete} className="w-full bg-red-600 text-white font-black text-2xl py-6 px-4 rounded-2xl shadow-2xl flex items-center justify-center gap-4 border-b-8 border-red-800 active:border-b-0 active:translate-y-2 uppercase tracking-tighter">
                        <TrashIcon className="w-10 h-10"/> DELETE ({selectedIds.size})
                    </button>
                </div>
            )}
        </div>
    );
};

export default VoiceNotesView;

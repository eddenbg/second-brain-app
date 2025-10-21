import React, { useState } from 'react';
import type { AnyMemory, PhysicalItemMemory, VideoItemMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, CameraIcon, VideoIcon, MapPinIcon } from './Icons';
import AddPhysicalItemModal from './AddPhysicalItemModal';

interface PhysicalItemsViewProps {
  memories: AnyMemory[];
  onDelete: (id: string) => void;
  onUpdateTitle: (id: string, newTitle: string) => void;
  onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
}

const Item: React.FC<{ memory: AnyMemory; onDelete: (id: string) => void; onUpdateTitle: (id: string, newTitle: string) => void; }> = ({ memory, onDelete, onUpdateTitle }) => {
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

const PhysicalItemsView: React.FC<PhysicalItemsViewProps> = ({ memories, onSave, onDelete, onUpdateTitle }) => {
    const [showAddModal, setShowAddModal] = useState(false);

    const handleSave = (memory: Omit<AnyMemory, 'id'|'date'|'category'>) => {
        onSave({
            ...memory,
            category: 'personal',
        });
    };

    return (
        <div className="space-y-8">
            {showAddModal && <AddPhysicalItemModal onClose={() => setShowAddModal(false)} onSave={handleSave} />}
            
            <button onClick={() => setShowAddModal(true)} className="w-full flex flex-col items-center justify-center gap-2 p-6 bg-purple-600 rounded-lg hover:bg-purple-700 border-2 border-dashed border-purple-400 hover:border-purple-300 transition-colors">
                <CameraIcon className="w-10 h-10 text-white"/>
                <span className="text-xl font-semibold text-white">Add New Physical Item</span>
            </button>
            
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white border-b border-gray-700 pb-2">My Saved Items</h2>
                {memories.length > 0 ? (
                    memories.map(mem => <Item key={mem.id} memory={mem} onDelete={onDelete} onUpdateTitle={onUpdateTitle} />)
                ) : (
                    <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                        <p className="mt-2 text-gray-400">Tap the button above to remember a physical item.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PhysicalItemsView;

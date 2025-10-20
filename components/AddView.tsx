import React, { useState } from 'react';
import Recorder from './Recorder';
import AddWebMemoryModal from './AddWebMemoryModal';
import AddPhysicalItemModal from './AddPhysicalItemModal';
import { LinkIcon, CameraIcon } from './Icons';
import type { AnyMemory } from '../types';

interface AddViewProps {
    onSave: (memory: AnyMemory) => void;
}

const AddView: React.FC<AddViewProps> = ({ onSave }) => {
    const [isAddWebModalOpen, setIsAddWebModalOpen] = useState(false);
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

    return (
        <div className="space-y-8">
            {isAddWebModalOpen && <AddWebMemoryModal onClose={() => setIsAddWebModalOpen(false)} onSave={onSave} />}
            {isAddItemModalOpen && <AddPhysicalItemModal onClose={() => setIsAddItemModalOpen(false)} onSave={onSave} />}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => setIsAddWebModalOpen(true)} className="flex flex-col items-center justify-center gap-2 p-6 bg-gray-800 rounded-lg hover:bg-gray-700 border-2 border-dashed border-gray-600 hover:border-blue-500 transition-colors">
                    <LinkIcon className="w-10 h-10 text-gray-400"/>
                    <span className="text-xl font-semibold text-white">Add Web Memory</span>
                </button>
                 <button onClick={() => setIsAddItemModalOpen(true)} className="flex flex-col items-center justify-center gap-2 p-6 bg-gray-800 rounded-lg hover:bg-gray-700 border-2 border-dashed border-gray-600 hover:border-purple-500 transition-colors">
                    <CameraIcon className="w-10 h-10 text-gray-400"/>
                    <span className="text-xl font-semibold text-white">Add Physical Item</span>
                </button>
            </div>
            <Recorder onSave={onSave} />
        </div>
    );
};

export default AddView;
import React, { useState } from 'react';
import Recorder from './Recorder';
import type { AnyMemory, VoiceMemory } from '../types';
import { MicIcon } from './Icons';

interface VoiceNotesViewProps {
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
}

const RecordingList: React.FC<VoiceNotesViewProps> = ({ onSave }) => {
    const [isRecording, setIsRecording] = useState(false);
    
    const handleSaveNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSave({
            ...mem,
            category: 'personal',
        });
        setIsRecording(false);
    }
    
    if (isRecording) {
        return <Recorder 
            onSave={handleSaveNote} 
            onCancel={() => setIsRecording(false)} 
            titlePlaceholder={`Voice Note - ${new Date().toLocaleDateString()}`}
            saveButtonText="Save Note"
        />;
    }

    return (
        <div className="flex flex-col items-center justify-center h-full">
            <button
                onClick={() => setIsRecording(true)}
                className="flex items-center justify-center w-48 h-48 rounded-full transition-all duration-300 ease-in-out bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-400"
                aria-label={'Start Recording'}
            >
                <MicIcon className="w-24 h-24 text-white" />
            </button>
        </div>
    );
};

export default RecordingList;

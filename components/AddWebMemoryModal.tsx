import React, { useState } from 'react';
import { generateTitleForContent } from '../services/geminiService';
import { BrainCircuitIcon, LinkIcon, SaveIcon, XIcon } from './Icons';
import MiniRecorder from './MiniRecorder';
import type { WebMemory } from '../types';
import { getCurrentLocation } from '../utils/location';

const AddWebMemoryModal: React.FC<{onClose: () => void; onSave: (memory: WebMemory) => void;}> = ({ onClose, onSave }) => {
    const [url, setUrl] = useState('');
    const [content, setContent] = useState('');
    const [title, setTitle] = useState('');
    const [voiceNote, setVoiceNote] = useState('');
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

    const handleGenerateTitle = async () => {
        if (!content.trim()) return;
        setIsGeneratingTitle(true);
        const generatedTitle = await generateTitleForContent(content);
        setTitle(generatedTitle);
        setIsGeneratingTitle(false);
    }

    const handleSave = async () => {
        if (!content.trim() || !title.trim()) return;

        const location = await getCurrentLocation();

        const newMemory: WebMemory = {
            id: Date.now().toString(),
            type: 'web',
            date: new Date().toISOString(),
            title,
            url,
            content,
            ...(location && { location }),
            ...(voiceNote.trim() && { voiceNote: { transcript: voiceNote.trim() } })
        };
        onSave(newMemory);
        onClose();
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-600">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3"><LinkIcon/> Add Web Memory</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <main className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label htmlFor="url" className="block text-lg font-medium text-gray-300 mb-2">URL (Optional)</label>
                        <input id="url" type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/article" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                     <div>
                        <label htmlFor="content" className="block text-lg font-medium text-gray-300 mb-2">Pasted Content</label>
                        <textarea id="content" value={content} onChange={e => setContent(e.target.value)} rows={8} placeholder="Paste article text or notes here..." className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                        <label htmlFor="title" className="block text-lg font-medium text-gray-300 mb-2">Title</label>
                        <div className="flex gap-2">
                           <input id="title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter a title" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                           <button onClick={handleGenerateTitle} disabled={isGeneratingTitle || !content.trim()} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2">
                               <BrainCircuitIcon className="w-5 h-5"/> {isGeneratingTitle ? 'Generating...' : 'Generate'}
                           </button>
                        </div>
                    </div>
                    <div>
                        <MiniRecorder onTranscriptChange={setVoiceNote} />
                        {voiceNote && <div className="mt-2 text-sm bg-gray-900 border border-gray-700 rounded-md p-2 text-gray-300 max-h-24 overflow-y-auto">{voiceNote}</div>}
                    </div>
                </main>
                 <footer className="p-4 flex justify-end gap-4 border-t border-gray-700 bg-gray-800 rounded-b-lg">
                    <button onClick={onClose} className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} disabled={!content.trim() || !title.trim()} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-500">
                        <SaveIcon className="w-6 h-6"/> Save Memory
                    </button>
                </footer>
            </div>
        </div>
    )
}

export default AddWebMemoryModal;
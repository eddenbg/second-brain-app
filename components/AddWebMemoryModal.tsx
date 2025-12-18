
import React, { useState, useEffect } from 'react';
import { generateTitleForContent } from '../services/geminiService';
import type { WebMemory } from '../types';
import { BrainCircuitIcon, XIcon, SaveIcon, LinkIcon } from './Icons';
import MiniRecorder from './MiniRecorder';
import { getCurrentLocation } from '../utils/location';

interface AddWebMemoryModalProps {
    onClose: () => void;
    onSave: (memory: Omit<WebMemory, 'id' | 'date' | 'category'>) => void;
    initialUrl?: string;
    initialTitle?: string;
}

const AddWebMemoryModal: React.FC<AddWebMemoryModalProps> = ({ onClose, onSave, initialUrl, initialTitle }) => {
    const [url, setUrl] = useState(initialUrl || '');
    const [title, setTitle] = useState(initialTitle || '');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [voiceNote, setVoiceNote] = useState('');
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

    // If we only got a title (sometimes shared text contains the URL)
    useEffect(() => {
        if (!url && title.includes('http')) {
            const match = title.match(/(https?:\/\/[^\s]+)/);
            if (match) {
                setUrl(match[0]);
            }
        }
    }, [title, url]);

    const handleGenerateTitle = async () => {
        if (!content.trim()) return;
        setIsGeneratingTitle(true);
        try {
            const generatedTitle = await generateTitleForContent(content);
            setTitle(generatedTitle);
        } catch (error) {
            console.error("Title generation failed:", error);
        } finally {
            setIsGeneratingTitle(false);
        }
    };

    const handleSave = async () => {
        if (!title.trim() && !url.trim()) return;
        const location = await getCurrentLocation();
        const newMemory: Omit<WebMemory, 'id' | 'date' | 'category'> = {
            type: 'web',
            url,
            title: title || 'Shared Link',
            content: content || `Shared URL: ${url}`,
            tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
            ...(voiceNote.trim() && { voiceNote: { transcript: voiceNote } }),
            ...(location && { location }),
        };
        onSave(newMemory);
        onClose();
    };
    
    const isSaveDisabled = (!title.trim() && !url.trim());

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[70] p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-600">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3"><LinkIcon/> Add Web Clip</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <main className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label htmlFor="url" className="block text-lg font-medium text-gray-300 mb-2">URL</label>
                        <input id="url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                        <label htmlFor="title" className="block text-lg font-medium text-gray-300 mb-2">Title / Description</label>
                         <div className="flex gap-2">
                           <input id="title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter a title for the clip" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                           {content.trim() && (
                               <button onClick={handleGenerateTitle} disabled={isGeneratingTitle} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2">
                                   <BrainCircuitIcon className="w-5 h-5"/> {isGeneratingTitle ? '...' : 'AI'}
                               </button>
                           )}
                        </div>
                    </div>
                    <div>
                        <label htmlFor="content" className="block text-lg font-medium text-gray-300 mb-2">Notes or Content (Optional)</label>
                        <textarea id="content" value={content} onChange={e => setContent(e.target.value)} rows={4} placeholder="Paste content or write your own notes here..." className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                        <label htmlFor="tags" className="block text-lg font-medium text-gray-300 mb-2">Tags</label>
                        <input id="tags" type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g., research, AI, psychology" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                     <div>
                        <MiniRecorder onTranscriptChange={setVoiceNote} />
                        {voiceNote && <div className="mt-2 text-sm bg-gray-900 border border-gray-700 rounded-md p-2 text-gray-300 max-h-24 overflow-y-auto">{voiceNote}</div>}
                    </div>
                </main>
                <footer className="p-4 flex justify-end gap-4 border-t border-gray-700 bg-gray-800 rounded-b-lg">
                    <button onClick={onClose} className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} disabled={isSaveDisabled} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-500">
                        <SaveIcon className="w-6 h-6"/> Save Clip
                    </button>
                </footer>
            </div>
        </div>
    );
}

export default AddWebMemoryModal;

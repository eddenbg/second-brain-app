
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
        <div className="fixed inset-0 bg-black/90 flex flex-col justify-center items-center z-[140] p-4">
            <div className="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col border-4 border-gray-600 overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b-4 border-gray-700 shrink-0 bg-gray-800">
                    <h2 className="text-xl font-black text-white flex items-center gap-4 uppercase"><LinkIcon className="w-8 h-8"/> Clip</h2>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleSave} 
                            disabled={isSaveDisabled} 
                            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-black rounded-xl text-sm uppercase shadow-xl disabled:bg-gray-700 active:scale-95 transition-all"
                        >
                            <SaveIcon className="w-5 h-5"/> SAVE
                        </button>
                        <button onClick={onClose} className="p-3 bg-gray-700 rounded-2xl active:scale-90 transition-transform"><XIcon className="w-6 h-6 text-gray-400"/></button>
                    </div>
                </header>
                
                <main className="flex-grow p-6 space-y-6 overflow-y-auto scroll-smooth">
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Link URL</label>
                        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="w-full bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                    </div>
                    
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Title</label>
                         <div className="flex gap-2">
                           <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Name your link" className="flex-grow bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                           <button onClick={handleGenerateTitle} className="p-4 bg-purple-600 text-white rounded-2xl shadow-lg active:scale-95 transition-all">
                               <BrainCircuitIcon className="w-6 h-6"/>
                           </button>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Notes</label>
                        <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} placeholder="What is this link about?" className="w-full bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                    </div>
                    
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Tags</label>
                        <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. school, research" className="w-full bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                    </div>
                    
                    <div className="bg-gray-900 p-6 rounded-[2rem] border border-gray-700 shadow-inner">
                        <MiniRecorder onTranscriptChange={setVoiceNote} />
                        {voiceNote && <div className="mt-4 text-xs bg-gray-800 border-2 border-gray-700 rounded-xl p-4 text-gray-200 font-medium leading-relaxed">{voiceNote}</div>}
                    </div>
                </main>
                
                <footer className="p-4 bg-gray-800 border-t-2 border-gray-700 shrink-0 text-center">
                    <button onClick={onClose} className="text-gray-500 font-black uppercase text-xs tracking-widest active:scale-95">Cancel</button>
                </footer>
            </div>
        </div>
    );
}

export default AddWebMemoryModal;

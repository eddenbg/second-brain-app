
import React, { useState } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task } from '../types';
import VoiceNotesView from './RecordingList';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import { MicIcon, ListIcon, FileTextIcon, ArrowLeftIcon, DownloadIcon, Loader2Icon, Volume2Icon } from './Icons';
import { generateSpeechFromText } from '../services/geminiService';
import { generatePDF } from '../services/pdfService';
import { decode, decodeAudioData } from '../utils/audio';
import QASession from './QASession';

interface PersonalViewProps {
    memories: AnyMemory[]; 
    tasks: Task[];
    onSaveMemory: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDeleteMemory: (id: string) => void;
    onUpdateMemory: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDeleteMemories: (ids: string[]) => void;
    
    onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    onUpdateTask: (id: string, updates: Partial<Task>) => void;
    onDeleteTask: (id: string) => void;
}

const PersonalDocumentView: React.FC<{
    doc: DocumentMemory;
    onBack: () => void;
}> = ({ doc, onBack }) => {
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioContextRef = React.useRef<AudioContext | null>(null);
    const audioSourceRef = React.useRef<AudioBufferSourceNode | null>(null);

    React.useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        return () => {
            audioSourceRef.current?.stop();
            audioContextRef.current?.close();
        };
    }, []);

    const handleReadAloud = async () => {
        if (isLoadingAudio || isPlaying) return;
        setIsLoadingAudio(true);
        try {
            const audioB64 = await generateSpeechFromText(doc.extractedText);
            if (audioB64 && audioContextRef.current) {
                const audioData = decode(audioB64);
                const audioBuffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
                
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                source.onended = () => setIsPlaying(false);
                source.start(0);
                audioSourceRef.current = source;
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Failed to play audio", error);
        } finally {
            setIsLoadingAudio(false);
        }
    };
    
    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4">
                <button onClick={onBack} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button>
                <h2 className="text-xl font-bold truncate">{doc.title}</h2>
            </header>
            <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto mb-4">
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex justify-center items-center"><img src={doc.imageDataUrl} alt="Scanned document" className="max-w-full max-h-full object-contain rounded-md"/></div>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-y-auto">
                    <div className="flex flex-col gap-2 mb-4">
                         <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-gray-300">Extracted Text:</h3>
                            <button onClick={handleReadAloud} disabled={isLoadingAudio || isPlaying} className="flex items-center gap-2 px-3 py-1 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:bg-gray-500 text-sm">
                                {isLoadingAudio ? <Loader2Icon className="w-4 h-4 animate-spin"/> : <Volume2Icon className="w-4 h-4"/>}
                                {isLoadingAudio ? '...' : isPlaying ? 'Stop' : 'Read'}
                            </button>
                        </div>
                         <button 
                            onClick={() => generatePDF(doc.title, doc.extractedText, doc.imageDataUrl)}
                            className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-500 text-sm w-full"
                        >
                            <DownloadIcon className="w-4 h-4" /> Download PDF
                        </button>
                    </div>
                    <p className="text-gray-200 whitespace-pre-wrap">{doc.extractedText}</p>
                </div>
            </div>
             <div className="flex-shrink-0">
                 <h3 className="text-lg font-semibold text-gray-300 mb-2 text-center">Ask about this document:</h3>
                <div className="h-[30vh] border border-gray-700 rounded-lg">
                   <QASession memories={[doc]} tasks={[]} />
                </div>
            </div>
        </div>
    );
};

const PersonalView: React.FC<PersonalViewProps> = ({ 
    memories, tasks, 
    onSaveMemory, onDeleteMemory, onUpdateMemory, bulkDeleteMemories,
    onAddTask, onUpdateTask, onDeleteTask
}) => {
    const [activeTab, setActiveTab] = useState<'notes' | 'board'>('notes');
    const [showAddDocModal, setShowAddDocModal] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<DocumentMemory | null>(null);

    const voiceMemories = memories.filter(m => m.type === 'voice' && m.category === 'personal') as VoiceMemory[];
    const personalDocs = memories.filter(m => m.type === 'document' && m.category === 'personal') as DocumentMemory[];

    const handleSaveDocument = (mem: Omit<DocumentMemory, 'id'|'date'>) => {
        onSaveMemory(mem); 
        setShowAddDocModal(false);
    };

    if (selectedDocument) {
        return <PersonalDocumentView doc={selectedDocument} onBack={() => setSelectedDocument(null)} />;
    }

    return (
        <div className="flex flex-col h-full">
            {showAddDocModal && (
                <AddDocumentModal 
                    onSave={handleSaveDocument} 
                    onClose={() => setShowAddDocModal(false)}
                />
            )}

            {/* Tab Switcher */}
             <div className="flex mb-4 bg-gray-800 rounded-lg p-1 shrink-0">
                <button onClick={() => setActiveTab('notes')} className={`flex-1 py-2 rounded-md font-semibold transition-colors flex items-center justify-center gap-2 ${activeTab === 'notes' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    <MicIcon className="w-4 h-4"/> Notes & Docs
                </button>
                <button onClick={() => setActiveTab('board')} className={`flex-1 py-2 rounded-md font-semibold transition-colors flex items-center justify-center gap-2 ${activeTab === 'board' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    <ListIcon className="w-4 h-4"/> Task Board
                </button>
             </div>

            <div className="flex-grow overflow-hidden">
                {activeTab === 'notes' ? (
                     <div className="h-full overflow-y-auto flex flex-col gap-4">
                        {/* Action Buttons */}
                        <div className="grid grid-cols-1 gap-4 shrink-0">
                             <button onClick={() => setShowAddDocModal(true)} className="w-full flex flex-col items-center justify-center gap-2 p-4 bg-indigo-600 rounded-lg hover:bg-indigo-700 border-2 border-dashed border-indigo-400 hover:border-indigo-300 transition-colors">
                                <FileTextIcon className="w-8 h-8 text-white"/>
                                <span className="text-lg font-semibold text-white">Scan Document</span>
                            </button>
                        </div>

                        <VoiceNotesView 
                            voiceMemories={voiceMemories} 
                            documents={personalDocs}
                            onSave={onSaveMemory} 
                            onDelete={onDeleteMemory} 
                            onUpdate={onUpdateMemory} 
                            bulkDelete={bulkDeleteMemories}
                            onDocumentClick={setSelectedDocument}
                        />
                     </div>
                ) : (
                    <KanbanBoard 
                        tasks={tasks} 
                        category="personal"
                        courseFilter={null}
                        onUpdateTask={onUpdateTask} 
                        onDeleteTask={onDeleteTask}
                        onAddTask={onAddTask}
                        memories={memories}
                        onOpenMemory={(mem) => {
                            if (mem.type === 'document') setSelectedDocument(mem as DocumentMemory);
                            else setActiveTab('notes');
                        }} 
                    />
                )}
            </div>
        </div>
    );
};

export default PersonalView;

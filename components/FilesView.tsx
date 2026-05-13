import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { AnyMemory, DocumentMemory, VoiceMemory, FileMemory } from '../types';
import {
    FolderIcon, MicIcon, CameraIcon, FileTextIcon,
    XIcon, Loader2Icon, SearchIcon, Volume2Icon, StopCircleIcon,
    CheckIcon, PenToolIcon, BrainCircuitIcon
} from './Icons';
import AddDocumentModal from './AddDocumentModal';
import { StudyHubOverlay, SummaryFocusModal } from './StudyHub';
import { generateSpeechFromText, generateStudyOverview } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import DrivePickerModal from './DrivePickerModal';
import type { DriveFile } from '../services/googleDriveService';

interface FilesViewProps {
    memories: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id' | 'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}

// ── Media Preview Drawer ─────────────────────────────────────────────────────────────────────────────────────────
const MediaPreviewDrawer: React.FC<{
    memory: AnyMemory;
    onClose: () => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ memory, onClose, onUpdate }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        return () => {
            audioSourceRef.current?.stop();
            audioContextRef.current?.close();
        };
    }, []);

    const toggleAudio = async () => {
        if (isPlaying) {
            audioSourceRef.current?.stop();
            setIsPlaying(false);
            return;
        }
        const textToRead = (memory as VoiceMemory).transcript || (memory as DocumentMemory).extractedText || (memory as FileMemory).summary || memory.title;
        if (!textToRead) return;
        setIsGenerating(true);
        try {
            const audioB64 = await generateSpeechFromText(textToRead);
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
        } catch (e) { console.error('Playback error', e); }
        finally { setIsGenerating(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[110] flex flex-col justify-end animate-fade-in" onClick={onClose}>
            <div className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col p-6 border-t-4 border-gray-700 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mb-6 shrink-0" />
                <header className="flex justify-between items-start mb-4 shrink-0">
                    <div className="overflow-hidden pr-4">
                        <h2 className="text-xl font-black text-white uppercase truncate tracking-tight">{memory.title}</h2>
                        {memory.course && <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{memory.course}</span>}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onUpdate(memory.id, { isHidden: !memory.isHidden })}
                            className={`p-3 rounded-2xl active:scale-90 transition-all ${memory.isHidden ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                        >
                            <CheckIcon className="w-6 h-6" />
                        </button>
                        <button onClick={onClose} className="p-3 bg-gray-700 rounded-2xl active:scale-90 transition-transform">
                            <XIcon className="w-6 h-6 text-white" />
                        </button>
                    </div>
                </header>

                <div className="flex-grow overflow-y-auto space-y-6 pb-6 min-h-0">
                    {memory.type === 'file' && (
                        <div className="flex flex-col items-center gap-6">
                            <div className="bg-indigo-900/30 p-10 rounded-full border-4 border-indigo-500 shadow-2xl">
                                <FileTextIcon className="w-20 h-20 text-indigo-400" />
                            </div>
                            <button onClick={toggleAudio} disabled={isGenerating} className="px-10 py-5 bg-teal-600 text-white font-black rounded-3xl text-xl shadow-xl flex items-center gap-4">
                                {isGenerating ? <Loader2Icon className="w-8 h-8 animate-spin" /> : isPlaying ? <StopCircleIcon className="w-8 h-8" /> : <Volume2Icon className="w-8 h-8" />}
                                {isPlaying ? 'STOP READING' : 'READ SUMMARY'}
                            </button>
                            <a href={(memory as FileMemory).fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 font-black uppercase underline tracking-widest">
                                {(memory as FileMemory).sourceType === 'drive' ? 'Open in Drive' : 'Download Original'}
                            </a>
                        </div>
                    )}
                    {(memory as VoiceMemory).summary && (
                        <div className="bg-gray-900 p-6 rounded-[2rem] border-2 border-gray-700">
                            <h3 className="text-blue-400 font-black text-[10px] uppercase tracking-widest mb-2">Memory Summary</h3>
                            <p className="text-gray-200 text-lg leading-relaxed font-medium">{(memory as VoiceMemory).summary}</p>
                        </div>
                    )}
                    {(memory as DocumentMemory).extractedText && (
                        <div className="bg-gray-900 p-6 rounded-[2rem] border-2 border-gray-700">
                            <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest mb-2">Extracted Text</h3>
                            <p className="text-gray-300 text-sm whitespace-pre-wrap">{(memory as DocumentMemory).extractedText}</p>
                        </div>
                    )}
                </div>
                <button onClick={onClose} className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl text-xl shadow-lg mt-4">DONE</button>
            </div>
        </div>
    );
};

const DRIVE_BADGE = (
    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
        <svg viewBox="0 0 87.3 78" className="w-2.5 h-2.5">
            <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
            <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.6C.4 50 0 51.55 0 53.1h27.5z" fill="#00AC47"/>
            <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 11.9z" fill="#EA4335"/>
            <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832D"/>
            <path d="M59.85 53.1H27.5L13.75 76.9c1.35.8 2.9 1.1 4.45 1.1h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684FC"/>
            <path d="M73.4 26.85l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28.1H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
        </svg>
    </div>
);

const DRIVE_BUTTON_ICON = (
    <svg viewBox="0 0 87.3 78" className="w-4 h-4 shrink-0">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.6C.4 50 0 51.55 0 53.1h27.5z" fill="#00AC47"/>
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 11.9z" fill="#EA4335"/>
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832D"/>
        <path d="M59.85 53.1H27.5L13.75 76.9c1.35.8 2.9 1.1 4.45 1.1h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684FC"/>
        <path d="M73.4 26.85l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28.1H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
    </svg>
);

// ── Files View ────────────────────────────────────────────────────────────────────────────────────────────
const FilesView: React.FC<FilesViewProps> = ({ memories, onSave, onDelete, onUpdate }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'audio' | 'image' | 'doc' | 'moodle' | 'drive' | 'hidden'>('all');
    const [previewMemory, setPreviewMemory] = useState<AnyMemory | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [showSummaryPrompt, setShowSummaryPrompt] = useState(false);
    const [summaryInitialType, setSummaryInitialType] = useState<'written' | 'audio' | 'video' | 'research'>('written');
    const [isGeneratingMulti, setIsGeneratingMulti] = useState(false);
    const [activeStudyHub, setActiveStudyHub] = useState<{ type: any; content: string; title: string; videoUri?: string } | null>(null);
    const [showDrivePicker, setShowDrivePicker] = useState(false);

    const importedDriveIds = useMemo(
        () => new Set(memories.filter(m => m.type === 'file' && (m as FileMemory).sourceType === 'drive').map(m => (m as FileMemory).driveId || '')),
        [memories]
    );

    const handleImportFromDrive = (file: DriveFile) => {
        onSave({
            type: 'file',
            title: file.name,
            fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
            mimeType: file.mimeType,
            sourceType: 'drive',
            driveId: file.id,
            category: 'personal',
        } as Omit<FileMemory, 'id' | 'date'>);
    };

    const filteredMemories = useMemo(() => {
        let results = memories;
        if (filter === 'audio') results = results.filter(m => m.type === 'voice');
        if (filter === 'image') results = results.filter(m => m.type === 'item' || m.type === 'video');
        if (filter === 'doc') results = results.filter(m => m.type === 'document');
        if (filter === 'moodle') results = results.filter(m => m.type === 'file' && (m as FileMemory).sourceType === 'moodle');
        if (filter === 'drive') results = results.filter(m => m.type === 'file' && (m as FileMemory).sourceType === 'drive');
        if (filter === 'hidden') results = results.filter(m => m.isHidden);
        else results = results.filter(m => !m.isHidden);

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            results = results.filter(m => m.title.toLowerCase().includes(q));
        }
        return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [memories, filter, searchQuery]);

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleMultiStudy = async (focus: string, type: 'written' | 'audio' | 'video' | 'research') => {
        setIsGeneratingMulti(true);
        const selectedMemories = memories.filter(m => selectedIds.has(m.id));
        try {
            const result = await generateStudyOverview(selectedMemories, focus, type);
            setActiveStudyHub({ ...result, type });
            setShowSummaryPrompt(false);
            setIsSelectMode(false);
            setSelectedIds(new Set());
        } catch (e) { console.error(e); }
        finally { setIsGeneratingMulti(false); }
    };

    const handleItemClick = (mem: AnyMemory) => {
        if (isSelectMode) toggleSelection(mem.id);
        else setPreviewMemory(mem);
    };

    return (
        <div className="flex flex-col h-full space-y-4 max-w-4xl mx-auto overflow-hidden bg-[#001f3f]">
            {previewMemory && <MediaPreviewDrawer memory={previewMemory} onUpdate={onUpdate} onClose={() => setPreviewMemory(null)} />}
            {showSummaryPrompt && <SummaryFocusModal onClose={() => setShowSummaryPrompt(false)} onGenerate={handleMultiStudy} isGenerating={isGeneratingMulti} initialType={summaryInitialType} />}
            {activeStudyHub && <StudyHubOverlay overview={activeStudyHub} memories={memories} onClose={() => setActiveStudyHub(null)} />}
            {showDrivePicker && (
                <DrivePickerModal
                    onClose={() => setShowDrivePicker(false)}
                    onImport={handleImportFromDrive}
                    importedIds={importedDriveIds}
                />
            )}

            <header className="flex flex-col gap-3 shrink-0">
                <div className="flex items-center justify-between gap-2">
                    <div className="relative flex-grow">
                        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="SEARCH VAULT..."
                            aria-label="Search memories"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/10 p-4 pl-12 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-black uppercase text-xs tracking-tight shadow-inner text-white"
                        />
                    </div>
                    <button
                        onClick={() => setShowDrivePicker(true)}
                        aria-label="Import from Google Drive"
                        className="px-4 py-4 rounded-2xl font-black text-xs uppercase border-2 bg-white/10 text-gray-400 border-white/10 flex items-center gap-1.5 shrink-0"
                    >
                        {DRIVE_BUTTON_ICON}
                        Drive
                    </button>
                    <button
                        onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds(new Set()); }}
                        aria-label={isSelectMode ? 'Cancel selection' : 'Select items'}
                        className={`px-4 py-4 rounded-2xl font-black text-xs uppercase border-2 transition-all shrink-0 ${isSelectMode ? 'bg-yellow-500 text-[#001f3f] border-yellow-400' : 'bg-white/10 text-gray-400 border-white/10'}`}
                    >
                        {isSelectMode ? 'CANCEL' : 'SELECT'}
                    </button>
                </div>
            </header>

            <div className="flex gap-2 overflow-x-auto pb-2 shrink-0 scrollbar-hide">
                {(['all', 'audio', 'image', 'doc', 'moodle', 'drive', 'hidden'] as const).map(id => (
                    <button
                        key={id}
                        onClick={() => setFilter(id)}
                        aria-label={`Filter by ${id}`}
                        className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md flex-shrink-0 ${filter === id ? 'bg-yellow-500 text-[#001f3f]' : 'bg-white/10 text-gray-400 hover:text-gray-200'}`}
                    >
                        {id === 'moodle' ? 'Moodle' : id === 'hidden' ? 'Archived' : id === 'drive' ? 'Drive' : id}
                    </button>
                ))}
            </div>

            <main className="flex-grow overflow-y-auto space-y-3 pb-40 px-0.5">
                {filteredMemories.length === 0 ? (
                    <div className="text-center py-20 bg-white/5 rounded-[2rem] border-4 border-dashed border-white/10 opacity-50">
                        <FolderIcon className="w-16 h-16 mx-auto text-gray-600 mb-4" />
                        <p className="text-xs text-gray-500 font-black uppercase tracking-widest">Vault Empty</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3.5">
                        {filteredMemories.map(mem => (
                            <div
                                key={mem.id}
                                onClick={() => handleItemClick(mem)}
                                aria-label={`View ${mem.title}`}
                                className={`bg-white/5 p-4 rounded-[2rem] border-4 flex flex-col gap-3 shadow-xl active:scale-95 transition-all cursor-pointer relative ${selectedIds.has(mem.id) ? 'border-yellow-500' : 'border-white/10'}`}
                            >
                                {isSelectMode && (
                                    <div className={`absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedIds.has(mem.id) ? 'bg-yellow-500 border-yellow-400' : 'border-white/10'}`}>
                                        {selectedIds.has(mem.id) && <CheckIcon className="w-4 h-4 text-[#001f3f]" />}
                                    </div>
                                )}
                                <div className="p-4 bg-black/20 rounded-2xl w-fit relative">
                                    {mem.type === 'file' ? <FileTextIcon className="w-6 h-6 text-yellow-500" /> :
                                     mem.type === 'voice' ? <MicIcon className="w-6 h-6 text-yellow-500" /> :
                                     <CameraIcon className="w-6 h-6 text-yellow-500" />}
                                    {mem.type === 'file' && (mem as FileMemory).sourceType === 'drive' && DRIVE_BADGE}
                                </div>
                                <div className="overflow-hidden">
                                    <h3 className="text-sm font-black text-white truncate uppercase tracking-tight">{mem.title}</h3>
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{mem.course || 'Personal'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {isSelectMode && selectedIds.size > 0 && (
                <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm flex gap-3 animate-slide-up">
                    <button
                        onClick={() => { setSummaryInitialType('written'); setShowSummaryPrompt(true); }}
                        aria-label="Generate Study Pod"
                        className="flex-1 bg-yellow-500 text-[#001f3f] font-black py-5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 uppercase text-xs"
                    >
                        <PenToolIcon className="w-6 h-6" /> Study Pod
                    </button>
                    <button
                        onClick={() => { setSummaryInitialType('research'); setShowSummaryPrompt(true); }}
                        aria-label="Deep Recall"
                        className="flex-1 bg-white/10 text-white font-black py-5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 uppercase text-xs border-2 border-white/10"
                    >
                        <BrainCircuitIcon className="w-6 h-6" /> Deep Recall
                    </button>
                </div>
            )}
        </div>
    );
};

export default FilesView;

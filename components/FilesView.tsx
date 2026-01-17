import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { AnyMemory, DocumentMemory, VoiceMemory, PhysicalItemMemory, VideoItemMemory, FileMemory } from '../types';
import { 
    FolderIcon, MicIcon, CameraIcon, FileTextIcon, GraduationCapIcon, 
    DownloadIcon, PlusIcon, XIcon, GlobeIcon, Loader2Icon, 
    SearchIcon, ShareIcon, Volume2Icon, PlayIcon, EyeIcon, VideoIcon, StopCircleIcon, ArrowLeftIcon,
    TrashIcon, CheckIcon, PenToolIcon, BrainCircuitIcon, BotIcon, SendIcon
} from './Icons';
import AddDocumentModal from './AddDocumentModal';
import { generateSpeechFromText, answerQuestionFromContext, generateStudyOverview, checkVideoStatus } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';

interface FilesViewProps {
    memories: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id' | 'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}

const StudyHubOverlay: React.FC<{
    overview: { type: 'written' | 'audio' | 'video' | 'research', content: string, title: string, videoUri?: string };
    memories: AnyMemory[];
    onClose: () => void;
}> = ({ overview, memories, onClose }) => {
    const [isJoining, setIsJoining] = useState(overview.type === 'research');
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [isVideoLoading, setIsVideoLoading] = useState(overview.type === 'video');
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => {
        if (overview.type === 'video' && overview.videoUri) {
            const poll = async () => {
                let done = false;
                while (!done) {
                    await new Promise(r => setTimeout(r, 10000));
                    const status = await checkVideoStatus(overview.videoUri!);
                    if (status.done) {
                        done = true;
                        setVideoUrl(`${status.uri}&key=${process.env.API_KEY}`);
                        setIsVideoLoading(false);
                    }
                }
            };
            poll();
        }
    }, [overview]);

    const togglePodcast = async () => {
        if (isPlaying) {
            audioSourceRef.current?.stop();
            setIsPlaying(false);
            return;
        }
        setIsLoadingAudio(true);
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioContextRef.current = ctx;
            const audioB64 = await generateSpeechFromText(overview.content);
            if (audioB64) {
                const buffer = await decodeAudioData(decode(audioB64), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => setIsPlaying(false);
                source.start(0);
                audioSourceRef.current = source;
                setIsPlaying(true);
            }
        } catch (e) { console.error(e); }
        finally { setIsLoadingAudio(false); }
    };

    if (isJoining) {
        return (
            <div className="fixed inset-0 bg-gray-900 z-[300] flex flex-col animate-fade-in">
                <header className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                    <button onClick={onClose} className="p-3 bg-gray-800 rounded-xl"><ArrowLeftIcon className="w-6 h-6"/></button>
                    <div className="text-center">
                        <h2 className="text-xl font-black uppercase text-blue-400 tracking-tighter">Deep Research Session</h2>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Knowledge Synthesis Active</p>
                    </div>
                    <div className="w-10" />
                </header>
                <div className="flex-grow overflow-hidden bg-[#0b0f1a]">
                    <StudyChat memories={memories} initialContext={overview.content} />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/95 z-[250] flex flex-col p-6 animate-fade-in overflow-y-auto">
            <div className="max-w-2xl mx-auto w-full space-y-8 py-10">
                <header className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="bg-purple-600 p-4 rounded-3xl shadow-xl shadow-purple-900/40">
                            {overview.type === 'audio' ? <Volume2Icon className="w-10 h-10 text-white"/> : <VideoIcon className="w-10 h-10 text-white"/>}
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">{overview.title}</h2>
                            <p className="text-purple-400 font-bold uppercase text-xs tracking-widest">{overview.type} STUDY POD</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-4 bg-gray-800 rounded-2xl"><XIcon className="w-8 h-8 text-white"/></button>
                </header>

                <div className="bg-gray-800 rounded-[3rem] border-4 border-gray-700 p-8 shadow-2xl relative overflow-hidden">
                    {overview.type === 'video' && (
                        <div className="mb-8 rounded-2xl overflow-hidden border-4 border-gray-700 shadow-2xl aspect-video bg-black flex items-center justify-center relative">
                            {isVideoLoading ? (
                                <div className="text-center space-y-4">
                                    <Loader2Icon className="w-12 h-12 animate-spin text-purple-500 mx-auto" />
                                    <p className="text-xs font-black uppercase text-gray-500 tracking-widest animate-pulse">Generating Cinematic Overview...</p>
                                </div>
                            ) : videoUrl ? (
                                <video src={videoUrl} controls autoPlay loop className="w-full h-full object-cover" />
                            ) : (
                                <p className="text-red-400 font-bold">Video generation failed.</p>
                            )}
                        </div>
                    )}
                    
                    <div className="prose prose-invert max-w-none">
                        <p className="text-xl text-gray-200 leading-relaxed font-medium whitespace-pre-wrap">{overview.content}</p>
                    </div>
                    
                    {overview.type === 'audio' && (
                        <div className="mt-10 flex flex-col items-center gap-6">
                            <button 
                                onClick={togglePodcast}
                                disabled={isLoadingAudio}
                                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl border-4 ${isPlaying ? 'bg-red-600 border-red-400 animate-pulse' : 'bg-blue-600 border-blue-400'}`}
                            >
                                {isLoadingAudio ? <Loader2Icon className="w-10 h-10 animate-spin text-white"/> : isPlaying ? <StopCircleIcon className="w-12 h-12 text-white"/> : <PlayIcon className="w-12 h-12 text-white ml-2"/>}
                            </button>
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">{isPlaying ? 'Playing AI Deep Dive...' : 'Listen to Overview'}</p>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-4">
                    <button 
                        onClick={() => setIsJoining(true)}
                        className="w-full py-8 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-black text-2xl rounded-3xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-5 uppercase tracking-tighter"
                    >
                        <BotIcon className="w-10 h-10" />
                        Join The Discussion
                    </button>
                    <p className="text-center text-gray-500 font-bold px-8">Ask questions and let the AI find connections to your OTHER courses and notes.</p>
                </div>
            </div>
        </div>
    );
};

const StudyChat: React.FC<{ memories: AnyMemory[], initialContext: string }> = ({ memories, initialContext }) => {
    const [messages, setMessages] = useState<{sender: 'user'|'ai', text: string}[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, isLoading]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const q = input;
        setInput('');
        setMessages(prev => [...prev, { sender: 'user', text: q }]);
        setIsLoading(true);

        try {
            const contextPrompt = `RESEARCH CONTEXT: ${initialContext}\n\nUSER QUESTION: ${q}`;
            const response = await answerQuestionFromContext(memories, [], contextPrompt);
            setMessages(prev => [...prev, { sender: 'ai', text: response }]);
        } catch (e) {
            setMessages(prev => [...prev, { sender: 'ai', text: "Error connecting to your Second Brain." }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full p-4">
            <div ref={scrollRef} className="flex-grow overflow-y-auto space-y-4 pr-1 scrollbar-hide">
                {messages.length === 0 && (
                    <div className="py-20 text-center space-y-6">
                        <div className="bg-blue-600/20 w-32 h-32 rounded-full flex items-center justify-center mx-auto border-4 border-blue-500/30">
                            <BrainCircuitIcon className="w-16 h-16 text-blue-400" />
                        </div>
                        <div className="space-y-2">
                             <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Connection Mode</h3>
                             <p className="text-gray-400 font-bold px-10">I can see everything in your Second Brain. Ask me how these materials relate to your other courses.</p>
                        </div>
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] p-6 rounded-[2rem] text-lg font-bold shadow-xl ${m.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 border-2 border-gray-700 rounded-bl-none'}`}>
                            {m.text}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-gray-800 p-6 rounded-[2rem] border-2 border-gray-700 rounded-bl-none flex items-center gap-4">
                            <Loader2Icon className="w-6 h-6 animate-spin text-blue-500"/>
                            <span className="font-black text-xs text-blue-400 uppercase tracking-widest animate-pulse">Scanning Brain...</span>
                        </div>
                    </div>
                )}
            </div>
            <div className="mt-4 bg-gray-800 p-3 rounded-[2.5rem] flex gap-3 border-4 border-gray-700 shadow-2xl shrink-0">
                <input 
                    value={input} 
                    onChange={e => setInput(e.target.value)} 
                    onKeyPress={e => e.key === 'Enter' && handleSend()}
                    placeholder="Ask about hidden connections..." 
                    className="flex-grow bg-transparent text-white font-bold p-4 outline-none text-lg"
                />
                <button onClick={handleSend} className="p-5 bg-blue-600 text-white rounded-[1.8rem] shadow-xl active:scale-90 transition-transform">
                    <SendIcon className="w-8 h-8"/>
                </button>
            </div>
        </div>
    );
};

const SummaryFocusModal: React.FC<{
    onClose: () => void;
    onGenerate: (focus: string, type: 'written' | 'audio' | 'video' | 'research') => void;
    isGenerating: boolean;
    initialType?: 'written' | 'audio' | 'video' | 'research';
}> = ({ onClose, onGenerate, isGenerating, initialType = 'written' }) => {
    const [focus, setFocus] = useState('');
    const [type, setType] = useState<'written' | 'audio' | 'video' | 'research'>(initialType);

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-gray-800 rounded-[3rem] border-4 border-gray-700 p-8 w-full max-w-lg space-y-6 shadow-2xl">
                <div className="flex items-center gap-4 text-purple-400">
                    <PenToolIcon className="w-10 h-10" />
                    <h3 className="text-3xl font-black uppercase tracking-tighter">Study Pod</h3>
                </div>
                
                <div className="flex bg-gray-900 p-1.5 rounded-2xl border-2 border-gray-700 overflow-x-auto scrollbar-hide">
                    {['written', 'audio', 'video', 'research'].map(t => (
                        <button 
                            key={t}
                            onClick={() => setType(t as any)}
                            className={`flex-1 py-3 px-4 font-black text-[10px] uppercase rounded-xl transition-all whitespace-nowrap ${type === t ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-500'}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-4">Research Focus</label>
                    <textarea 
                        value={focus} 
                        onChange={e => setFocus(e.target.value)}
                        placeholder={type === 'research' ? "What specific connections should I look for?" : "What should I focus on?"}
                        className="w-full bg-gray-900 text-white text-xl p-6 rounded-[2rem] border-4 border-gray-700 outline-none focus:border-purple-500 shadow-inner h-40 font-bold"
                        autoFocus
                    />
                </div>

                <div className="flex gap-4">
                    <button onClick={onClose} className="flex-1 py-5 bg-gray-700 text-gray-400 font-black rounded-2xl uppercase">Cancel</button>
                    <button 
                        onClick={() => onGenerate(focus, type)} 
                        disabled={isGenerating}
                        className="flex-[2] py-5 bg-purple-600 text-white font-black rounded-2xl uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
                    >
                        {isGenerating ? <Loader2Icon className="w-6 h-6 animate-spin"/> : <BrainCircuitIcon className="w-6 h-6" />}
                        {isGenerating ? 'Synthesizing...' : 'Generate Pod'}
                    </button>
                </div>
            </div>
        </div>
    );
};

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
        } catch (e) {
            console.error("Playback error", e);
        } finally {
            setIsGenerating(false);
        }
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
                        <button onClick={onClose} className="p-3 bg-gray-700 rounded-2xl active:scale-90 transition-transform"><XIcon className="w-6 h-6 text-white" /></button>
                    </div>
                </header>

                <div className="flex-grow overflow-y-auto space-y-6 pb-6 min-h-0">
                    {memory.type === 'file' && (
                        <div className="flex flex-col items-center gap-6">
                            <div className="bg-indigo-900/30 p-10 rounded-full border-4 border-indigo-500 shadow-2xl">
                                <FileTextIcon className="w-20 h-20 text-indigo-400" />
                            </div>
                            <button onClick={toggleAudio} disabled={isGenerating} className="px-10 py-5 bg-teal-600 text-white font-black rounded-3xl text-xl shadow-xl flex items-center gap-4">
                                {isGenerating ? <Loader2Icon className="w-8 h-8 animate-spin"/> : isPlaying ? <StopCircleIcon className="w-8 h-8"/> : <Volume2Icon className="w-8 h-8"/>}
                                {isPlaying ? 'STOP READING' : 'READ SUMMARY'}
                            </button>
                            <a href={(memory as FileMemory).fileUrl} target="_blank" className="text-blue-400 font-black uppercase underline tracking-widest">Download Original</a>
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

const FilesView: React.FC<FilesViewProps> = ({ memories, onSave, onDelete, onUpdate }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'audio' | 'image' | 'doc' | 'moodle' | 'hidden'>('all');
    const [previewMemory, setPreviewMemory] = useState<AnyMemory | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [showSummaryPrompt, setShowSummaryPrompt] = useState(false);
    const [summaryInitialType, setSummaryInitialType] = useState<'written' | 'audio' | 'video' | 'research'>('written');
    const [isGeneratingMulti, setIsGeneratingMulti] = useState(false);
    const [activeStudyHub, setActiveStudyHub] = useState<{ type: any, content: string, title: string, videoUri?: string } | null>(null);

    const filteredMemories = useMemo(() => {
        let results = memories;
        if (filter === 'audio') results = results.filter(m => m.type === 'voice');
        if (filter === 'image') results = results.filter(m => m.type === 'item' || m.type === 'video');
        if (filter === 'doc') results = results.filter(m => m.type === 'document');
        if (filter === 'moodle') results = results.filter(m => m.type === 'file' && (m as FileMemory).sourceType === 'moodle');
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
        } catch (e) {
            console.error(e);
        } finally {
            setIsGeneratingMulti(false);
        }
    };

    const handleItemClick = (mem: AnyMemory) => {
        if (isSelectMode) toggleSelection(mem.id);
        else setPreviewMemory(mem);
    };

    return (
        <div className="flex flex-col h-full space-y-4 max-w-4xl mx-auto overflow-hidden">
            {previewMemory && <MediaPreviewDrawer memory={previewMemory} onUpdate={onUpdate} onClose={() => setPreviewMemory(null)} />}
            {showSummaryPrompt && <SummaryFocusModal onClose={() => setShowSummaryPrompt(false)} onGenerate={handleMultiStudy} isGenerating={isGeneratingMulti} initialType={summaryInitialType} />}
            {activeStudyHub && <StudyHubOverlay overview={activeStudyHub} memories={memories} onClose={() => setActiveStudyHub(null)} />}

            <header className="flex flex-col gap-3 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="relative flex-grow">
                        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input type="text" placeholder="SEARCH VAULT..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-800 p-4 pl-12 rounded-2xl border-2 border-gray-800 focus:border-blue-600 outline-none font-black uppercase text-xs tracking-tight shadow-inner" />
                    </div>
                    <button 
                        onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds(new Set()); }} 
                        className={`ml-3 px-6 py-4 rounded-2xl font-black text-xs uppercase border-2 transition-all ${isSelectMode ? 'bg-blue-600 text-white border-blue-400' : 'bg-gray-800 text-gray-500 border-gray-700'}`}
                    >
                        {isSelectMode ? 'CANCEL' : 'SELECT'}
                    </button>
                </div>
            </header>

            <div className="flex gap-2 overflow-x-auto pb-2 shrink-0 scrollbar-hide">
                {['all', 'audio', 'image', 'doc', 'moodle', 'hidden'].map(id => (
                    <button key={id} onClick={() => setFilter(id as any)} className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md flex-shrink-0 ${filter === id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
                        {id === 'moodle' ? 'Moodle' : id === 'hidden' ? 'Archived' : id}
                    </button>
                ))}
            </div>

            <main className="flex-grow overflow-y-auto space-y-3 pb-40 px-0.5">
                {filteredMemories.length === 0 ? (
                    <div className="text-center py-20 bg-gray-800/20 rounded-[2rem] border-4 border-dashed border-gray-700 opacity-50">
                        <FolderIcon className="w-16 h-16 mx-auto text-gray-700 mb-4" />
                        <p className="text-xs text-gray-600 font-black uppercase tracking-widest">Vault Empty</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3.5">
                        {filteredMemories.map(mem => (
                            <div 
                                key={mem.id} 
                                onClick={() => handleItemClick(mem)} 
                                className={`bg-gray-800/60 p-4 rounded-[2rem] border-4 flex flex-col gap-3 shadow-xl active:scale-95 transition-all cursor-pointer relative ${selectedIds.has(mem.id) ? 'border-blue-500' : 'border-gray-700'}`}
                            >
                                {isSelectMode && (
                                    <div className={`absolute top-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedIds.has(mem.id) ? 'bg-blue-600 border-blue-400' : 'border-gray-900 border-gray-600'}`}>
                                        {selectedIds.has(mem.id) && <CheckIcon className="w-4 h-4 text-white" />}
                                    </div>
                                )}
                                <div className="p-4 bg-gray-900 rounded-2xl w-fit">
                                    {mem.type === 'file' ? <FileTextIcon className="w-6 h-6 text-indigo-400"/> : 
                                     mem.type === 'voice' ? <MicIcon className="w-6 h-6 text-blue-400"/> :
                                     <CameraIcon className="w-6 h-6 text-purple-400"/>}
                                </div>
                                <div className="overflow-hidden">
                                    <h3 className="text-sm font-black text-white truncate uppercase tracking-tight">{mem.title}</h3>
                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{mem.course || 'Personal'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {isSelectMode && selectedIds.size > 0 && (
                <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm flex gap-3 animate-slide-up">
                    <button 
                        onClick={() => {
                            setSummaryInitialType('written');
                            setShowSummaryPrompt(true);
                        }}
                        className="flex-1 bg-purple-600 text-white font-black py-5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 uppercase text-xs"
                    >
                        <PenToolIcon className="w-6 h-6" /> Study Pod
                    </button>
                    <button 
                        onClick={() => {
                            setSummaryInitialType('research');
                            setShowSummaryPrompt(true);
                        }}
                        className="flex-1 bg-blue-600 text-white font-black py-5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 uppercase text-xs"
                    >
                        <BrainCircuitIcon className="w-6 h-6" /> Deep Recall
                    </button>
                </div>
            )}
        </div>
    );
};

export default FilesView;
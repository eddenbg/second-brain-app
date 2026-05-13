import React, { useState, useEffect, useRef } from 'react';
import type { AnyMemory } from '../types';
import {
    XIcon, ArrowLeftIcon, Loader2Icon, PlayIcon, StopCircleIcon,
    Volume2Icon, VideoIcon, BrainCircuitIcon, BotIcon, SendIcon, PenToolIcon
} from './Icons';
import { generateSpeechFromText, answerQuestionFromContext, checkVideoStatus } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';

// ── Study Chat ────────────────────────────────────────────────────────────────────────────────
export const StudyChat: React.FC<{ memories: AnyMemory[]; initialContext: string }> = ({ memories, initialContext }) => {
    const [messages, setMessages] = useState<{ sender: 'user' | 'ai'; text: string }[]>([]);
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
        } catch {
            setMessages(prev => [...prev, { sender: 'ai', text: 'Error connecting to your Second Brain.' }]);
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
                            <p className="text-gray-400 font-bold px-10">Ask me how these materials relate to your other courses and notes.</p>
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
                            <Loader2Icon className="w-6 h-6 animate-spin text-blue-500" />
                            <span className="font-black text-xs text-blue-400 uppercase tracking-widest animate-pulse">Scanning Brain...</span>
                        </div>
                    </div>
                )}
            </div>
            <div className="mt-4 bg-gray-800 p-3 rounded-[2.5rem] flex gap-3 border-4 border-gray-700 shadow-2xl shrink-0">
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Ask about hidden connections..."
                    className="flex-grow bg-transparent text-white font-bold p-4 outline-none text-lg"
                />
                <button onClick={handleSend} className="p-5 bg-blue-600 text-white rounded-[1.8rem] shadow-xl active:scale-90 transition-transform">
                    <SendIcon className="w-8 h-8" />
                </button>
            </div>
        </div>
    );
};

// ── Study Hub Overlay ─────────────────────────────────────────────────────────────────
export const StudyHubOverlay: React.FC<{
    overview: { type: 'written' | 'audio' | 'video' | 'research'; content: string; title: string; videoUri?: string };
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
                    <button onClick={onClose} className="p-3 bg-gray-800 rounded-xl">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
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
                            {overview.type === 'audio'
                                ? <Volume2Icon className="w-10 h-10 text-white" />
                                : <VideoIcon className="w-10 h-10 text-white" />}
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">{overview.title}</h2>
                            <p className="text-purple-400 font-bold uppercase text-xs tracking-widest">{overview.type} STUDY POD</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-4 bg-gray-800 rounded-2xl">
                        <XIcon className="w-8 h-8 text-white" />
                    </button>
                </header>

                <div className="bg-gray-800 rounded-[3rem] border-4 border-gray-700 p-8 shadow-2xl">
                    {overview.type === 'video' && (
                        <div className="mb-8 rounded-2xl overflow-hidden border-4 border-gray-700 shadow-2xl aspect-video bg-black flex items-center justify-center">
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
                    <p className="text-xl text-gray-200 leading-relaxed font-medium whitespace-pre-wrap">{overview.content}</p>
                    {overview.type === 'audio' && (
                        <div className="mt-10 flex flex-col items-center gap-6">
                            <button
                                onClick={togglePodcast}
                                disabled={isLoadingAudio}
                                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl border-4 ${isPlaying ? 'bg-red-600 border-red-400 animate-pulse' : 'bg-blue-600 border-blue-400'}`}
                            >
                                {isLoadingAudio
                                    ? <Loader2Icon className="w-10 h-10 animate-spin text-white" />
                                    : isPlaying
                                        ? <StopCircleIcon className="w-12 h-12 text-white" />
                                        : <PlayIcon className="w-12 h-12 text-white ml-2" />}
                            </button>
                            <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">
                                {isPlaying ? 'Playing AI Deep Dive...' : 'Listen to Overview'}
                            </p>
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
                    <p className="text-center text-gray-500 font-bold px-8">Ask questions and let the AI find connections to your other courses and notes.</p>
                </div>
            </div>
        </div>
    );
};

// ── Summary Focus Modal ────────────────────────────────────────────────────────────────────
export const SummaryFocusModal: React.FC<{
    onClose: () => void;
    onGenerate: (focus: string, type: 'written' | 'audio' | 'video' | 'research') => void;
    isGenerating: boolean;
    initialType?: 'written' | 'audio' | 'video' | 'research';
    defaultFocus?: string;
}> = ({ onClose, onGenerate, isGenerating, initialType = 'written', defaultFocus = '' }) => {
    const [focus, setFocus] = useState(defaultFocus);
    const [type, setType] = useState<'written' | 'audio' | 'video' | 'research'>(initialType);

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-gray-800 rounded-[3rem] border-4 border-gray-700 p-8 w-full max-w-lg space-y-6 shadow-2xl">
                <div className="flex items-center gap-4 text-purple-400">
                    <PenToolIcon className="w-10 h-10" />
                    <h3 className="text-3xl font-black uppercase tracking-tighter">Study Pod</h3>
                </div>

                <div className="flex bg-gray-900 p-1.5 rounded-2xl border-2 border-gray-700 overflow-x-auto scrollbar-hide">
                    {(['written', 'audio', 'video', 'research'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setType(t)}
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
                        placeholder={type === 'research' ? 'What specific connections should I look for?' : 'What should I focus on?'}
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
                        {isGenerating
                            ? <Loader2Icon className="w-6 h-6 animate-spin" />
                            : <BrainCircuitIcon className="w-6 h-6" />}
                        {isGenerating ? 'Synthesizing...' : 'Generate Pod'}
                    </button>
                </div>
            </div>
        </div>
    );
};

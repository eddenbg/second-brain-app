import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Loader2, Sparkles, ArrowRight, RotateCcw, Volume2, Square, AlertCircle } from 'lucide-react';
import type { AnyMemory } from '../types';
import { getGeminiInstance } from '../services/geminiService';
import { searchMemories } from '../utils/SearchLogic';
import { startDictation } from '../utils/dictation';
import type { DictationSession } from '../utils/dictation';

export interface AskAIMessage {
    role: 'user' | 'ai';
    content: string;
    links?: { title: string; id: string; type: string }[];
}
type Message = AskAIMessage;

export const ASK_AI_GREETING: AskAIMessage = {
    role: 'ai',
    content: 'שלום! / Hello! Ask me anything about your notes, courses, recordings, or files. I can see everything across all your tabs.'
};

interface AskAIViewProps {
    memories: AnyMemory[];
    // Conversation state lives in App so it survives tab switches
    messages: AskAIMessage[];
    setMessages: React.Dispatch<React.SetStateAction<AskAIMessage[]>>;
    restoredFromEarlier?: boolean;
    onNewConversation: () => void;
}

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

const AskAIView: React.FC<AskAIViewProps> = ({ memories, messages, setMessages, restoredFromEarlier, onNewConversation }) => {
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Read-aloud for AI responses (Web Speech API). One message at a time.
    const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
    const [speechState, setSpeechState] = useState<'loading' | 'speaking' | 'error' | null>(null);
    const speechRunRef = useRef(0);
    const speechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearSpeechTimer = () => {
        if (speechTimerRef.current) {
            clearTimeout(speechTimerRef.current);
            speechTimerRef.current = null;
        }
    };

    const stopSpeaking = useCallback(() => {
        speechRunRef.current++;
        clearSpeechTimer();
        try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
        setSpeakingIndex(null);
        setSpeechState(null);
    }, []);

    useEffect(() => () => {
        speechRunRef.current++;
        clearSpeechTimer();
        try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
    }, []);

    const toggleSpeak = (index: number, text: string) => {
        if (speakingIndex === index && (speechState === 'loading' || speechState === 'speaking')) {
            stopSpeaking();
            return;
        }
        const synth = window.speechSynthesis;
        const run = ++speechRunRef.current;
        clearSpeechTimer();
        setSpeakingIndex(index);
        if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
            setSpeechState('error');
            return;
        }
        // Stop anything already playing before starting
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = /[\u0590-\u05FF]/.test(text) ? 'he-IL' : 'en-US';
        utterance.onstart = () => {
            if (run !== speechRunRef.current) return;
            clearSpeechTimer();
            setSpeechState('speaking');
        };
        utterance.onend = () => {
            if (run !== speechRunRef.current) return;
            clearSpeechTimer();
            setSpeakingIndex(null);
            setSpeechState(null);
        };
        utterance.onerror = (e) => {
            if (run !== speechRunRef.current) return;
            clearSpeechTimer();
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            setSpeechState('error');
        };
        // If speech hasn't started within 30 seconds, give up and show an error
        speechTimerRef.current = setTimeout(() => {
            if (run !== speechRunRef.current) return;
            speechRunRef.current++;
            synth.cancel();
            setSpeechState('error');
        }, 30_000);

        setSpeechState('loading');
        synth.speak(utterance);
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    // Build full RAG context from all memories, organized by tab
    const buildContext = useCallback(() => {
        if (memories.length === 0) return 'No memories saved yet.';

        const formatMemory = (m: AnyMemory): string => {
            const content: string =
                'transcript' in m ? (m as any).transcript :
                'extractedText' in m ? (m as any).extractedText :
                'content' in m ? (m as any).content :
                'description' in m ? (m as any).description :
                'summary' in m ? (m as any).summary : '';
            const snippet = content ? content.slice(0, 600) : '';
            const date = new Date(m.date).toLocaleDateString();
            return `[${m.type.toUpperCase()}] "${m.title}" (${date})${snippet ? ': ' + snippet : ''}`;
        };

        const personal = memories.filter(m => m.category === 'personal').slice(0, 60);
        const college = memories.filter(m => m.category === 'college').slice(0, 60);

        const sections: string[] = [];
        if (personal.length > 0) {
            sections.push(`=== PERSONAL HUB (${personal.length} items) ===\n${personal.map(formatMemory).join('\n')}`);
        }
        if (college.length > 0) {
            sections.push(`=== COLLEGE HUB (${college.length} items) ===\n${college.map(formatMemory).join('\n')}`);
        }

        return sections.join('\n\n');
    }, [memories]);

    const handleSend = async (text?: string) => {
        const query = (text || input).trim();
        if (!query || isTyping) return;

        setMessages(prev => [...prev, { role: 'user', content: query }]);
        setInput('');
        setIsTyping(true);

        try {
            const context = buildContext();
            // Keyword search for source links shown below the answer
            const sources = searchMemories(query, memories, []).slice(0, 3);

            const ai = getGeminiInstance();
            if (!ai) throw new Error('AI not configured');

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `You are a personal AI assistant for a student. You have full access to their Second Brain — notes, recordings, documents, and files from all tabs.

IMPORTANT RULES:
- Detect the language of the user's question and ALWAYS reply in that same language. Hebrew question → Hebrew answer. English question → English answer.
- Answer based on the context below. Cite sources by mentioning their title in parentheses.
- If the context doesn't contain the answer, say so clearly and suggest they might want to add a note about it.
- Be concise and helpful.

SECOND BRAIN CONTENTS:
${context || 'No memories saved yet.'}

USER QUESTION: ${query}`,
            });

            const aiMsg: Message = {
                role: 'ai',
                content: response.text || 'No relevant information found. / לא נמצא מידע רלוונטי.',
                links: sources.map(r => ({
                    title: (r.item as AnyMemory).title,
                    id: (r.item as AnyMemory).id,
                    type: (r.item as AnyMemory).type
                }))
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (error) {
            console.error(error);
            setMessages(prev => [
                ...prev,
                { role: 'ai', content: 'Sorry, I had trouble connecting. Please try again. / מצטער, הייתה בעיה. נסה שוב.' }
            ]);
        } finally {
            setIsTyping(false);
        }
    };

    // Voice questions use the same Gemini transcription as voice notes
    // (Hebrew, English, and switching mid-sentence). Tap to start, tap to stop;
    // the question is sent automatically when you stop.
    const dictationRef = useRef<DictationSession | null>(null);
    // Always call the latest handleSend (it reads current memories)
    const handleSendRef = useRef(handleSend);
    handleSendRef.current = handleSend;
    const [isConnectingVoice, setIsConnectingVoice] = useState(false);

    const startListening = useCallback(() => {
        setVoiceError(null);
        setInput('');
        let spoken = '';
        const session = startDictation({
            onText: (delta) => {
                if (dictationRef.current !== session) return;
                spoken += delta;
                setInput(spoken.replace(/^\s+/, ''));
            },
            onStatus: (status, err) => {
                if (dictationRef.current !== session) return;
                setIsConnectingVoice(status === 'connecting' || status === 'stopping');
                setIsListening(status === 'connecting' || status === 'listening');
                if (status === 'error') setVoiceError(err || 'Voice input failed. Try again.');
                if (status === 'idle') {
                    dictationRef.current = null;
                    const question = spoken.trim();
                    if (question) handleSendRef.current(question);
                }
            },
        });
        dictationRef.current = session;
    }, []);

    const stopListening = useCallback(() => {
        void dictationRef.current?.stop();
    }, []);

    useEffect(() => () => { void dictationRef.current?.stop(false); }, []);

    return (
        <div className="flex flex-col h-full gap-4" style={{ height: 'calc(100vh - 220px)' }}>
            {/* Memory count indicator + new conversation */}
            <div className="flex-shrink-0 flex items-center gap-2 px-1">
                {memories.length > 0 && (
                    <>
                        <Sparkles size={12} className="text-white/40" strokeWidth={3} />
                        <span className="text-[10px] text-white/40 font-black uppercase tracking-widest">
                            {memories.length} memories indexed across all tabs
                        </span>
                    </>
                )}
                {messages.length > 1 && (
                    <button
                        onClick={() => { stopSpeaking(); onNewConversation(); }}
                        disabled={isTyping}
                        aria-label="Start a new conversation"
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-white/20 text-white/70 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                        style={{ minHeight: 'unset' }}
                    >
                        <RotateCcw size={12} strokeWidth={3} />
                        New Conversation
                    </button>
                )}
            </div>
            {restoredFromEarlier && messages.length > 1 && (
                <p className="flex-shrink-0 text-center text-[10px] text-white/40 font-black uppercase tracking-widest">
                    Conversation from earlier
                </p>
            )}

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-grow overflow-y-auto flex flex-col gap-5 px-2 scrollbar-hide">
                {messages.map((msg, i) => (
                    <div key={i} className={`flex flex-col gap-3 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {msg.role === 'ai' && (
                            <div className="flex items-center gap-2 text-white/50 text-sm">
                                <Sparkles size={16} strokeWidth={3} />
                                <span className="font-black uppercase tracking-widest text-xs">Second Brain AI</span>
                            </div>
                        )}
                        <div className={`max-w-[88%] p-5 rounded-3xl border-3 ${
                            msg.role === 'user'
                                ? 'bg-white text-[#001F3F] border-white'
                                : 'bg-white/5 text-white border-white/20'
                        }`}>
                            <p className="text-xl font-bold leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            {msg.role === 'ai' && (() => {
                                const state = speakingIndex === i ? speechState : null;
                                return (
                                    <div className="flex justify-end mt-2 -mb-2 -mr-2">
                                        <button
                                            onClick={() => toggleSpeak(i, msg.content)}
                                            aria-label={state === 'speaking' || state === 'loading' ? 'Stop reading' : state === 'error' ? 'Could not start audio. Tap to try again' : 'Read response aloud'}
                                            title={state === 'error' ? 'Could not start audio. Try again.' : undefined}
                                            className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 active:scale-90 transition-transform ${
                                                state === 'error' ? 'border-red-400 text-red-400' : 'border-white/20 text-white/70'
                                            }`}
                                            style={{ minHeight: 'unset' }}
                                        >
                                            {state === 'loading' ? <Loader2 size={18} strokeWidth={3} className="animate-spin" /> :
                                             state === 'speaking' ? <Square size={16} strokeWidth={3} fill="currentColor" /> :
                                             state === 'error' ? <AlertCircle size={18} strokeWidth={3} /> :
                                             <Volume2 size={18} strokeWidth={3} />}
                                        </button>
                                    </div>
                                );
                            })()}
                        </div>

                        {msg.links && msg.links.length > 0 && (
                            <div className="flex flex-col gap-2 w-full max-w-[88%]">
                                <p className="text-xs uppercase tracking-widest text-white/50 font-black pl-2">Sources:</p>
                                {msg.links.map(link => (
                                    <button
                                        key={link.id}
                                        className="h-14 flex items-center justify-between px-5 border-2 border-white/20 rounded-2xl text-white bg-white/5"
                                        aria-label={`Source: ${link.title}`}
                                    >
                                        <span className="truncate text-base font-bold">{link.title}</span>
                                        <ArrowRight size={20} strokeWidth={3} className="flex-shrink-0 ml-2" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {isTyping && (
                    <div className="flex items-center gap-3 text-white/70 pl-2">
                        <Loader2 className="animate-spin" size={28} strokeWidth={3} />
                        <span className="font-black uppercase tracking-widest text-sm">Searching memories…</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="flex-shrink-0 flex flex-col gap-3 pt-3 border-t-3 border-white/20">
                {voiceError && (
                    <p className="text-center text-sm text-red-400 font-bold bg-red-900/20 px-4 py-2 rounded-xl">
                        {voiceError}
                    </p>
                )}

                <div className="flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask anything… שאל כל דבר…"
                        disabled={isListening}
                        className="flex-grow border-white text-white"
                        dir="auto"
                    />
                    <button
                        onClick={() => handleSend()}
                        className="btn-primary w-20 bg-white text-[#001F3F]"
                        disabled={isTyping || !input.trim()}
                        aria-label="Send"
                    >
                        <Send size={32} strokeWidth={3} />
                    </button>
                </div>

                <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={isTyping || (isConnectingVoice && !isListening)}
                    aria-label={isListening ? 'Stop listening' : 'Speak your question'}
                    className={`w-full h-20 flex items-center justify-center gap-4 rounded-2xl font-black text-xl uppercase transition-all ${
                        isListening
                            ? 'bg-red-600 text-white animate-pulse border-red-400'
                            : 'bg-white text-[#001F3F] border-white'
                    }`}
                >
                    {isConnectingVoice && !isListening
                        ? <><Loader2 size={40} strokeWidth={3} className="animate-spin" /> Finishing…</>
                        : isListening
                            ? <><MicOff size={40} strokeWidth={3} /> Stop Listening</>
                            : <><Mic size={40} strokeWidth={3} /> Tap to Speak</>
                    }
                </button>
            </div>
        </div>
    );
};

export default AskAIView;

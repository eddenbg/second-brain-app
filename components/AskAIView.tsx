
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import type { AnyMemory } from '../types';
import { searchMemories } from '../utils/SearchLogic';

interface AskAIViewProps {
    memories: AnyMemory[];
}

interface Message {
    role: 'user' | 'ai';
    content: string;
    links?: { title: string; id: string; type: string }[];
}

// Web Speech API type augmentation
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

const AskAIView: React.FC<AskAIViewProps> = ({ memories }) => {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'ai',
            content: 'שלום! / Hello! Ask me anything about your notes, courses, or personal thoughts. I will answer in the language you speak to me.'
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    // Build context string from top memory search results
    const buildContext = useCallback((query: string) => {
        const results = searchMemories(query, memories, []);
        return results.slice(0, 6).map(r => {
            const m = r.item as AnyMemory;
            const text = 'transcript' in m
                ? (m as any).transcript
                : 'extractedText' in m
                ? (m as any).extractedText
                : 'content' in m
                ? (m as any).content
                : '';
            return `[${m.type.toUpperCase()} – ${m.title}]: ${text || m.title}`;
        }).join('\n---\n');
    }, [memories]);

    const handleSend = async (text?: string) => {
        const query = (text || input).trim();
        if (!query || isTyping) return;

        setMessages(prev => [...prev, { role: 'user', content: query }]);
        setInput('');
        setIsTyping(true);

        try {
            const context = buildContext(query);
            const results = searchMemories(query, memories, []);

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `You are a personal AI assistant for a visually impaired student.
Your job is to answer questions using ONLY the context below from their "Second Brain".

IMPORTANT LANGUAGE RULE: Detect the language of the user question and ALWAYS respond in that same language. If the question is in Hebrew, answer fully in Hebrew. If in English, answer in English. Support mixed Hebrew-English naturally.

When you give an answer, cite which source(s) it came from by mentioning the title in parentheses.
If the context does not contain the answer, say so clearly and suggest the user might want to add a note about it.

CONTEXT FROM SECOND BRAIN:
${context || 'No relevant notes found.'}

USER QUESTION: ${query}`,
            });

            const aiMsg: Message = {
                role: 'ai',
                content: response.text || 'לא מצאתי מידע רלוונטי. / No relevant information found.',
                links: results.slice(0, 3).map(r => ({
                    title: r.item.title,
                    id: r.item.id,
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

    const startListening = useCallback(() => {
        setVoiceError(null);
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setVoiceError('Voice input not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;

        // Support Hebrew and English together
        recognition.lang = 'iw-IL';
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);

        recognition.onresult = (event: any) => {
            const transcript = Array.from(event.results as any[])
                .map((r: any) => r[0].transcript)
                .join('');
            setInput(transcript);
        };

        recognition.onend = () => {
            setIsListening(false);
            // Auto-send if there's something in the input
            setInput(prev => {
                if (prev.trim()) {
                    // Delay slightly so state settles
                    setTimeout(() => handleSend(prev), 100);
                }
                return prev;
            });
        };

        recognition.onerror = (event: any) => {
            setIsListening(false);
            if (event.error !== 'no-speech') {
                setVoiceError(`Voice error: ${event.error}`);
            }
        };

        recognition.start();
    }, []);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        setIsListening(false);
    }, []);

    return (
        <div className="flex flex-col h-full gap-4" style={{ height: 'calc(100vh - 220px)' }}>
            {/* Chat Area */}
            <div
                ref={scrollRef}
                className="flex-grow overflow-y-auto flex flex-col gap-5 px-2 scrollbar-hide"
            >
                {messages.map((msg, i) => (
                    <div
                        key={i}
                        className={`flex flex-col gap-3 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
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

                {/* Voice Button */}
                <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={isTyping}
                    aria-label={isListening ? 'Stop listening' : 'Speak your question'}
                    className={`w-full h-20 flex items-center justify-center gap-4 rounded-2xl font-black text-xl uppercase transition-all ${
                        isListening
                            ? 'bg-red-600 text-white animate-pulse border-red-400'
                            : 'bg-white text-[#001F3F] border-white'
                    }`}
                >
                    {isListening
                        ? <><MicOff size={40} strokeWidth={3} /> Stop Listening</>
                        : <><Mic size={40} strokeWidth={3} /> Tap to Speak</>
                    }
                </button>
            </div>
        </div>
    );
};

export default AskAIView;

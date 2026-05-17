import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Send, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import type { AnyMemory } from '../types';
import { getGeminiInstance } from '../services/geminiService';
import { searchMemories } from '../utils/SearchLogic';

interface AskAIViewProps {
    memories: AnyMemory[];
}

interface Message {
    role: 'user' | 'ai';
    content: string;
    links?: { title: string; id: string; type: string }[];
}

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
            content: 'שלום! / Hello! Ask me anything about your notes, courses, recordings, or files. I can see everything across all your tabs.'
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
                contents: `You are a personal AI assistant for a student. You have full access to their Second Brain — notes, recordings, documents, and files from all tabs.\n\nIMPORTANT RULES:\n- Detect the language of the user's question and ALWAYS reply in that same language. Hebrew question → Hebrew answer. English question → English answer.\n- Answer based on the context below. Cite sources by mentioning their title in parentheses.\n- If the context doesn't contain the answer, say so clearly and suggest they might want to add a note about it.\n- Be concise and helpful.\n\nSECOND BRAIN CONTENTS:\n${context || 'No memories saved yet.'}\n\nUSER QUESTION: ${query}`,
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

    const startListening = useCallback(() => {
        setVoiceError(null);
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setVoiceError('Voice input not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
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
            setInput(prev => {
                if (prev.trim()) setTimeout(() => handleSend(prev), 100);
                return prev;
            });
        };

        recognition.onerror = (event: any) => {
            setIsListening(false);
            if (event.error !== 'no-speech') setVoiceError(`Voice error: ${event.error}`);
        };

        recognition.start();
    }, []);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        setIsListening(false);
    }, []);

    return (
        <div className="flex flex-col h-full gap-4" style={{ height: 'calc(100vh - 220px)' }}>
            {/* Memory count indicator */}
            {memories.length > 0 && (
                <div className="flex-shrink-0 flex items-center gap-2 px-1">
                    <Sparkles size={12} className="text-white/40" strokeWidth={3} />
                    <span className="text-[10px] text-white/40 font-black uppercase tracking-widest">
                        {memories.length} memories indexed across all tabs
                    </span>
                </div>
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

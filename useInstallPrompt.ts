
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, Loader2, Brain, ArrowRight } from 'lucide-react';
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

const AskAIView: React.FC<AskAIViewProps> = ({ memories }) => {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'ai', content: 'Hello! I am your Second Brain. Ask me anything about your courses or personal thoughts.' }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async (text?: string) => {
        const query = text || input;
        if (!query.trim()) return;

        const userMsg: Message = { role: 'user', content: query };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        try {
            // 1. Search memories
            const searchResults = searchMemories(query, memories, []);
            const context = searchResults.slice(0, 5).map(r => {
                const m = r.item as AnyMemory;
                return `[${m.type}] ${m.title}: ${'transcript' in m ? m.transcript : ('extractedText' in m ? (m as any).extractedText : '')}`;
            }).join('\n---\n');

            // 2. Call Gemini
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: `
                    System: You are a memory aid for a user with memory impairment. 
                    Use the following context from their "Second Brain" to answer their question.
                    Be concise, encouraging, and clear.
                    
                    Context:
                    ${context}
                    
                    User Question: ${query}
                `,
            });

            const aiMsg: Message = { 
                role: 'ai', 
                content: response.text || "I couldn't find a clear answer, but here are some related items.",
                links: searchResults.slice(0, 3).map(r => ({ 
                    title: r.item.title, 
                    id: r.item.id, 
                    type: r.type 
                }))
            };
            setMessages(prev => [...prev, aiMsg]);
        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, { role: 'ai', content: "Sorry, I had trouble connecting to your memories." }]);
        } finally {
            setIsTyping(false);
        }
    };

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Chat Area */}
            <div 
                ref={scrollRef}
                className="flex-grow overflow-y-auto flex flex-col gap-6 p-4 scrollbar-hide"
            >
                {messages.map((msg, i) => (
                    <div 
                        key={i} 
                        className={`flex flex-col gap-3 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                        <div className={`max-w-[85%] p-6 rounded-3xl border-3 ${
                            msg.role === 'user' 
                            ? 'bg-[#60A5FA] text-[#020617] border-[#60A5FA]' 
                            : 'bg-[#020617] text-white border-[#60A5FA]/30'
                        }`}>
                            <p className="text-xl font-bold leading-relaxed">{msg.content}</p>
                        </div>
                        
                        {msg.links && msg.links.length > 0 && (
                            <div className="flex flex-col gap-2 w-full max-w-[85%]">
                                <p className="text-xs uppercase tracking-widest text-[#60A5FA] font-black">Related Memories:</p>
                                {msg.links.map(link => (
                                    <button 
                                        key={link.id}
                                        className="btn-outline h-16 flex items-center justify-between px-6"
                                        onClick={() => {
                                            // In a real app, this would trigger a navigation event
                                            alert(`Opening ${link.title}`);
                                        }}
                                    >
                                        <span className="truncate text-lg">{link.title}</span>
                                        <ArrowRight size={24} strokeWidth={3} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {isTyping && (
                    <div className="flex items-center gap-2 text-[#60A5FA]">
                        <Loader2 className="animate-spin" size={32} strokeWidth={3} />
                        <span className="font-black uppercase tracking-widest">Searching Memories...</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="flex flex-col gap-4 p-4 bg-[#020617] border-t-3 border-[#60A5FA]/20">
                <div className="flex gap-4">
                    <input 
                        type="text" 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask your brain..."
                        className="flex-grow"
                    />
                    <button 
                        onClick={() => handleSend()}
                        className="btn-primary w-24"
                        disabled={isTyping}
                    >
                        <Send size={40} strokeWidth={3} />
                    </button>
                </div>
                
                <button 
                    className="btn-primary h-24 flex items-center justify-center gap-4 bg-[#60A5FA] text-[#020617]"
                    aria-label="Tap to Speak"
                >
                    <Mic size={48} strokeWidth={3} />
                    <span className="text-2xl font-black uppercase">Tap to Speak</span>
                </button>
            </div>
        </div>
    );
};

export default AskAIView;

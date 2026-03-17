
import React, { useState, useRef, useEffect } from 'react';
import { answerQuestionFromContext, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { SendIcon, UserIcon, BotIcon, MicIcon, Volume2Icon, StopCircleIcon, Loader2Icon, BrainCircuitIcon, CalendarIcon } from './Icons';
import type { AnyMemory, Task, CalendarEvent } from '../types';
import { Modality, Session } from '@google/genai';
import { getGeminiInstance } from '../utils/gemini';

interface QASessionProps {
  memories: AnyMemory[];
  tasks?: Task[];
  calendarEvents?: CalendarEvent[];
  onAddCalendarEvent?: (event: CalendarEvent) => void;
}

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
}

const QASession: React.FC<QASessionProps> = ({ memories, tasks = [], calendarEvents = [], onAddCalendarEvent }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  const ttsAudioContextRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleToolCall = async (call: any) => {
    if (call.name === 'createCalendarEvent' && onAddCalendarEvent) {
        const newEvent: CalendarEvent = {
            id: Date.now().toString(),
            title: call.args.title,
            startTime: call.args.startTime,
            endTime: call.args.endTime,
            category: call.args.category,
            description: call.args.description
        };
        onAddCalendarEvent(newEvent);
        return { status: "success", message: `Scheduled ${call.args.title}` };
    }
    return { status: "error", message: "Tool not handled" };
  };

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setIsLoading(true);

    try {
      const aiResponse = await answerQuestionFromContext(memories, tasks, userMsg.text, calendarEvents, handleToolCall);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), sender: 'ai', text: aiResponse };
      setMessages(prev => [...prev, aiMsg]);
      
      // Auto-read AI response for accessibility
      handleReadResponse(aiMsg);
    } catch (error) {
      setMessages(prev => [...prev, { id: 'err', sender: 'ai', text: 'Error talking to AI.' }]);
    } finally {
      setIsLoading(true);
      setIsLoading(false);
    }
  };

  const handleReadResponse = async (msg: Message) => {
      if (playingMessageId === msg.id) {
          ttsSourceRef.current?.stop();
          setPlayingMessageId(null);
          return;
      }
      try {
        if (!ttsAudioContextRef.current) ttsAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
        const audioB64 = await generateSpeechFromText(msg.text);
        if (audioB64) {
            const buffer = await decodeAudioData(decode(audioB64), ttsAudioContextRef.current, 24000, 1);
            const source = ttsAudioContextRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(ttsAudioContextRef.current.destination);
            source.onended = () => setPlayingMessageId(null);
            source.start(0);
            ttsSourceRef.current = source;
            setPlayingMessageId(msg.id);
        }
      } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col h-full bg-[#001f3f] overflow-hidden">
      <div className="flex-grow p-8 overflow-y-auto space-y-8 scrollbar-hide">
        {messages.length === 0 && (
            <div className="text-center py-24 opacity-30">
                <BrainCircuitIcon className="w-24 h-24 mx-auto mb-6 text-yellow-500" />
                <p className="text-3xl font-black text-white uppercase tracking-tighter">Ask me to schedule a task or search your notes.</p>
            </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-6 rounded-[2.5rem] shadow-2xl ${msg.sender === 'user' ? 'bg-yellow-500 text-[#001f3f] rounded-br-none' : 'bg-white/10 text-white border-4 border-white/10 rounded-bl-none'}`}>
              <p className="text-2xl font-black leading-tight tracking-tight">{msg.text}</p>
              {msg.sender === 'ai' && (
                  <button 
                    onClick={() => handleReadResponse(msg)} 
                    aria-label={playingMessageId === msg.id ? "Stop reading" : "Read response aloud"}
                    className="mt-6 p-4 bg-white/10 rounded-2xl text-yellow-500 hover:bg-white/20 transition-colors"
                  >
                      {playingMessageId === msg.id ? <StopCircleIcon className="w-10 h-10"/> : <Volume2Icon className="w-10 h-10"/>}
                  </button>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="p-8 border-t-8 border-black/20 bg-black/10">
        <div className="flex gap-4 bg-white/5 p-4 rounded-[3rem] border-4 border-white/10 focus-within:border-yellow-500 transition-all shadow-2xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type or use mic..."
            aria-label="Ask a question"
            className="flex-grow bg-transparent text-white text-2xl p-4 focus:outline-none font-black placeholder:text-white/20"
          />
          <button 
            onClick={handleSend} 
            aria-label="Send message"
            className="p-6 bg-yellow-500 text-[#001f3f] rounded-[2rem] hover:bg-yellow-600 transition-all active:scale-90 shadow-xl"
          >
            <SendIcon className="w-10 h-10" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default QASession;

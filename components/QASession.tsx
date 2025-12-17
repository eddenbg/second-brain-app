
import React, { useState, useRef, useEffect } from 'react';
import { answerQuestionFromContext, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { SendIcon, UserIcon, BotIcon, MicIcon, Volume2Icon, StopCircleIcon, Loader2Icon } from './Icons';
import type { AnyMemory, Task } from '../types';
import { Modality, LiveSession } from '@google/genai';
import { getGeminiInstance } from '../utils/gemini';

interface QASessionProps {
  memories: AnyMemory[];
  tasks?: Task[]; // Now optional/included
}

interface Message {
  id: string; // Unique ID for key/tracking
  sender: 'user' | 'ai';
  text: string;
}

const QASession: React.FC<QASessionProps> = ({ memories, tasks = [] }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Voice Input State
  const [isListening, setIsListening] = useState(false);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Voice Output State
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const ttsAudioContextRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
        stopListening();
        if (ttsSourceRef.current) ttsSourceRef.current.stop();
        if (ttsAudioContextRef.current) ttsAudioContextRef.current.close();
    };
  }, []);

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = { id: Date.now().toString(), sender: 'user', text: query };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsLoading(true);

    try {
      const aiResponse = await answerQuestionFromContext(memories, tasks, userMessage.text);
      const aiMessage: Message = { id: (Date.now() + 1).toString(), sender: 'ai', text: aiResponse };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage: Message = { id: (Date.now() + 1).toString(), sender: 'ai', text: 'Sorry, something went wrong.' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Voice Input Logic ---
  const startListening = async () => {
    const ai = getGeminiInstance();
    if (!ai) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = context;
        const actualSampleRate = context.sampleRate;
        
        setIsListening(true);
        setQuery(''); // Clear previous text

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
              onopen: () => {
                const source = context.createMediaStreamSource(stream);
                const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
                scriptProcessor.onaudioprocess = (e) => {
                  const inputData = e.inputBuffer.getChannelData(0);
                  const int16 = new Int16Array(inputData.length);
                  for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                  let binary = '';
                  const bytes = new Uint8Array(int16.buffer);
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: { data: btoa(binary), mimeType: `audio/pcm;rate=${actualSampleRate}` } }));
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(context.destination);
              },
              onmessage: (message) => {
                if (message.serverContent?.inputTranscription) {
                  const text = message.serverContent.inputTranscription.text;
                  setQuery(prev => prev + text);
                }
              },
              onerror: (e) => { 
                  console.error(e); 
                  stopListening(); 
              },
              onclose: () => {},
            },
            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {} },
        });

    } catch (err) {
        console.error("Mic access failed", err);
        setIsListening(false);
    }
  };

  const stopListening = async () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      audioContextRef.current?.close();
      if (sessionPromiseRef.current) {
          const session = await sessionPromiseRef.current;
          session.close();
      }
      setIsListening(false);
  };

  const toggleListening = () => {
      if (isListening) stopListening();
      else startListening();
  };

  // --- Text to Speech Logic ---
  const handleReadResponse = async (msg: Message) => {
      if (playingMessageId === msg.id) {
          ttsSourceRef.current?.stop();
          setPlayingMessageId(null);
          return;
      }
      if (playingMessageId) {
          ttsSourceRef.current?.stop();
          setPlayingMessageId(null);
      }

      setLoadingAudioId(msg.id);
      try {
        if (!ttsAudioContextRef.current) {
            ttsAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        const audioB64 = await generateSpeechFromText(msg.text);
        if (audioB64 && ttsAudioContextRef.current) {
            const audioData = decode(audioB64);
            const audioBuffer = await decodeAudioData(audioData, ttsAudioContextRef.current, 24000, 1);
            
            const source = ttsAudioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ttsAudioContextRef.current.destination);
            source.onended = () => setPlayingMessageId(null);
            source.start(0);
            ttsSourceRef.current = source;
            setPlayingMessageId(msg.id);
        }
      } catch (e) {
          console.error("TTS Failed", e);
      } finally {
          setLoadingAudioId(null);
      }
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg shadow-lg border border-gray-700">
      <div className="flex-grow p-4 sm:p-6 overflow-y-auto space-y-6">
        {messages.length === 0 && (
            <div className="text-center text-gray-400 h-full flex flex-col justify-center items-center">
                <p className="text-xl">Ask a question about your memories or tasks.</p>
                <p className="text-base mt-2">"What is the status of my renovation project?"</p>
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                    <MicIcon className="w-4 h-4" /> Tap the mic to speak.
                </div>
            </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex items-start gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
             {msg.sender === 'ai' && <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center"><BotIcon className="w-6 h-6 text-white"/></div>}
            <div className={`max-w-md lg:max-w-2xl p-4 rounded-2xl ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-100 rounded-bl-none'}`}>
              <p className="text-lg whitespace-pre-wrap">{msg.text}</p>
              {msg.sender === 'ai' && (
                  <div className="mt-2 flex justify-end">
                      <button 
                        onClick={() => handleReadResponse(msg)}
                        className={`p-2 rounded-full hover:bg-gray-600 transition-colors ${playingMessageId === msg.id ? 'text-green-400' : 'text-blue-300'}`}
                        aria-label="Read Answer Aloud"
                      >
                         {loadingAudioId === msg.id ? <Loader2Icon className="w-5 h-5 animate-spin"/> 
                         : playingMessageId === msg.id ? <StopCircleIcon className="w-5 h-5"/> 
                         : <Volume2Icon className="w-5 h-5"/>}
                      </button>
                  </div>
              )}
            </div>
            {msg.sender === 'user' && <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center"><UserIcon className="w-6 h-6 text-white"/></div>}
          </div>
        ))}
         {isLoading && (
            <div className="flex items-start gap-4 justify-start">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center"><BotIcon className="w-6 h-6 text-white"/></div>
              <div className="max-w-md p-4 rounded-2xl bg-gray-700 text-gray-100 rounded-bl-none">
                <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-gray-300 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 sm:p-6 border-t border-gray-700 bg-gray-800 rounded-b-lg">
        <div className="flex items-center space-x-2 bg-gray-700 rounded-full p-1 border border-gray-600 focus-within:ring-2 focus-within:ring-blue-500">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={isListening ? "Listening..." : "Ask anything..."}
            className="flex-grow bg-transparent text-white text-lg p-3 px-4 focus:outline-none placeholder-gray-400"
            disabled={isLoading}
          />
          
          <button
             onClick={toggleListening}
             className={`p-3 rounded-full transition-colors ${isListening ? 'bg-red-600 text-white animate-pulse' : 'text-gray-400 hover:text-white hover:bg-gray-600'}`}
             aria-label={isListening ? "Stop Listening" : "Start Voice Input"}
          >
              <MicIcon className="w-6 h-6" />
          </button>

          <button
            onClick={handleSend}
            disabled={isLoading || !query.trim()}
            className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors m-1"
            aria-label="Send message"
          >
            <SendIcon className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default QASession;

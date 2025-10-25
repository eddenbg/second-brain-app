import React, { useState, useRef, useEffect } from 'react';
import { answerQuestionFromContext } from '../services/geminiService';
import { SendIcon, UserIcon, BotIcon } from './Icons';
import type { AnyMemory } from '../types';

interface QASessionProps {
  memories: AnyMemory[];
}

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

const QASession: React.FC<QASessionProps> = ({ memories }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = { sender: 'user', text: query };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsLoading(true);

    try {
      const aiResponse = await answerQuestionFromContext(memories, query);
      const aiMessage: Message = { sender: 'ai', text: aiResponse };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage: Message = { sender: 'ai', text: 'Sorry, something went wrong.' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg shadow-lg border border-gray-700">
      <div className="flex-grow p-4 sm:p-6 overflow-y-auto space-y-6">
        {messages.length === 0 && (
            <div className="text-center text-gray-400 h-full flex flex-col justify-center items-center">
                <p className="text-xl">Ask a question about your memories.</p>
                <p className="text-base mt-2">For example: "What was the main point of the article about AI?"</p>
            </div>
        )}
        {messages.map((msg, index) => (
          <div key={index} className={`flex items-start gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
             {msg.sender === 'ai' && <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center"><BotIcon className="w-6 h-6 text-white"/></div>}
            <div className={`max-w-md lg:max-w-2xl p-4 rounded-2xl ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-100 rounded-bl-none'}`}>
              <p className="text-lg whitespace-pre-wrap">{msg.text}</p>
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
        <div className="flex items-center space-x-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask anything about your memories..."
            className="w-full bg-gray-700 text-white text-lg p-3 rounded-full border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !query.trim()}
            className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
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

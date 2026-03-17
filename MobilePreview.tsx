
import React, { useState, useRef } from 'react';
import { Session, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon } from './Icons';
import { getGeminiInstance } from '../utils/gemini';

import type { TranscriptSegment } from '../types';

const MiniRecorder: React.FC<{
    onTranscriptChange: (transcript: string) => void,
    onAudioDataUrlChange?: (dataUrl: string) => void,
    onStructuredTranscriptChange?: (segments: TranscriptSegment[]) => void
}> = ({ onTranscriptChange, onAudioDataUrlChange, onStructuredTranscriptChange }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string|null>(null);
    const liveTranscriptRef = useRef('');
    const structuredTranscriptRef = useRef<TranscriptSegment[]>([]);
    const startTimeRef = useRef<number>(0);
    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    const start = async () => {
        if (isRecording) return;
        liveTranscriptRef.current = '';
        structuredTranscriptRef.current = [];
        onTranscriptChange('');
        onStructuredTranscriptChange?.([]);
        setError(null);
        startTimeRef.current = Date.now();
        
        const ai = getGeminiInstance();
        if (!ai) {
          setError("AI client not available.");
          return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            setIsRecording(true);

            // Record audio blob
            const chunks: Blob[] = [];
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (e) => chunks.push(e.data);
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onloadend = () => onAudioDataUrlChange?.(reader.result as string);
                reader.readAsDataURL(blob);
            };
            recorder.start();
            
            // Allow browser to choose native sample rate
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            const actualSampleRate = context.sampleRate;
            
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
                      const text = message.serverContent.inputTranscription.text || '';
                      const timestamp = (Date.now() - startTimeRef.current) / 1000;
                      liveTranscriptRef.current += text;
                      structuredTranscriptRef.current.push({ text, timestamp });
                      onTranscriptChange(liveTranscriptRef.current);
                      onStructuredTranscriptChange?.([...structuredTranscriptRef.current]);
                    }
                  },
                  onerror: (e) => { setError('Transcription error.'); stop(); },
                  onclose: () => {},
                },
                config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {} },
              });
        } catch (err) {
            setError('Mic access denied.');
            setIsRecording(false);
        }
    };

    const stop = async () => {
        if (!isRecording) return;
        mediaRecorderRef.current?.stop();
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close();
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
        }
        setIsRecording(false);
    };

    return (
        <div className="flex items-center gap-4">
            <button 
                type="button" 
                onClick={isRecording ? stop : start}
                className={`flex items-center justify-center w-12 h-12 rounded-full transition-colors focus:outline-none focus:ring-2 ${isRecording ? 'bg-red-500 hover:bg-red-600 focus:ring-red-400' : 'bg-gray-600 hover:bg-gray-500 focus:ring-blue-400'}`}
                aria-label={isRecording ? 'Stop note recording' : 'Record a note'}
            >
                {isRecording ? <StopCircleIcon className="w-6 h-6 text-white"/> : <MicIcon className="w-6 h-6 text-white"/>}
            </button>
            <p className="text-sm text-gray-400 flex-grow">{isRecording ? "Recording note..." : "Add a voice note (optional)"}</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
    )
}

export default MiniRecorder;

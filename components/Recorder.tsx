import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveSession } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon } from './Icons';
import type { VoiceMemory } from '../types';
import { getCurrentLocation } from '../utils/location';

interface RecorderProps {
  onSave: (recording: VoiceMemory) => void;
}

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const Recorder: React.FC<RecorderProps> = ({ onSave }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState('');
  
  const finalTranscriptRef = useRef<string>('');
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const startRecording = async () => {
    if (isRecording) return;
    setError(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setIsRecording(true);

      const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = context;

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            const source = context.createMediaStreamSource(stream);
            const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              
              let binary = '';
              const len = int16.buffer.byteLength;
              const bytes = new Uint8Array(int16.buffer);
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binary);

              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(context.destination);
          },
          onmessage: (message) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              finalTranscriptRef.current += text;
              setLiveTranscript(prev => prev + text);
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Live session error:', e);
            setError('An error occurred during transcription. Please try again.');
            stopRecording(false);
          },
          onclose: (e: CloseEvent) => {
             // Closed
          },
        },
        config: {
          responseModalities: [Modality.AUDIO], // Required but we only use transcription
          inputAudioTranscription: {},
        },
      });

    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Could not access microphone. Please check permissions.');
      setIsRecording(false);
    }
  };

  const stopRecording = useCallback(async (shouldSave: boolean = true) => {
    if (!isRecording) return;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    scriptProcessorRef.current?.disconnect();
    audioContextRef.current?.close();

    if (sessionPromiseRef.current) {
        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch (e) {
            console.error("Error closing session", e)
        }
    }
    
    setIsRecording(false);
    sessionPromiseRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    scriptProcessorRef.current = null;


    if (shouldSave && finalTranscriptRef.current.trim()) {
      setIsSaving(true);
      setRecordingTitle(`Voice Note - ${new Date().toLocaleString()}`);
    } else {
        setLiveTranscript('');
    }
  }, [isRecording]);

  const handleSave = async () => {
    if (!recordingTitle.trim() || !finalTranscriptRef.current.trim()) {
      setError("Title and transcript cannot be empty.");
      return;
    }
    
    const location = await getCurrentLocation();

    const newRecording: VoiceMemory = {
      id: Date.now().toString(),
      type: 'voice',
      title: recordingTitle,
      transcript: finalTranscriptRef.current,
      date: new Date().toISOString(),
      ...(location && { location }),
    };
    onSave(newRecording);
    resetState();
  };
  
  const resetState = () => {
    setIsSaving(false);
    setLiveTranscript('');
    setRecordingTitle('');
    setError(null);
    finalTranscriptRef.current = '';
  }

  const handleCancelSave = () => {
    resetState();
  };

  if (isSaving) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-4 border border-blue-500">
        <h2 className="text-2xl font-bold text-white">Save Voice Note</h2>
        <div>
          <label htmlFor="recording-title" className="block text-lg font-medium text-gray-300 mb-2">Title</label>
          <input
            id="recording-title"
            type="text"
            value={recordingTitle}
            onChange={(e) => setRecordingTitle(e.target.value)}
            className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="bg-gray-900 p-4 rounded-md max-h-48 overflow-y-auto border border-gray-700">
          <p className="text-gray-300 whitespace-pre-wrap">{finalTranscriptRef.current}</p>
        </div>
        <div className="flex justify-end gap-4 mt-4">
          <button onClick={handleCancelSave} className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
            <SaveIcon className="w-6 h-6"/>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <div className="flex flex-col items-center space-y-6">
        <button
          onClick={isRecording ? () => stopRecording() : startRecording}
          className={`flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 ${
            isRecording
              ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400'
              : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-400'
          }`}
          aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          {isRecording ? (
            <StopCircleIcon className="w-12 h-12 sm:w-16 sm:h-16 text-white" />
          ) : (
            <MicIcon className="w-12 h-12 sm:w-16 sm:h-16 text-white" />
          )}
        </button>
        <p className="text-xl text-gray-300 font-semibold h-8">
          {isRecording ? 'Recording...' : 'Tap to record a voice note'}
        </p>
        {error && <p className="text-red-400 text-center">{error}</p>}
      </div>
      {(isRecording || liveTranscript) && (
        <div className="mt-6 bg-gray-900 p-4 rounded-md border border-gray-700 min-h-[100px] max-h-64 overflow-y-auto">
          <p className="text-lg text-gray-200 whitespace-pre-wrap">{liveTranscript}</p>
        </div>
      )}
    </div>
  );
};

export default Recorder;
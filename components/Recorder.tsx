
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LiveSession, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, BrainCircuitIcon, EyeIcon } from './Icons';
import type { VoiceMemory, TranscriptSegment } from '../types';
import { getCurrentLocation } from '../utils/location';
import { getGeminiInstance } from '../utils/gemini';
import { generateTitleForContent } from '../services/geminiService';

interface RecorderProps {
  onSave: (recording: Omit<VoiceMemory, 'id' | 'date'>) => void;
  onCancel: () => void;
  titlePlaceholder: string;
  saveButtonText: string;
  enableDiarization?: boolean;
}

const Recorder: React.FC<RecorderProps> = ({ onSave, onCancel, titlePlaceholder, saveButtonText, enableDiarization }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState('');
  const [tags, setTags] = useState('');
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [discreetMode, setDiscreetMode] = useState(false);
  
  const finalTranscriptRef = useRef<string>('');
  const structuredTranscriptRef = useRef<TranscriptSegment[]>([]);
  const speakerIdMap = useRef(new Map<number, number>());
  const lastSpeakerIdRef = useRef<number | null>(null);
  const speakerCounterRef = useRef(1);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Function to request wake lock
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock acquired');
      } catch (err) {
        console.error('Could not acquire wake lock:', err);
      }
    }
  };

  // Function to release wake lock
  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Screen Wake Lock released');
      } catch (err) {
        console.error('Error releasing wake lock', err);
      }
    }
  };

  // Re-acquire wake lock if visibility changes (e.g. user tabs away and comes back)
  useEffect(() => {
    const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && isRecording) {
            await requestWakeLock();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isRecording]);

  const startRecording = async () => {
    if (isRecording) return;
    setError(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';
    structuredTranscriptRef.current = [];
    speakerIdMap.current.clear();
    lastSpeakerIdRef.current = null;
    speakerCounterRef.current = 1;

    const ai = getGeminiInstance();
    if (!ai) {
      setError("AI features are not available. Please check API Key configuration.");
      return;
    }

    try {
      // 1. Request Wake Lock first
      await requestWakeLock();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setIsRecording(true);

      // Create AudioContext. Note: We do NOT force sampleRate here anymore.
      // We let the browser choose the native rate (usually 44100 or 48000 on Android).
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = context;
      
      // Ensure context is running (needed for some mobile browsers)
      if (context.state === 'suspended') {
        await context.resume();
      }

      // CRITICAL FIX: Use the ACTUAL sample rate of the context
      const actualSampleRate = context.sampleRate;
      console.log(`Audio recording at ${actualSampleRate}Hz`);
      
      const config: any = {
        responseModalities: [Modality.AUDIO], // Required but we only use transcription
        inputAudioTranscription: {},
      };

      if (enableDiarization) {
        config.inputAudioTranscription.enableSpeakerId = true;
      }

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
                // Send the ACTUAL sample rate to Gemini so it knows how to process the audio
                session.sendRealtimeInput({ media: { data: base64Data, mimeType: `audio/pcm;rate=${actualSampleRate}` } });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(context.destination);
          },
          onmessage: (message) => {
            if (message.serverContent?.inputTranscription) {
              const transcriptionPart = message.serverContent.inputTranscription;
              const text = transcriptionPart.text;
              let transcriptChunk = '';

              if (enableDiarization && typeof transcriptionPart.speakerId === 'number') {
                  const speakerId = transcriptionPart.speakerId;
                  if (!speakerIdMap.current.has(speakerId)) {
                      speakerIdMap.current.set(speakerId, speakerCounterRef.current++);
                  }
                  const speakerLabel = `Speaker ${speakerIdMap.current.get(speakerId)}`;
  
                  if (lastSpeakerIdRef.current !== speakerId) {
                      const prefix = finalTranscriptRef.current.length > 0 ? '\n\n' : '';
                      transcriptChunk = `${prefix}${speakerLabel}: ${text}`;
                  } else {
                      transcriptChunk = text;
                  }
                  lastSpeakerIdRef.current = speakerId;
                  
                  const lastSegment = structuredTranscriptRef.current[structuredTranscriptRef.current.length - 1];
                  if (lastSegment && lastSegment.speakerId === speakerId) {
                    lastSegment.text += text;
                  } else {
                    structuredTranscriptRef.current.push({ speakerId, text });
                  }
              } else {
                  transcriptChunk = text;
              }
              
              finalTranscriptRef.current += transcriptChunk;
              setLiveTranscript(prev => prev + transcriptChunk);
            }
          },
          onerror: (e: any) => {
            console.error('Live session error:', e);
            const errorMsg = e.message || e.error?.message || "Unknown error";
            // Don't alert immediately, try to keep going if possible, or fail gracefully
            if (errorMsg.includes("rate")) {
               setError(`Sample rate mismatch. Recording at ${actualSampleRate}Hz.`);
            } else {
               setError(`Transcription paused: ${errorMsg}`);
            }
          },
          onclose: (e: CloseEvent) => {
             // Closed
          },
        },
        config,
      });

    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Could not access microphone. Please check permissions.');
      setIsRecording(false);
      releaseWakeLock(); // Release if start failed
    }
  };

  const stopRecording = useCallback(async (shouldSave: boolean = true) => {
    if (!isRecording) return;
    
    // Release resources
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    scriptProcessorRef.current?.disconnect();
    audioContextRef.current?.close();

    // Release Wake Lock
    await releaseWakeLock();
    setDiscreetMode(false);

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
      // Automatically generate title when saving
      setIsGeneratingTitle(true);
      try {
        const generatedTitle = await generateTitleForContent(finalTranscriptRef.current);
        setRecordingTitle(generatedTitle || titlePlaceholder);
      } catch (error) {
        console.error("Error auto-generating title:", error);
        setRecordingTitle(titlePlaceholder); // Fallback to placeholder
      } finally {
        setIsGeneratingTitle(false);
      }
    } else {
      if (!shouldSave) {
          onCancel();
      }
    }
  }, [isRecording, onCancel, titlePlaceholder]);

  const handleSave = async () => {
    if (!recordingTitle.trim() || !finalTranscriptRef.current.trim()) {
      setError("Title and transcript cannot be empty.");
      return;
    }
    
    const location = await getCurrentLocation();

    const newRecordingBase: Omit<VoiceMemory, 'id' | 'date'> = {
      type: 'voice',
      title: recordingTitle,
      transcript: finalTranscriptRef.current,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
      ...(location && { location }),
    } as Omit<VoiceMemory, 'id'|'date'>;

    if (enableDiarization && structuredTranscriptRef.current.length > 0) {
        const speakerMappings: { [key: number]: string } = {};
        for (const [rawId, sequentialId] of speakerIdMap.current.entries()) {
            speakerMappings[rawId] = `Speaker ${sequentialId}`;
        }
        
        onSave({
          ...newRecordingBase,
          structuredTranscript: structuredTranscriptRef.current,
          speakerMappings,
        });
    } else {
        onSave(newRecordingBase);
    }
  };
  
  const handleGenerateTitle = async () => {
    if (!finalTranscriptRef.current.trim()) return;
    setIsGeneratingTitle(true);
    setError(null);
    try {
        const generatedTitle = await generateTitleForContent(finalTranscriptRef.current);
        setRecordingTitle(generatedTitle);
    } catch (error) {
        console.error("Error generating title:", error);
        setError("Failed to generate title.");
    } finally {
        setIsGeneratingTitle(false);
    }
  };

  if (discreetMode && isRecording) {
      return (
          <div 
            className="fixed inset-0 bg-black z-[100] flex items-center justify-center cursor-pointer touch-none"
            onClick={() => setDiscreetMode(false)}
          >
              {/* Very faint hint, mostly invisible on OLED in dark room */}
              <div className="text-gray-900 text-sm select-none opacity-5">Tap to wake</div>
          </div>
      )
  }

  if (isSaving) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-4 border border-blue-500">
        <h2 className="text-2xl font-bold text-white">Save Recording</h2>
        <div>
          <label htmlFor="recording-title" className="block text-lg font-medium text-gray-300 mb-2">Title</label>
          <div className="flex gap-2">
            <input
                id="recording-title"
                type="text"
                value={recordingTitle}
                onChange={(e) => setRecordingTitle(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button 
                onClick={handleGenerateTitle} 
                disabled={isGeneratingTitle || !finalTranscriptRef.current.trim()} 
                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2"
                aria-label="Generate title"
            >
               <BrainCircuitIcon className="w-5 h-5"/> {isGeneratingTitle ? '...' : 'Generate'}
            </button>
          </div>
        </div>
        <div>
            <label htmlFor="recording-tags" className="block text-lg font-medium text-gray-300 mb-2">Tags</label>
            <input
                id="recording-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. work, ideas, urgent"
                className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-sm text-gray-400 mt-1">Separate tags with commas.</p>
        </div>
        <div className="bg-gray-900 p-4 rounded-md max-h-48 overflow-y-auto border border-gray-700">
          <p className="text-gray-300 whitespace-pre-wrap">{finalTranscriptRef.current}</p>
        </div>
        {error && <p className="text-red-400 text-center">{error}</p>}
        <div className="flex justify-end gap-4 mt-4">
          <button onClick={onCancel} className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
            <SaveIcon className="w-6 h-6"/>
            {saveButtonText}
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
            <StopCircleIcon className="w-14 h-14 sm:w-20 sm:h-20 text-white" />
          ) : (
            <MicIcon className="w-14 h-14 sm:w-20 sm:h-20 text-white" />
          )}
        </button>
        <div className="text-center h-8">
            <p className="text-xl text-gray-300 font-semibold">
            {isRecording ? 'Recording...' : 'Tap to start recording'}
            </p>
            {isRecording && <p className="text-xs text-green-400 mt-1">Screen will stay awake.</p>}
        </div>
        
        {isRecording && (
            <button 
                onClick={() => setDiscreetMode(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-full text-gray-300 hover:bg-gray-600 border border-gray-600"
            >
                <EyeIcon className="w-5 h-5" />
                <span>Discreet Mode (Black Screen)</span>
            </button>
        )}

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

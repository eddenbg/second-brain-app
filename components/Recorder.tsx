
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LiveSession, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, BrainCircuitIcon, EyeIcon, CheckIcon, GlobeIcon, Loader2Icon } from './Icons';
import type { VoiceMemory, TranscriptSegment } from '../types';
import { getCurrentLocation } from '../utils/location';
import { getGeminiInstance } from '../utils/gemini';
import { analyzeVoiceNote } from '../services/geminiService';

interface RecorderProps {
  onSave: (recording: Omit<VoiceMemory, 'id' | 'date'>) => void;
  onCancel: () => void;
  titlePlaceholder: string;
  saveButtonText: string;
  enableDiarization?: boolean;
}

// Type definition for Web Speech API
interface IWindow extends Window {
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}

const Recorder: React.FC<RecorderProps> = ({ onSave, onCancel, titlePlaceholder, saveButtonText, enableDiarization }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState('');
  const [extractedActionItems, setExtractedActionItems] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [discreetMode, setDiscreetMode] = useState(false);
  
  // 'cloud' = Gemini Live (Better, Paid/Quota), 'device' = Web Speech API (Free, Good)
  const [transcriptionMode, setTranscriptionMode] = useState<'cloud' | 'device'>('cloud'); 
  
  const finalTranscriptRef = useRef<string>('');
  const structuredTranscriptRef = useRef<TranscriptSegment[]>([]);
  const speakerIdMap = useRef(new Map<number, number>());
  const lastSpeakerIdRef = useRef<number | null>(null);
  const speakerCounterRef = useRef(1);
  
  // Gemini Live Refs
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Native Speech Refs
  const recognitionRef = useRef<any>(null);

  // MediaRecorder for Playback
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioDataUrlRef = useRef<string | undefined>(undefined);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Audio cues for accessibility
  const playBeep = useCallback((frequency: number, type: 'sine' | 'square' = 'sine', duration: number = 0.15) => {
    try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.error("Audio cue failed", e);
    }
  }, []);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock not available:', err);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {
        console.error('Error releasing wake lock', err);
      }
    }
  };

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
    setExtractedActionItems([]);
    audioChunksRef.current = [];
    audioDataUrlRef.current = undefined;

    await requestWakeLock();
    playBeep(880, 'sine', 0.2); // Start beep

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        // Start MediaRecorder to capture audio file for playback
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
            }
        };
        mediaRecorder.onstop = () => {
             const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
             const reader = new FileReader();
             reader.readAsDataURL(blob);
             reader.onloadend = () => {
                 audioDataUrlRef.current = reader.result as string;
             }
        };
        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;

        if (transcriptionMode === 'device') {
            startNativeRecording();
        } else {
            startCloudRecording(stream);
        }
        setIsRecording(true);
    } catch (err) {
        console.error(err);
        setError("Could not access microphone.");
        releaseWakeLock();
    }
  };

  const startNativeRecording = () => {
      const win = window as unknown as IWindow;
      const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognition) {
          setError("Device transcription is not supported in this browser. Please switch to AI Mode.");
          playBeep(200, 'square', 0.5);
          return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US'; 

      recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                  finalChunk += event.results[i][0].transcript + ' ';
              } else {
                  interimTranscript += event.results[i][0].transcript;
              }
          }
          
          if (finalChunk) {
              finalTranscriptRef.current += finalChunk;
          }
          setLiveTranscript(finalTranscriptRef.current + interimTranscript);
      };

      recognition.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
          if (event.error !== 'no-speech') {
              // Don't kill the MediaRecorder just because speech recog failed temporarily
              // But maybe notify user?
          }
      };

      recognition.onend = () => {
          // If we are still supposed to be recording, restart it
          if (isRecording && recognitionRef.current) {
             try {
                 recognition.start();
             } catch(e) {}
          }
      };

      try {
          recognition.start();
          recognitionRef.current = recognition;
      } catch (e) {
          setError("Failed to start device recording.");
      }
  };

  const startCloudRecording = async (stream: MediaStream) => {
    const ai = getGeminiInstance();
    if (!ai) {
      setError("AI features are not available. Please check API Key configuration.");
      return;
    }

    try {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)({ 
          sampleRate: 16000 
      });
      audioContextRef.current = context;
      
      if (context.state === 'suspended') {
        await context.resume();
      }

      const config: any = {
        responseModalities: [Modality.AUDIO],
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
                let s = Math.max(-1, Math.min(1, inputData[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              let binary = '';
              const bytes = new Uint8Array(int16.buffer);
              const len = bytes.byteLength;
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
            // We do NOT stop the whole recording here, just the transcription might fail
          },
          onclose: (e: CloseEvent) => {},
        },
        config,
      });

    } catch (err) {
      console.error('Error starting cloud recording:', err);
      setError('Could not connect to Gemini Live.');
    }
  };

  const stopRecording = useCallback(async (shouldSave: boolean = true) => {
    if (!isRecording) return;
    setIsRecording(false); 
    
    playBeep(440, 'sine', 0.2); 
    await releaseWakeLock();
    setDiscreetMode(false);

    // Stop MediaRecorder first to ensure we get the file
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
    }

    if (transcriptionMode === 'cloud') {
        scriptProcessorRef.current?.disconnect();
        audioContextRef.current?.close();

        if (sessionPromiseRef.current) {
            try {
                const session = await sessionPromiseRef.current;
                session.close();
            } catch (e) {}
        }
        sessionPromiseRef.current = null;
        audioContextRef.current = null;
        scriptProcessorRef.current = null;
    } else {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
    }
    
    // Stop all tracks on the stream
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    // Small delay to allow FileReader to finish in the onstop callback
    await new Promise(resolve => setTimeout(resolve, 500));

    if (shouldSave && finalTranscriptRef.current.trim()) {
      setIsSaving(true);
      setIsAnalyzing(true);
      try {
        const analysis = await analyzeVoiceNote(finalTranscriptRef.current);
        setRecordingTitle(analysis.title || titlePlaceholder);
        setExtractedActionItems(analysis.actionItems || []);
      } catch (error) {
        setRecordingTitle(titlePlaceholder);
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      if (!shouldSave) {
          onCancel();
      }
    }
  }, [isRecording, onCancel, titlePlaceholder, playBeep, transcriptionMode]);

  const handleSave = async () => {
    if (!recordingTitle.trim() || !finalTranscriptRef.current.trim()) {
      setError("Title and transcript cannot be empty.");
      return;
    }
    
    const location = await getCurrentLocation();
    const actionItemsObj = extractedActionItems.map(text => ({ text, done: false }));

    const newRecordingBase: Omit<VoiceMemory, 'id' | 'date'> = {
      type: 'voice',
      title: recordingTitle,
      transcript: finalTranscriptRef.current,
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
      audioDataUrl: audioDataUrlRef.current, // Save the audio file
      ...(location && { location }),
      ...(actionItemsObj.length > 0 && { actionItems: actionItemsObj })
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
  
  const handleAnalyze = async () => {
    if (!finalTranscriptRef.current.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    try {
        const analysis = await analyzeVoiceNote(finalTranscriptRef.current);
        setRecordingTitle(analysis.title);
        setExtractedActionItems(analysis.actionItems);
    } catch (error) {
        console.error("Error analyzing:", error);
        setError("Failed to analyze content.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const removeActionItem = (index: number) => {
      setExtractedActionItems(prev => prev.filter((_, i) => i !== index));
  }

  const addActionItem = () => {
      const text = prompt("Add new action item:");
      if (text) setExtractedActionItems(prev => [...prev, text]);
  }

  if (discreetMode && isRecording) {
      return (
          <div 
            className="fixed inset-0 bg-black z-[100] flex items-center justify-center cursor-pointer touch-none"
            onClick={() => setDiscreetMode(false)}
            aria-label="Discreet mode active. Tap anywhere to wake screen."
          >
              <div className="text-gray-900 text-sm select-none opacity-5">Tap to wake</div>
          </div>
      )
  }

  if (isSaving) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-4 border border-blue-500" role="dialog" aria-labelledby="save-dialog-title">
        <h2 id="save-dialog-title" className="text-2xl font-bold text-white">Save Recording</h2>
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
                onClick={handleAnalyze} 
                disabled={isAnalyzing || !finalTranscriptRef.current.trim()} 
                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2"
                aria-label="Regenerate title and tasks"
            >
               <BrainCircuitIcon className="w-5 h-5"/> {isAnalyzing ? '...' : 'Analyze'}
            </button>
          </div>
        </div>
        
        <div>
             <div className="flex justify-between items-center mb-2">
                 <h3 className="text-lg font-medium text-gray-300">Action Items (To-Do)</h3>
                 <button onClick={addActionItem} className="text-sm text-blue-400 hover:text-blue-300 underline">+ Add Item</button>
             </div>
             {extractedActionItems.length > 0 ? (
                 <ul className="space-y-2 bg-gray-900 p-3 rounded-md border border-gray-700">
                     {extractedActionItems.map((item, idx) => (
                         <li key={idx} className="flex items-start gap-2">
                             <CheckIcon className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                             <span className="text-gray-200 flex-grow">{item}</span>
                             <button onClick={() => removeActionItem(idx)} className="text-red-400 hover:text-red-300 px-2" aria-label={`Remove task ${item}`}>×</button>
                         </li>
                     ))}
                 </ul>
             ) : (
                 <p className="text-gray-500 italic text-sm">No action items detected.</p>
             )}
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
        {error && <p className="text-red-400 text-center" role="alert">{error}</p>}
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
        
        {!isRecording && (
            <div className="flex bg-gray-700 rounded-lg p-1 w-full max-w-xs">
                <button
                    onClick={() => setTranscriptionMode('cloud')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${transcriptionMode === 'cloud' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                >
                   High Quality (AI)
                </button>
                <button
                    onClick={() => setTranscriptionMode('device')}
                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${transcriptionMode === 'device' ? 'bg-green-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                >
                   Free (Device)
                </button>
            </div>
        )}

        <button
          onClick={isRecording ? () => stopRecording() : startRecording}
          className={`flex items-center justify-center w-24 h-24 sm:w-32 sm:h-32 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 ${
            isRecording
              ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400'
              : transcriptionMode === 'cloud' ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-400' : 'bg-green-600 hover:bg-green-700 focus:ring-green-400'
          }`}
          aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          {isRecording ? (
            <StopCircleIcon className="w-14 h-14 sm:w-20 sm:h-20 text-white" />
          ) : (
            <MicIcon className="w-14 h-14 sm:w-20 sm:h-20 text-white" />
          )}
        </button>
        <div className="text-center h-8" aria-live="polite">
            <p className="text-xl text-gray-300 font-semibold">
            {isRecording ? 'Recording...' : `Tap to start (${transcriptionMode === 'cloud' ? 'AI' : 'Free'} Mode)`}
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

        {error && <p className="text-red-400 text-center" role="alert">{error}</p>}
      </div>
      {(isRecording || liveTranscript) && (
        <div className="mt-6 bg-gray-900 p-4 rounded-md border border-gray-700 min-h-[100px] max-h-64 overflow-y-auto" aria-live="polite">
          <p className="text-lg text-gray-200 whitespace-pre-wrap">{liveTranscript}</p>
        </div>
      )}
    </div>
  );
};

export default Recorder;

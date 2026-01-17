
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LiveSession, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, XIcon, Loader2Icon, CheckIcon, PlayIcon, Volume2Icon } from './Icons';
import type { VoiceMemory } from '../types';
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

const Recorder: React.FC<RecorderProps> = ({ onSave, onCancel, titlePlaceholder, saveButtonText }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState('');
  const [extractedActionItems, setExtractedActionItems] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [audioDataUrl, setAudioDataUrl] = useState<string | undefined>(undefined);
  
  const finalTranscriptRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

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
    } catch (e) {}
  }, []);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) {}
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try { await wakeLockRef.current.release(); wakeLockRef.current = null; } catch (err) {}
    }
  };

  const startRecording = async () => {
    if (isRecording) return;
    setError(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';
    audioChunksRef.current = [];
    setAudioDataUrl(undefined);
    await requestWakeLock();
    playBeep(880, 'sine', 0.2);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => setAudioDataUrl(reader.result as string);
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();

        const ai = getGeminiInstance();
        if (!ai) { setError("AI unavailable."); return; }
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
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  let s = Math.max(-1, Math.min(1, inputData[i]));
                  int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                let binary = '';
                const bytes = new Uint8Array(int16.buffer);
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }));
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(context.destination);
            },
            onmessage: (m) => {
              if (m.serverContent?.inputTranscription) {
                const text = m.serverContent.inputTranscription.text;
                finalTranscriptRef.current += text;
                setLiveTranscript(prev => prev + text);
              }
            },
            onerror: () => {},
            onclose: () => {},
          },
          config: { 
            responseModalities: [Modality.AUDIO], 
            inputAudioTranscription: {},
            systemInstruction: `You are a professional, high-accuracy transcriptionist for a student who frequently switches between Hebrew and English (code-switching). 
            Rules:
            1. Transcribe EXACTLY what is said. 
            2. If the speaker uses Hebrew, transcribe using Hebrew characters. 
            3. If the speaker uses English, transcribe using English characters.
            4. NEVER translate. If they say a Hebrew word in an English sentence, keep the Hebrew word in Hebrew.
            5. Be extremely sensitive to language switches; do not try to "force" Hebrew sounds into English words or vice versa.`
          },
        });
    } catch (err) {
        setError('Microphone access denied.');
        await releaseWakeLock();
    }
  };

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false); 
    playBeep(440, 'sine', 0.2);
    await releaseWakeLock();

    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    scriptProcessorRef.current?.disconnect();
    audioContextRef.current?.close();
    sessionPromiseRef.current?.then(s => s.close());

    if (finalTranscriptRef.current.trim()) {
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
      onCancel();
    }
  }, [isRecording, onCancel, titlePlaceholder, playBeep]);

  const handleSave = useCallback(async () => {
    const finalTranscript = finalTranscriptRef.current.trim();
    if (!finalTranscript) {
        onCancel();
        return;
    }
    
    const finalTitle = recordingTitle.trim() || titlePlaceholder;
    const location = await getCurrentLocation();
    onSave({
      type: 'voice',
      title: finalTitle,
      transcript: finalTranscript,
      audioDataUrl,
      actionItems: extractedActionItems.map(text => ({ text, done: false })),
      ...(location && { location }),
    } as Omit<VoiceMemory, 'id'|'date'>);
  }, [recordingTitle, audioDataUrl, extractedActionItems, onSave, onCancel, titlePlaceholder]);

  const handleBackgroundTap = () => {
    if (isSaving) {
        handleSave();
    } else if (!isRecording) {
        onCancel();
    }
  };

  const renderContent = () => {
    if (isSaving) {
        return (
          <div 
            className="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-lg max-h-[95vh] border-4 border-gray-600 flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex justify-between items-center p-5 border-b-4 border-gray-700 shrink-0 bg-gray-800">
              <h2 className="text-lg font-black text-white uppercase tracking-tight">Review</h2>
              <button 
                  onClick={handleSave}
                  className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-black rounded-2xl text-sm uppercase shadow-xl active:scale-95 transition-all"
              >
                  <CheckIcon className="w-5 h-5"/> {saveButtonText}
              </button>
            </header>

            <main className="flex-grow overflow-y-auto p-5 space-y-5 scroll-smooth">
              <div className="space-y-4">
                  <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1.5 tracking-widest">Note Title</label>
                      <input
                          type="text"
                          value={recordingTitle}
                          onChange={(e) => setRecordingTitle(e.target.value)}
                          className="w-full bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"
                          placeholder="Enter Title"
                      />
                  </div>

                  {audioDataUrl && (
                      <div className="bg-gray-900 p-4 rounded-2xl border border-gray-700 shadow-inner flex items-center gap-4">
                          <div className="bg-blue-900/30 p-2 rounded-full"><Volume2Icon className="w-6 h-6 text-blue-400"/></div>
                          <audio src={audioDataUrl} controls className="flex-grow h-10" />
                      </div>
                  )}

                  <div className="space-y-2">
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 tracking-widest">Transcript</label>
                      <div className="w-full bg-gray-900 p-5 rounded-2xl border-2 border-gray-700 text-sm text-gray-200 leading-relaxed font-medium shadow-inner min-h-[150px]">
                          {isAnalyzing ? (
                              <div className="flex items-center gap-3 text-blue-400 font-black animate-pulse">
                                  <Loader2Icon className="w-5 h-5 animate-spin"/>
                                  ANALYZING NOTE...
                              </div>
                          ) : (
                              <div className="whitespace-pre-wrap">{finalTranscriptRef.current}</div>
                          )}
                      </div>
                  </div>

                  {extractedActionItems.length > 0 && (
                      <div className="space-y-2.5 pb-4">
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest">Detected Tasks</label>
                          <div className="space-y-1.5">
                              {extractedActionItems.map((item, i) => (
                                  <div key={i} className="bg-gray-700/50 p-3 rounded-xl border border-gray-600 text-xs font-bold text-gray-300 flex items-center gap-3">
                                      <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0"/> {item}
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}
              </div>
            </main>

            <footer className="p-3 border-t-2 border-gray-700 bg-gray-800 shrink-0 text-center">
              <button 
                onClick={onCancel}
                className="px-6 py-2 text-gray-500 font-black uppercase text-[10px] tracking-widest hover:text-red-400 transition-colors"
              >
                Discard and Close
              </button>
            </footer>
          </div>
        );
    }

    return (
        <div 
            className="bg-gray-800 p-4 rounded-[2.5rem] shadow-2xl border-4 border-gray-700 w-full max-w-lg h-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
        >
          <header className="flex justify-between items-center mb-3 shrink-0">
              <div className="flex items-center gap-2">
                  <div className="bg-blue-600/20 px-3 py-1.5 rounded-xl border border-blue-500/30">
                      <span className="text-blue-400 font-black text-[9px] uppercase tracking-widest">AI Mode Active</span>
                  </div>
              </div>
              <button onClick={onCancel} className="p-2.5 bg-gray-700 rounded-xl text-gray-400 active:scale-90 transition-transform"><XIcon className="w-5 h-5"/></button>
          </header>

          <main className="flex-grow flex flex-col items-center justify-center gap-4 overflow-hidden px-1">
            <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex items-center justify-center w-32 h-32 rounded-full shadow-[0_0_40px_rgba(37,99,235,0.2)] transition-all border-8 shrink-0 ${
                    isRecording ? 'bg-red-600 animate-pulse border-red-500 scale-105 shadow-[0_0_50px_rgba(220,38,38,0.4)]' : 'bg-blue-600 border-blue-500 hover:scale-105 shadow-[0_0_50px_rgba(37,99,235,0.3)]'
                }`}
            >
                {isRecording ? <StopCircleIcon className="w-14 h-14 text-white" /> : <MicIcon className="w-14 h-14 text-white" />}
            </button>

            <div className="w-full bg-gray-900 p-5 rounded-3xl border-2 border-gray-700 overflow-y-auto flex-grow max-h-48 shadow-inner relative">
                {!liveTranscript && !isRecording && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-600 font-black uppercase text-xs tracking-widest pointer-events-none text-center p-4">
                        Tap Microphone to Start Recording
                    </div>
                )}
                <p className="text-lg text-gray-200 whitespace-pre-wrap font-bold leading-relaxed">
                    {liveTranscript}
                </p>
            </div>
          </main>

          <footer className="mt-4 flex gap-3 shrink-0">
              {isRecording ? (
                 <button onClick={stopRecording} className="flex-1 py-4 bg-red-600 text-white font-black rounded-2xl text-lg uppercase shadow-2xl active:scale-95 transition-all">FINISH RECORDING</button>
              ) : (
                 <button onClick={onCancel} className="flex-1 py-4 bg-gray-700 text-gray-400 font-black rounded-2xl text-base uppercase active:scale-95 transition-all">Cancel</button>
              )}
          </footer>
        </div>
    );
  };

  return (
    <div 
        className="fixed inset-0 bg-black/90 flex flex-col items-center justify-center z-[100] p-4 animate-fade-in"
        onClick={handleBackgroundTap}
    >
      {renderContent()}
    </div>
  );
};

export default Recorder;

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Session, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, XIcon, Loader2Icon, CheckIcon, PlayIcon, VideoIcon, GlobeIcon, EyeOffIcon, EyeIcon } from './Icons';
import type { VoiceMemory, NotebookData } from '../types';
import LectureNotebook from './LectureNotebook';
import { getCurrentLocation } from '../utils/location';
import { getGeminiInstance } from '../utils/gemini';
import { analyzeVoiceNote, summarizeLectureTranscript } from '../services/geminiService';
import { encode, downsampleTo16k } from '../utils/audio';

interface RecorderProps {
  onSave: (recording: Omit<VoiceMemory, 'id' | 'date' | 'category'>) => void;
  onCancel: () => void;
  titlePlaceholder: string;
  saveButtonText: string;
  enableDiarization?: boolean;
  audioOnly?: boolean;
}

const FRAME_RATE = 1;
const JPEG_QUALITY = 0.7;

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result as string;
            resolve(base64data.split(',')[1]); 
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};


const Recorder: React.FC<RecorderProps> = ({ onSave, onCancel, titlePlaceholder, saveButtonText, audioOnly = false }) => {
    const [title, setTitle] = useState(titlePlaceholder);
    const [transcript, setTranscript] = useState('');
    const [structuredTranscript, setStructuredTranscript] = useState<{text: string, timestamp: number}[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [videoDataUrl, setVideoDataUrl] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [captureMode, setCaptureMode] = useState<'physical' | 'remote'>('physical');
    const [privacyMode, setPrivacyMode] = useState(false);
    const [notebookData, setNotebookData] = useState<NotebookData | null>(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showSummarize, setShowSummarize] = useState(false);
    const [summaryText, setSummaryText] = useState<string>('');

    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameIntervalRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const recordingTimerRef = useRef<number | null>(null);
    const MAX_RECORDING_SECONDS = 3600; // 1 hour max

    const stopAllMedia = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
        if (frameIntervalRef.current) {
            window.clearInterval(frameIntervalRef.current);
            frameIntervalRef.current = null;
        }
    }, [stream]);

    const startRecording = async () => {
        if (isRecording) return;
        setTranscript('');
        setStructuredTranscript([]);
        setError(null);
        setNotebookData(null);
        startTimeRef.current = Date.now();

        const ai = getGeminiInstance();
        if (!ai) {
            setError("Gemini API key not configured. Open the Settings menu (gear icon) → AI Features → Gemini AI, and paste your key from aistudio.google.com.");
            return;
        }

        try {
            try {
                const micPerm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                if (micPerm.state === 'denied') {
                    setError("Microphone is blocked. Tap the lock icon in your browser's address bar → Permissions → Microphone → Allow, then try again.");
                    return;
                }
            } catch {}

            if (!audioOnly && captureMode !== 'remote') {
                try {
                    const camPerm = await navigator.permissions.query({ name: 'camera' as PermissionName });
                    if (camPerm.state === 'denied') {
                        setError("Camera is blocked. Tap the lock icon in your browser's address bar → Permissions → Camera → Allow, then try again.");
                        return;
                    }
                } catch {}
            }

            let mediaStream: MediaStream;

            if (audioOnly) {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } else if (captureMode === 'remote') {
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                displayStream.getVideoTracks().forEach(t => t.stop());
                const audioTracks = displayStream.getAudioTracks();
                if (audioTracks.length === 0) {
                    setError("No audio detected — in the screen picker, make sure to check 'Share system audio' before clicking Share.");
                    return;
                }
                mediaStream = new MediaStream(audioTracks);
            } else {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: { facingMode: 'environment' }
                });
            }

            setStream(mediaStream);
            setIsRecording(true);

            const chunks: Blob[] = [];
            mediaRecorderRef.current = new MediaRecorder(mediaStream, { mimeType: captureMode === 'remote' ? 'audio/webm' : 'video/webm' });
            mediaRecorderRef.current.ondataavailable = (event) => chunks.push(event.data);
            mediaRecorderRef.current.onstop = () => {
                if (captureMode === 'remote') return;
                const blob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onloadend = () => setVideoDataUrl(reader.result as string);
                reader.readAsDataURL(blob);
            };
            mediaRecorderRef.current.start();

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;
            await audioContext.resume();
            const actualSampleRate = audioContext.sampleRate;

            // Auto-stop recording if it exceeds max duration
            recordingTimerRef.current = window.setInterval(() => {
                setRecordingTime(t => {
                    if (t >= MAX_RECORDING_SECONDS) {
                        setError(`Recording limit (${MAX_RECORDING_SECONDS} seconds) reached. Recording stopped automatically.`);
                        stopRecording();
                        return t;
                    }
                    return t + 1;
                });
            }, 1000);

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-latest',
                callbacks: {
                    onopen: () => {
                        const source = audioContext.createMediaStreamSource(mediaStream);
                        const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const int16 = downsampleTo16k(inputData, actualSampleRate);
                            const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: pcmBlob })).catch((err) => {
                                console.error('Failed to send audio to session:', err);
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(audioContext.destination);

                        if (captureMode === 'remote') return;

                        const canvasEl = canvasRef.current;
                        const videoEl = videoRef.current;
                        if (!canvasEl || !videoEl) return;

                        const ctx = canvasEl.getContext('2d');
                        if (!ctx) return;

                        frameIntervalRef.current = window.setInterval(() => {
                            canvasEl.width = videoEl.videoWidth;
                            canvasEl.height = videoEl.videoHeight;
                            ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);
                            canvasEl.toBlob(
                                async (blob) => {
                                    if (blob) {
                                        const base64Data = await blobToBase64(blob);
                                        sessionPromiseRef.current?.then((session) => {
                                            session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
                                        }).catch((err) => {
                                            console.error('Failed to send frame to session:', err);
                                        });
                                    }
                                }, 'image/jpeg', JPEG_QUALITY
                            );
                        }, 1000 / FRAME_RATE);
                    },
                    onmessage: (message) => {
                        const text = message.serverContent?.inputTranscription?.text;
                        if (text) {
                            const timestamp = (Date.now() - startTimeRef.current) / 1000;
                            setTranscript(prev => prev + text);
                            setStructuredTranscript(prev => [...prev, { text, timestamp }]);
                        }
                    },
                    onerror: (e) => {
                        console.error('Gemini Live error:', e);
                        setError('Live transcription failed. Make sure your Gemini API key (Settings → AI Features) has Gemini Live access enabled at aistudio.google.com.');
                    },
                    onclose: () => {
                        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                            audioContextRef.current.close();
                        }
                        if (frameIntervalRef.current) {
                            clearInterval(frameIntervalRef.current);
                            frameIntervalRef.current = null;
                        }
                        if (recordingTimerRef.current) {
                            clearInterval(recordingTimerRef.current);
                            recordingTimerRef.current = null;
                        }
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: { language: 'he' },
                    systemInstruction: `You are a real-time lecture assistant for a visually impaired student. Your primary job is to transcribe the lecture accurately in Hebrew first, then English if needed. 
                    IN ADDITION, you will receive video frames from the lecture. Analyze these frames for key visual information. 
                    When you see something important, like a math equation on a whiteboard, a diagram, code on a screen, or a specific action the professor is demonstrating, you MUST insert a descriptive note into the transcript. 
                    Prefix these notes with "VISUAL NOTE:". For example: "VISUAL NOTE: The professor just wrote the quadratic formula, x = [-b ± sqrt(b^2-4ac)]/2a, on the board." or "VISUAL NOTE: A diagram of a plant cell is now on the screen, showing the nucleus and chloroplasts."
                    Do not describe every minor gesture. Focus on information that is critical for understanding and cannot be understood from audio alone.
                    Continue transcribing the spoken words seamlessly around these visual notes.`
                },
            });
        } catch (err) {
            console.error(err);
            const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
            setError(denied
                ? "Camera or microphone access was denied. Tap the lock icon in your browser's address bar → Permissions → allow Camera and Microphone, then try again."
                : "Could not access camera/mic. Please check your device.");
            setIsRecording(false);
            stopAllMedia();
        }
    };
    
    useEffect(() => {
        if (stream && videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    const stopRecording = async () => {
        setIsRecording(false);
        mediaRecorderRef.current?.stop();

        // Clear recording timer
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }

        // Clear frame capture interval
        if (frameIntervalRef.current) {
            clearInterval(frameIntervalRef.current);
            frameIntervalRef.current = null;
        }

        // Close session safely with timeout
        if (sessionPromiseRef.current) {
            try {
                const session = await Promise.race([
                    sessionPromiseRef.current,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Session close timeout')), 5000))
                ]) as Session;
                session.close();
            } catch (err) {
                console.error('Error closing session:', err);
            } finally {
                sessionPromiseRef.current = null;
            }
        }

        // Close audio context safely
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try {
                audioContextRef.current.close();
            } catch (err) {
                console.error('Error closing audio context:', err);
            }
            audioContextRef.current = null;
        }

        stopAllMedia();
    };
    
    useEffect(() => {
      return () => {
          if (isRecording) {
            stopRecording();
          }
      };
    }, [isRecording]);

    // Reset privacy screen when recording ends
    useEffect(() => {
        if (!isRecording) setPrivacyMode(false);
    }, [isRecording]);

    // Auto-show privacy screen when the user returns to the app while recording
    // (so the screen isn't accidentally visible when they unlock their phone)
    useEffect(() => {
        if (!isRecording) return;
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && isRecording) {
                setPrivacyMode(true);
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [isRecording]);

    // Recording timer
    useEffect(() => {
        if (!isRecording) {
            setRecordingTime(0);
            return;
        }
        const interval = setInterval(() => {
            setRecordingTime(prev => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [isRecording]);

    const formatTime = (seconds: number): string => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSummarize = async () => {
        setIsProcessing(true);
        try {
            const lectureAnalysis = await summarizeLectureTranscript(transcript);
            setSummaryText(lectureAnalysis.summary || 'Could not generate summary. Please try again.');
        } catch(e) {
            console.error("Summarization failed", e);
            setSummaryText('Error generating summary. Please try again.');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSave = async () => {
        setIsProcessing(true);
        try {
            const analysis = await analyzeVoiceNote(transcript);
            const location = await getCurrentLocation();

            let summary = summaryText || '';
            let lectureActionItems: Array<{ text: string; done: boolean }> = [];

            // If we don't have a summary yet, generate it
            if (!summary) {
                try {
                    const lectureAnalysis = await summarizeLectureTranscript(transcript);
                    summary = lectureAnalysis.summary;
                    lectureActionItems = lectureAnalysis.actionItems;
                } catch (summaryError) {
                    console.warn('Could not generate lecture summary', summaryError);
                }
            }

            const newMemory: Omit<VoiceMemory, 'id' | 'date' | 'category'> = {
                type: 'voice',
                title: analysis.title || title,
                transcript,
                structuredTranscript,
                videoDataUrl: videoDataUrl || undefined,
                summary: summary || undefined,
                actionItems: lectureActionItems.length > 0 ? lectureActionItems : analysis.actionItems.map(text => ({ text, done: false })),
                ...(location && { location }),
                ...(notebookData && { notebook: notebookData }),
            };
            onSave(newMemory);
        } catch(e) {
            console.error("Save failed", e);
            setError("Failed to analyze note. Saved with basic info.");
             onSave({ type: 'voice', title, transcript, videoDataUrl: videoDataUrl || undefined });
        } finally {
            setIsProcessing(false);
        }
    };
    
    // Full-screen recording mode with notebook (transcription happens silently in background)
    if (isRecording && !audioOnly && captureMode !== 'remote') {
        return (
            <div className="fixed inset-0 bg-black z-[100] flex flex-col">
                {/* Privacy screen overlay */}
                {privacyMode && (
                    <div
                        className="fixed inset-0 bg-black z-[9999] flex items-end justify-end p-6"
                        onClick={() => setPrivacyMode(false)}
                        aria-label="Tap anywhere to show recording screen"
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && setPrivacyMode(false)}
                    >
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse opacity-30" />
                    </div>
                )}

                {/* Top toolbar with controls */}
                <div className="bg-black/60 backdrop-blur border-b-2 border-white/10 px-4 py-3 flex items-center justify-between z-10">
                    {/* Recording timer (blinking red) */}
                    <button
                        onClick={() => setPrivacyMode(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-full font-black text-sm animate-pulse"
                        aria-label="Hide screen"
                    >
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        {formatTime(recordingTime)}
                    </button>

                    {/* Listening indicator in center */}
                    <div className="flex-1 flex justify-center">
                        <div className="text-xs font-black text-gray-400 uppercase tracking-widest">
                            🎙️ Recording (Transcribing in background)
                        </div>
                    </div>

                    {/* Control buttons at top right */}
                    <div className="flex gap-2">
                        <button
                            onClick={stopRecording}
                            aria-label="Stop recording"
                            className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full font-black text-sm uppercase transition-all"
                        >
                            Stop
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isProcessing}
                            aria-label="Save recording"
                            className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-full font-black text-sm uppercase transition-all disabled:bg-gray-600"
                        >
                            {isProcessing ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>

                {/* Full-screen drawing canvas (transcription happens silently in background) */}
                <div className="flex-1 overflow-hidden">
                    <LectureNotebook
                        onUpdate={setNotebookData}
                        startTime={startTimeRef.current}
                        isRecording={isRecording}
                    />
                </div>

                {/* Bottom tip bar */}
                <div className="bg-black/40 border-t border-white/10 px-4 py-2 text-xs text-gray-400 text-center">
                    ✍️ Draw/write notes freely • Use ✍️ EXTRACT to convert handwriting to text • Full transcript appears after you stop
                </div>
            </div>
        );
    }

    return (
        <>
        {/* Privacy screen overlay — covers everything when active */}
        {privacyMode && (
            <div
                className="fixed inset-0 bg-black z-[9999] flex items-end justify-end p-6"
                onClick={() => setPrivacyMode(false)}
                aria-label="Tap anywhere to show recording screen"
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setPrivacyMode(false)}
            >
                {/* Tiny red dot — only indicator the app is alive */}
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse opacity-30" />
            </div>
        )}
        <div className="bg-[#001f3f] p-6 rounded-[3rem] border-4 border-white/10 shadow-2xl flex flex-col gap-6 w-full">
            <canvas ref={canvasRef} className="hidden" />

            {!audioOnly && !isRecording && (
                <div className="flex gap-2 bg-black/20 p-2 rounded-2xl border-2 border-white/5">
                    <button
                        onClick={() => setCaptureMode('physical')}
                        className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${captureMode === 'physical' ? 'bg-yellow-500 text-[#001f3f]' : 'text-gray-400'}`}
                    >
                        <VideoIcon className="w-5 h-5" />
                        <span>In-Person</span>
                    </button>
                    <button
                        onClick={() => setCaptureMode('remote')}
                        className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${captureMode === 'remote' ? 'bg-yellow-500 text-[#001f3f]' : 'text-gray-400'}`}
                    >
                        <GlobeIcon className="w-5 h-5" />
                        <span>Remote (Zoom)</span>
                    </button>
                </div>
            )}

            {!audioOnly && !isRecording && captureMode === 'remote' && (
                <p className="text-xs text-yellow-500 font-bold text-center animate-pulse">
                    TIP: When the screen picker appears, select the Zoom window and check "Share system audio" for high-quality transcription.
                </p>
            )}

            {!audioOnly && captureMode !== 'remote' && (
                <div className="w-full aspect-video bg-black/40 rounded-[2rem] flex items-center justify-center relative overflow-hidden border-2 border-white/10 shadow-inner">
                    {videoDataUrl ? (
                        <video src={videoDataUrl} controls className="w-full h-full object-contain" />
                    ) : stream ? (
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    ) : (
                        <div className="text-center text-gray-400">
                            <VideoIcon className="w-20 h-20 mx-auto" />
                            <p className="mt-4 font-black uppercase text-xs tracking-tighter">Ready to Record Video</p>
                        </div>
                    )}
                </div>
            )}

            {(audioOnly || captureMode === 'remote') && (
                <div className="w-full h-40 bg-black/40 rounded-[2rem] flex flex-col items-center justify-center border-2 border-white/10">
                    <MicIcon className={`w-20 h-20 ${isRecording ? 'text-red-400 animate-pulse' : 'text-white/40'}`} />
                    <p className="mt-3 font-black uppercase text-sm text-white/50 tracking-widest">
                        {isRecording ? 'Listening…' : 'Ready'}
                    </p>
                </div>
            )}

            <div className="flex justify-center gap-6">
                 <button
                    onClick={onCancel}
                    aria-label="Cancel recording"
                    className="px-10 py-5 bg-white/10 rounded-2xl text-white active:scale-95 transition-transform flex items-center gap-4 font-black text-2xl uppercase shadow-xl border-2 border-white/10"
                 >
                    <XIcon className="w-10 h-10"/>
                    <span>Cancel</span>
                 </button>
                 <button
                     onClick={isRecording ? stopRecording : startRecording}
                     aria-label={isRecording ? "Stop recording" : "Start recording"}
                     className={`px-10 py-5 rounded-2xl font-black text-2xl uppercase shadow-xl transition-all flex items-center gap-4 ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-yellow-500 text-[#001f3f]'}`}
                 >
                     {isRecording ? <StopCircleIcon className="w-10 h-10"/> : <MicIcon className="w-10 h-10"/>}
                     {isRecording ? 'STOP' : 'RECORD'}
                 </button>
                 <button
                    onClick={handleSave}
                    disabled={isRecording || isProcessing || !transcript}
                    aria-label={isProcessing ? "Saving recording" : "Save recording"}
                    className="px-10 py-5 bg-yellow-500 rounded-2xl text-[#001f3f] disabled:bg-gray-700 disabled:text-gray-400 active:scale-95 transition-transform flex items-center gap-4 font-black text-2xl uppercase shadow-xl"
                >
                    {isProcessing ? <Loader2Icon className="w-10 h-10 animate-spin"/> : <SaveIcon className="w-10 h-10"/>}
                    <span>{isProcessing ? 'Saving...' : 'Save'}</span>
                </button>
            </div>
             
            {/* Privacy / background recording controls — only during active recording */}
            {isRecording && (
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => setPrivacyMode(true)}
                        aria-label="Hide screen"
                        className="flex-1 flex items-center justify-center gap-3 py-4 bg-black/40 border-2 border-white/10 rounded-2xl text-white font-black uppercase tracking-widest text-sm active:scale-95 transition-all"
                    >
                        <EyeOffIcon className="w-6 h-6" />
                        Hide Screen
                    </button>
                    <div className="flex-1 flex items-center justify-center gap-3 py-4 bg-black/20 border-2 border-white/5 rounded-2xl text-white/40 text-xs font-bold text-center leading-tight px-3">
                        Press <strong className="text-white/60">Home</strong> to minimise — recording continues in background
                    </div>
                </div>
            )}

             {error && <p className="text-center text-red-400 font-bold bg-red-900/20 p-3 rounded-xl">{error}</p>}

             {/* Full-screen Drawing Canvas during recording */}
             {isRecording && (
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 border-2 border-white/10 rounded-[2rem] overflow-hidden bg-black/40">
                        <LectureNotebook
                            onUpdate={setNotebookData}
                            startTime={startTimeRef.current}
                            isRecording={isRecording}
                        />
                    </div>
                </div>
             )}

             {/* Transcript appears only after stopping */}
             {!isRecording && transcript && (
                <div className="bg-black/40 p-6 rounded-[2rem] border-2 border-white/10 scroll-smooth">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xl font-black text-yellow-400 uppercase tracking-tight">Lecture Transcript</h4>
                        <button
                            onClick={() => {
                                setShowSummarize(true);
                                setSummaryText('');
                                handleSummarize();
                            }}
                            disabled={isProcessing}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-sm uppercase transition-all disabled:bg-gray-600"
                            aria-label="Summarize transcript"
                        >
                            {isProcessing ? 'Summarizing...' : '✨ Summarize'}
                        </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto mb-4 text-white text-sm leading-relaxed whitespace-pre-wrap">
                        {structuredTranscript.length > 0 ? (
                            structuredTranscript.map((segment, idx) => (
                                <span
                                    key={idx}
                                    onClick={() => {
                                        if (videoDataUrl && videoRef.current) {
                                            videoRef.current.currentTime = segment.timestamp;
                                            videoRef.current.play();
                                        }
                                    }}
                                    className={`${segment.text.includes('VISUAL NOTE:') ? 'text-green-400 font-bold italic' : 'text-gray-300'} ${videoDataUrl ? 'cursor-pointer hover:bg-yellow-500/30 hover:text-yellow-300' : 'pointer-events-none'} transition-colors rounded px-1`}
                                >
                                    {segment.text}
                                </span>
                            ))
                        ) : (
                            <span className="text-gray-400">{transcript}</span>
                        )}
                    </div>
                    <p className="text-xs text-gray-500">Transcript captured: {transcript.split(/\s+/).filter(Boolean).length} words</p>
                </div>
             )}

             {/* Summary Modal - appears after clicking Summarize */}
             {showSummarize && !isRecording && (
                <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-gray-800 rounded-[2rem] w-full max-w-2xl max-h-[80vh] flex flex-col border-4 border-gray-700 shadow-2xl">
                        {/* Header */}
                        <div className="px-6 py-4 border-b-2 border-gray-700 flex items-center justify-between shrink-0">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Lecture Summary</h3>
                            <button
                                onClick={() => setShowSummarize(false)}
                                className="p-2 bg-gray-700 rounded-xl hover:bg-gray-600 transition-all"
                                aria-label="Close summary"
                            >
                                <XIcon className="w-6 h-6 text-white" />
                            </button>
                        </div>

                        {/* Summary Content */}
                        <div className="flex-grow overflow-y-auto px-6 py-6">
                            {isProcessing ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-4">
                                    <Loader2Icon className="w-12 h-12 animate-spin text-blue-500" />
                                    <p className="text-gray-400 font-bold">Generating summary from transcript...</p>
                                </div>
                            ) : summaryText ? (
                                <div className="space-y-6">
                                    <div>
                                        <h4 className="text-sm font-black text-blue-400 uppercase tracking-widest mb-3">Summary</h4>
                                        <p className="text-white text-lg leading-relaxed whitespace-pre-wrap">
                                            {summaryText}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-12 gap-4">
                                    <p className="text-gray-400 font-bold">No summary generated yet.</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t-2 border-gray-700 bg-gray-900/50 flex gap-3">
                            <button
                                onClick={() => setShowSummarize(false)}
                                className="flex-1 py-3 bg-gray-700 text-white rounded-2xl font-black uppercase hover:bg-gray-600 transition-all"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isProcessing}
                                className="flex-1 py-3 bg-green-600 text-white rounded-2xl font-black uppercase hover:bg-green-500 disabled:bg-gray-600 transition-all flex items-center justify-center gap-3"
                            >
                                {isProcessing ? <Loader2Icon className="w-5 h-5 animate-spin" /> : <SaveIcon className="w-5 h-5" />}
                                {isProcessing ? 'Saving...' : 'Save Lecture'}
                            </button>
                        </div>
                    </div>
                </div>
             )}
        </div>
        </>
    );
};

export default Recorder;
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Session, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, XIcon, Loader2Icon, CheckIcon, PlayIcon, VideoIcon, GlobeIcon } from './Icons';
import type { VoiceMemory } from '../types';
import { getCurrentLocation } from '../utils/location';
import { getGeminiInstance } from '../utils/gemini';
import { analyzeVoiceNote } from '../services/geminiService';
import { encode } from '../utils/audio';

interface RecorderProps {
  onSave: (recording: Omit<VoiceMemory, 'id' | 'date' | 'category'>) => void;
  onCancel: () => void;
  titlePlaceholder: string;
  saveButtonText: string;
  enableDiarization?: boolean;
  audioOnly?: boolean;
}

const FRAME_RATE = 1; // 1 frame per second for visual analysis
const JPEG_QUALITY = 0.7;

// Helper to convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result as string;
            // remove the "data:image/jpeg;base64," part
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

    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameIntervalRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);

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
        startTimeRef.current = Date.now();

        const ai = getGeminiInstance();
        if (!ai) {
            setError("AI client is not available.");
            return;
        }

        try {
            let mediaStream: MediaStream;

            if (audioOnly) {
                // Pure audio — no camera, no video
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } else if (captureMode === 'remote') {
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });
                if (mediaStream.getAudioTracks().length === 0) {
                    setError("No audio captured. Make sure to check 'Share system audio' when selecting the screen.");
                }
            } else {
                // In-person lecture: camera + mic
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: { facingMode: 'environment' }
                });
            }

            setStream(mediaStream);
            setIsRecording(true);

            // Setup MediaRecorder for video
            const chunks: Blob[] = [];
            mediaRecorderRef.current = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
            mediaRecorderRef.current.ondataavailable = (event) => chunks.push(event.data);
            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onloadend = () => setVideoDataUrl(reader.result as string);
                reader.readAsDataURL(blob);
            };
            mediaRecorderRef.current.start();

            // Setup Gemini Live session
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                callbacks: {
                    onopen: () => {
                        // 1. Audio Stream
                        const source = audioContext.createMediaStreamSource(mediaStream);
                        const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const int16 = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
                            const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: pcmBlob }));
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(audioContext.destination);

                        // 2. Video Frame Stream
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
                    onerror: (e) => { console.error(e); setError('Transcription error.'); },
                    onclose: () => { audioContext.close(); },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    systemInstruction: `You are a real-time lecture assistant for a visually impaired student. Your primary job is to transcribe the lecture accurately. 
                    IN ADDITION, you will receive video frames from the lecture. Analyze these frames for key visual information. 
                    When you see something important, like a math equation on a whiteboard, a diagram, code on a screen, or a specific action the professor is demonstrating, you MUST insert a descriptive note into the transcript. 
                    Prefix these notes with "VISUAL NOTE:". For example: "VISUAL NOTE: The professor just wrote the quadratic formula, x = [-b ± sqrt(b^2-4ac)]/2a, on the board." or "VISUAL NOTE: A diagram of a plant cell is now on the screen, showing the nucleus and chloroplasts."
                    Do not describe every minor gesture. Focus on information that is critical for understanding and cannot be understood from audio alone.
                    Continue transcribing the spoken words seamlessly around these visual notes.`
                },
            });
        } catch (err) {
            console.error(err);
            setError("Could not access camera/mic. Please check permissions.");
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
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
            sessionPromiseRef.current = null;
        }
        stopAllMedia();
    };
    
    useEffect(() => {
      // Cleanup on unmount
      return () => {
          if (isRecording) {
            stopRecording();
          }
      };
    }, [isRecording]);


    const handleSave = async () => {
        setIsProcessing(true);
        try {
            const analysis = await analyzeVoiceNote(transcript);
            const location = await getCurrentLocation();
            
            // FIX: The created memory object does not have a category, so the type was updated to reflect that.
            const newMemory: Omit<VoiceMemory, 'id' | 'date' | 'category'> = {
                type: 'voice',
                title: analysis.title || title,
                transcript,
                structuredTranscript,
                videoDataUrl: videoDataUrl || undefined,
                actionItems: analysis.actionItems.map(text => ({ text, done: false })),
                ...(location && { location }),
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
    
    return (
        <div className="bg-[#001f3f] p-6 rounded-[3rem] border-4 border-white/10 shadow-2xl flex flex-col gap-6 w-full">
            <canvas ref={canvasRef} className="hidden" />

            {/* Mode selector — only shown for lecture recording (not audio-only) */}
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

            {/* Video preview — hidden in audio-only mode */}
            {!audioOnly && (
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

            {/* Audio-only visual feedback */}
            {audioOnly && (
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
             
             {error && <p className="text-center text-red-400 font-bold bg-red-900/20 p-3 rounded-xl">{error}</p>}
            
             <div className="bg-black/40 p-6 rounded-[2rem] max-h-96 overflow-y-auto border-2 border-white/10 scroll-smooth">
                 <h4 className="text-xl font-black text-yellow-400 mb-3 uppercase tracking-tight">Live Transcript</h4>
                 <div className="text-white text-2xl whitespace-pre-wrap leading-relaxed">
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
                                className={`cursor-pointer hover:bg-yellow-500/30 hover:text-yellow-300 transition-colors rounded px-1 ${videoDataUrl ? '' : 'pointer-events-none'}`}
                            >
                                {segment.text}
                            </span>
                        ))
                    ) : (
                        transcript || <span className="text-gray-500">Waiting for audio...</span>
                    )}
                 </div>
                 {isRecording && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mt-4"></div>}
            </div>
        </div>
    );
};

export default Recorder;
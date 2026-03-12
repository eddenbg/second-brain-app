import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Session, Modality } from '@google/genai';
import { MicIcon, StopCircleIcon, SaveIcon, XIcon, Loader2Icon, CheckIcon, PlayIcon, VideoIcon } from './Icons';
import type { VoiceMemory } from '../types';
import { getCurrentLocation } from '../utils/location';
import { getGeminiInstance } from '../utils/gemini';
import { analyzeVoiceNote } from '../services/geminiService';
import { encode } from '../utils/audio';

interface RecorderProps {
  // FIX: Changed onSave to expect a recording object without a category, as the parent component provides it.
  onSave: (recording: Omit<VoiceMemory, 'id' | 'date' | 'category'>) => void;
  onCancel: () => void;
  titlePlaceholder: string;
  saveButtonText: string;
  enableDiarization?: boolean;
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


const Recorder: React.FC<RecorderProps> = ({ onSave, onCancel, titlePlaceholder, saveButtonText }) => {
    const [title, setTitle] = useState(titlePlaceholder);
    const [transcript, setTranscript] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [videoDataUrl, setVideoDataUrl] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameIntervalRef = useRef<number | null>(null);

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
        setVideoDataUrl(null);
        setError(null);

        const ai = getGeminiInstance();
        if (!ai) {
            setError("AI client is not available.");
            return;
        }

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { facingMode: 'environment' } // Prefer back camera for lectures
            });
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
                        if (message.serverContent?.inputTranscription?.text) {
                            setTranscript(prev => prev + (message.serverContent?.inputTranscription?.text || ''));
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
        <div className="bg-gray-800 p-6 rounded-[3rem] border-4 border-gray-700 shadow-2xl flex flex-col gap-6 w-full">
            <canvas ref={canvasRef} className="hidden" />
            <div className="w-full aspect-video bg-gray-900 rounded-[2rem] flex items-center justify-center relative overflow-hidden border-2 border-gray-700 shadow-inner">
                {videoDataUrl ? (
                    <video src={videoDataUrl} controls className="w-full h-full object-contain" />
                ) : stream ? (
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                ) : (
                    <div className="text-center text-gray-600">
                        <VideoIcon className="w-20 h-20 mx-auto" />
                        <p className="mt-4 font-black uppercase text-xs tracking-tighter">Ready to Record Video</p>
                    </div>
                )}
            </div>

            <div className="flex justify-center gap-6">
                 <button onClick={onCancel} className="p-5 bg-gray-700 rounded-2xl text-white active:scale-95 transition-transform"><XIcon className="w-10 h-10"/></button>
                 <button 
                     onClick={isRecording ? stopRecording : startRecording} 
                     className={`px-10 py-5 rounded-2xl font-black text-2xl uppercase shadow-xl transition-all flex items-center gap-4 ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-blue-600 text-white'}`}
                 >
                     {isRecording ? <StopCircleIcon className="w-10 h-10"/> : <VideoIcon className="w-10 h-10"/>}
                     {isRecording ? 'STOP' : 'RECORD'}
                 </button>
                 <button 
                    onClick={handleSave} 
                    disabled={isRecording || isProcessing || !transcript}
                    className="p-5 bg-green-600 rounded-2xl text-white disabled:bg-gray-700 active:scale-95 transition-transform"
                >
                    {isProcessing ? <Loader2Icon className="w-10 h-10 animate-spin"/> : <SaveIcon className="w-10 h-10"/>}
                </button>
            </div>
             
             {error && <p className="text-center text-red-400 font-bold bg-red-900/20 p-3 rounded-xl">{error}</p>}
            
             <div className="bg-gray-900 p-6 rounded-[2rem] max-h-96 overflow-y-auto border-2 border-gray-700 scroll-smooth">
                 <h4 className="text-xl font-black text-blue-400 mb-3 uppercase tracking-tight">Live Transcript</h4>
                 <p className="text-gray-200 text-2xl whitespace-pre-wrap leading-relaxed">{transcript || <span className="text-gray-600">Waiting for audio...</span>}</p>
                 {isRecording && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mt-4"></div>}
            </div>
        </div>
    );
};

export default Recorder;
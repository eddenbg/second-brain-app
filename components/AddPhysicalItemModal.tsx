
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { generateTitleForContent } from '../services/geminiService';
import type { PhysicalItemMemory, VideoItemMemory, AnyMemory } from '../types';
import { BrainCircuitIcon, CameraIcon, XIcon, SaveIcon, UploadIcon, VideoIcon, StopCircleIcon, Loader2Icon } from './Icons';
import MiniRecorder from './MiniRecorder';
import { getCurrentLocation } from '../utils/location';
import { Modality, LiveSession } from '@google/genai';
import { getGeminiInstance } from '../utils/gemini';


interface AddPhysicalItemModalProps {
    onClose: () => void;
    onSave: (memory: Omit<PhysicalItemMemory | VideoItemMemory, 'id' | 'date' | 'category'>) => void;
}

const AddPhysicalItemModal: React.FC<AddPhysicalItemModalProps> = ({ onClose, onSave }) => {
    const [mode, setMode] = useState<'photo' | 'video'>('photo');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState('');
    const [voiceNote, setVoiceNote] = useState(''); 
    const [transcript, setTranscript] = useState(''); 
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [videoDataUrl, setVideoDataUrl] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const liveTranscriptRef = useRef('');

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => {
        return () => { stopCamera(); };
    }, [stopCamera]);

    const startCamera = async () => {
        if (isRecording) await stopRecording();
        stopCamera();
        setImageDataUrl(null);
        setVideoDataUrl(null);
        setError(null);
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
            setStream(mediaStream);
        } catch (err) {
            console.error("Camera access error:", err);
            setError("Could not access camera/mic. Please check permissions.");
        }
    };
    
    useEffect(() => {
        if (stream && videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    const takePicture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d')?.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
            const dataUrl = canvas.toDataURL('image/jpeg');
            setImageDataUrl(dataUrl);
            stopCamera();
        }
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                if (mode === 'photo') setImageDataUrl(result);
                else setVideoDataUrl(result);
                stopCamera();
            };
            if(mode === 'photo') reader.readAsDataURL(file);
            else if (file.type.startsWith('video/')) reader.readAsDataURL(file);
            else setError('Please select a valid video file.');
        }
    };
    
    const startRecording = async () => {
        if (!stream) return;
        
        const ai = getGeminiInstance();
        if (!ai) {
          setError("AI features are not available.");
          return;
        }

        setIsRecording(true);
        setVideoDataUrl(null);
        liveTranscriptRef.current = '';
        setTranscript('');
        
        const chunks: Blob[] = [];
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (event) => chunks.push(event.data);
        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const reader = new FileReader();
            reader.onloadend = () => setVideoDataUrl(reader.result as string);
            reader.readAsDataURL(blob);
        };
        mediaRecorderRef.current.start();
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
              onopen: () => {
                const source = audioContext.createMediaStreamSource(stream);
                const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
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
                scriptProcessor.connect(audioContext.destination);
              },
              onmessage: (message) => {
                if (message.serverContent?.inputTranscription) {
                  const text = message.serverContent.inputTranscription.text;
                  liveTranscriptRef.current += text;
                  setTranscript(prev => prev + text);
                }
              },
              onerror: (e) => { console.error(e); setError('Transcription error.'); },
              onclose: () => {},
            },
            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {} },
        });
    };

    const stopRecording = async () => {
        setIsRecording(false);
        mediaRecorderRef.current?.stop();
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
        }
        stopCamera();
    };

    const handleGenerateTitle = async () => {
        const content = description || transcript;
        if (!content.trim()) return;
        setIsGeneratingTitle(true);
        setTitle(await generateTitleForContent(content));
        setIsGeneratingTitle(false);
    }

    const handleSave = async () => {
        const hasMedia = imageDataUrl || videoDataUrl;
        if (!hasMedia || !title.trim()) return;
        
        const location = await getCurrentLocation();
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        
        if (mode === 'video' && videoDataUrl) {
            const newMemory: Omit<VideoItemMemory, 'id' | 'date' | 'category'> = {
                type: 'video', title, description,
                videoDataUrl, transcript, ...(location && { location }), tags: tagList,
            };
            onSave(newMemory);
        } else if (mode === 'photo' && imageDataUrl) {
            const newMemory: Omit<PhysicalItemMemory, 'id' | 'date' | 'category'> = {
                type: 'item', title, description,
                imageDataUrl, ...(location && { location }),
                ...(voiceNote.trim() && { voiceNote: { transcript: voiceNote.trim() } }),
                tags: tagList,
            };
            onSave(newMemory);
        }
        onClose();
    };
    
    const isSaveDisabled = !title.trim() || (mode === 'photo' && !imageDataUrl) || (mode === 'video' && !videoDataUrl);

    return (
        <div className="fixed inset-0 bg-black/90 flex flex-col justify-center items-center z-[120] p-4">
            <div className="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col border-4 border-gray-600 overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b-4 border-gray-700 shrink-0 bg-gray-800">
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase"><CameraIcon className="w-8 h-8"/> Item</h2>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleSave} 
                            disabled={isSaveDisabled} 
                            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-black rounded-xl text-sm uppercase shadow-xl disabled:bg-gray-700 active:scale-95 transition-all"
                        >
                            <SaveIcon className="w-5 h-5"/> SAVE
                        </button>
                        <button onClick={onClose} className="p-3 rounded-2xl bg-gray-700 active:scale-90 transition-transform"><XIcon className="w-6 h-6"/></button>
                    </div>
                </header>
                
                <main className="flex-grow p-6 space-y-6 overflow-y-auto scroll-smooth">
                    <div className="flex justify-center bg-gray-900 p-1.5 rounded-2xl border border-gray-700">
                        <button onClick={() => { setMode('photo'); stopCamera(); }} className={`flex-1 py-3 font-black rounded-xl text-xs uppercase tracking-widest transition-all ${mode === 'photo' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Photo</button>
                        <button onClick={() => { setMode('video'); stopCamera(); }} className={`flex-1 py-3 font-black rounded-xl text-xs uppercase tracking-widest transition-all ${mode === 'video' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Video</button>
                    </div>

                    <div className="w-full aspect-square bg-gray-900 rounded-[2rem] flex items-center justify-center relative overflow-hidden border-2 border-gray-700 shadow-inner">
                        <canvas ref={canvasRef} className="hidden" />
                        {imageDataUrl && mode === 'photo' ? <img src={imageDataUrl} alt="Item" className="w-full h-full object-contain" />
                        : videoDataUrl && mode === 'video' ? <video src={videoDataUrl} controls className="w-full h-full object-contain" />
                        : stream ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        : (
                            <div className="text-center text-gray-700">
                                {mode === 'photo' ? <CameraIcon className="w-20 h-20 mx-auto" /> : <VideoIcon className="w-20 h-20 mx-auto" />}
                                <p className="mt-4 font-black uppercase text-xs tracking-tighter">Capture a {mode}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 justify-center">
                        {isRecording ? (
                            <button onClick={stopRecording} className="px-8 py-4 bg-red-600 text-white font-black rounded-2xl shadow-lg active:scale-95 flex items-center gap-3 uppercase text-sm">
                                <StopCircleIcon className="w-6 h-6"/> STOP
                            </button>
                        ) : stream ? (
                            mode === 'photo' ? (
                                <button onClick={takePicture} className="px-8 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg active:scale-95 flex items-center gap-3 uppercase text-sm">
                                    <CameraIcon className="w-6 h-6"/> CAPTURE
                                </button>
                            ) : (
                                <button onClick={startRecording} className="px-8 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg active:scale-95 flex items-center gap-3 uppercase text-sm">
                                    <VideoIcon className="w-6 h-6"/> RECORD
                                </button>
                            )
                        ) : (
                            <>
                                <button onClick={startCamera} className="flex-1 py-4 bg-gray-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 uppercase text-xs">
                                    <CameraIcon className="w-5 h-5"/> Camera
                                </button>
                                <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-4 bg-gray-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 uppercase text-xs">
                                    <UploadIcon className="w-5 h-5"/> File
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept={mode === 'photo' ? "image/*" : "video/*"} className="hidden" />
                            </>
                        )}
                    </div>

                    {error && <p className="text-center text-red-400 font-bold bg-red-900/20 p-3 rounded-xl">{error}</p>}
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Details</label>
                            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What is this? Where is it located?" className="w-full bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                        </div>
                        
                        <div>
                            <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">Title</label>
                             <div className="flex gap-2">
                               <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="flex-grow bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"/>
                               <button onClick={handleGenerateTitle} disabled={isGeneratingTitle || (!description.trim() && !transcript.trim())} className="p-4 bg-purple-600 text-white rounded-2xl disabled:bg-gray-700 shadow-lg active:scale-95 transition-all">
                                   {isGeneratingTitle ? <Loader2Icon className="w-6 h-6 animate-spin"/> : <BrainCircuitIcon className="w-6 h-6"/>}
                               </button>
                            </div>
                        </div>

                        <div>
                            <MiniRecorder onTranscriptChange={setVoiceNote} />
                            {(voiceNote || transcript) && (
                                <div className="mt-3 bg-gray-900 p-4 rounded-2xl border border-gray-700 shadow-inner">
                                    <p className="text-xs text-gray-400 leading-relaxed font-medium">{voiceNote || transcript}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
                
                <footer className="p-4 bg-gray-800 border-t-2 border-gray-700 shrink-0 text-center">
                    <button onClick={onClose} className="text-gray-500 font-black uppercase text-xs tracking-widest">Cancel</button>
                </footer>
            </div>
        </div>
    );
};

export default AddPhysicalItemModal;

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { generateTitleForContent } from '../services/geminiService';
import type { PhysicalItemMemory, VideoItemMemory, AnyMemory } from '../types';
import { BrainCircuitIcon, CameraIcon, XIcon, SaveIcon, UploadIcon, VideoIcon, StopCircleIcon } from './Icons';
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
    const [voiceNote, setVoiceNote] = useState(''); // For photo mode
    const [transcript, setTranscript] = useState(''); // For video mode
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
          setError("AI features are not available. Please check API Key configuration.");
          return;
        }

        setIsRecording(true);
        setVideoDataUrl(null);
        liveTranscriptRef.current = '';
        setTranscript('');
        
        // Media Recorder for Video
        const chunks: Blob[] = [];
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (event) => chunks.push(event.data);
        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            setVideoDataUrl(URL.createObjectURL(blob));
        };
        mediaRecorderRef.current.start();
        
        // Live transcription for Audio
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
                  for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
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
        
        if (mode === 'video' && videoDataUrl) {
            const newMemory: Omit<VideoItemMemory, 'id' | 'date' | 'category'> = {
                type: 'video', title, description,
                videoDataUrl, transcript, ...(location && { location }),
            };
            onSave(newMemory);
        } else if (mode === 'photo' && imageDataUrl) {
            const newMemory: Omit<PhysicalItemMemory, 'id' | 'date' | 'category'> = {
                type: 'item', title, description,
                imageDataUrl, ...(location && { location }),
                ...(voiceNote.trim() && { voiceNote: { transcript: voiceNote.trim() } }),
            };
            onSave(newMemory);
        }
        onClose();
    };
    
    const isSaveDisabled = !title.trim() || (mode === 'photo' && !imageDataUrl) || (mode === 'video' && !videoDataUrl);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-600">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3"><CameraIcon/> Add Item Memory</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <main className="p-6 space-y-4 overflow-y-auto">
                    <div className="flex justify-center bg-gray-700 p-1 rounded-lg">
                        <button onClick={() => { setMode('photo'); stopCamera(); }} className={`w-full py-2 font-semibold rounded-md ${mode === 'photo' ? 'bg-blue-600' : ''}`}>Photo</button>
                        <button onClick={() => { setMode('video'); stopCamera(); }} className={`w-full py-2 font-semibold rounded-md ${mode === 'video' ? 'bg-blue-600' : ''}`}>Video</button>
                    </div>

                    <div className="w-full aspect-video bg-gray-900 rounded-md flex items-center justify-center relative overflow-hidden border border-gray-700">
                        <canvas ref={canvasRef} className="hidden" />
                        {imageDataUrl && mode === 'photo' ? <img src={imageDataUrl} alt="Item" className="w-full h-full object-contain" />
                        : videoDataUrl && mode === 'video' ? <video src={videoDataUrl} controls className="w-full h-full object-contain" />
                        : stream ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        : (
                            <div className="text-center text-gray-400">
                                {mode === 'photo' ? <CameraIcon className="w-16 h-16 mx-auto" /> : <VideoIcon className="w-16 h-16 mx-auto" />}
                                <p className="mt-2">Use camera or upload a {mode}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 justify-center">
                        {isRecording ? (
                            <button onClick={stopRecording} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 flex items-center gap-2">
                                <StopCircleIcon className="w-5 h-5"/> Stop Recording
                            </button>
                        ) : stream ? (
                            mode === 'photo' ? (
                                <button onClick={takePicture} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                                    <CameraIcon className="w-5 h-5"/> Take Picture
                                </button>
                            ) : (
                                <button onClick={startRecording} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                                    <VideoIcon className="w-5 h-5"/> Start Recording
                                </button>
                            )
                        ) : (
                            <>
                                <button onClick={startCamera} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                                    <CameraIcon className="w-5 h-5"/> Start Camera
                                </button>
                                <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                                    <UploadIcon className="w-5 h-5"/> Upload {mode === 'photo' ? 'Image' : 'Video'}
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept={mode === 'photo' ? "image/*" : "video/*"} className="hidden" />
                            </>
                        )}
                    </div>
                    {error && <p className="text-center text-red-400">{error}</p>}
                     <div>
                        <label htmlFor="description" className="block text-lg font-medium text-gray-300 mb-2">Description</label>
                        <textarea id="description" value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Describe the item, where it is, etc." className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                    </div>
                    <div>
                        <label htmlFor="title" className="block text-lg font-medium text-gray-300 mb-2">Title</label>
                         <div className="flex gap-2">
                           <input id="title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter a title for the item" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                           <button onClick={handleGenerateTitle} disabled={isGeneratingTitle || (!description.trim() && !transcript.trim())} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2">
                               <BrainCircuitIcon className="w-5 h-5"/> {isGeneratingTitle ? 'Generating...' : 'Generate'}
                           </button>
                        </div>
                    </div>
                     <div>
                        {mode === 'photo' && <MiniRecorder onTranscriptChange={setVoiceNote} />}
                        {voiceNote && mode === 'photo' && <div className="mt-2 text-sm bg-gray-900 border border-gray-700 rounded-md p-2 text-gray-300 max-h-24 overflow-y-auto">{voiceNote}</div>}
                        {transcript && mode === 'video' && (
                            <>
                                <h4 className="text-lg font-medium text-gray-300 mb-2 mt-4">Video Transcript:</h4>
                                <div className="text-sm bg-gray-900 border border-gray-700 rounded-md p-2 text-gray-300 max-h-24 overflow-y-auto">{transcript}</div>
                            </>
                        )}
                    </div>
                </main>
                <footer className="p-4 flex justify-end gap-4 border-t border-gray-700 bg-gray-800 rounded-b-lg">
                    <button onClick={onClose} className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} disabled={isSaveDisabled} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-500">
                        <SaveIcon className="w-6 h-6"/> Save Memory
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default AddPhysicalItemModal;
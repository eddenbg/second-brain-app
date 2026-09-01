
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { generateTitleForContent, generateItemDetailsFromImage } from '../services/geminiService';
import type { PhysicalItemMemory, VideoItemMemory, AnyMemory } from '../types';
import { BrainCircuitIcon, CameraIcon, XIcon, SaveIcon, UploadIcon, VideoIcon, StopCircleIcon, Loader2Icon } from './Icons';
import { Image } from 'lucide-react';
import MiniRecorder from './MiniRecorder';
import { getCurrentLocation } from '../utils/location';
import { Modality, Session } from '@google/genai';
import { getGeminiInstance } from '../utils/gemini';
import { downsampleTo16k } from '../utils/audio';


interface AddPhysicalItemModalProps {
    onClose: () => void;
    onSave: (memory: Omit<PhysicalItemMemory | VideoItemMemory, 'id' | 'date' | 'category'>) => void;
}

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB limit for videos and images

// Splits a "data:<mime>;base64,<data>" URL into its parts, e.g. to feed
// inlineData to Gemini. Falls back to image/jpeg if the URL is malformed.
const parseDataUrl = (dataUrl: string): { mimeType: string; data: string } => {
    const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
    return match ? { mimeType: match[1], data: match[2] } : { mimeType: 'image/jpeg', data: '' };
};

// Grabs a single JPEG frame from a recorded video's data URL, for feeding
// to Gemini vision when there's no typed/spoken description to work from.
// Returns null (rather than throwing) on any failure so callers can fall
// back gracefully.
const captureVideoFrame = (videoUrl: string): Promise<string | null> => {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        let settled = false;
        const timeoutId = window.setTimeout(() => finish(null), 8000);
        function finish(result: string | null) {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            video.remove();
            resolve(result);
        }
        video.onloadeddata = () => {
            if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) { finish(null); return; }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            finish(canvas.toDataURL('image/jpeg', 0.85));
        };
        video.onerror = () => finish(null);
        video.src = videoUrl;
    });
};

const formatFallbackTitle = () => `Item — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

const AddPhysicalItemModal: React.FC<AddPhysicalItemModalProps> = ({ onClose, onSave }) => {
    const [mode, setMode] = useState<'photo' | 'video'>('photo');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState('');
    const [voiceNote, setVoiceNote] = useState(''); 
    const [transcript, setTranscript] = useState(''); 
    const [structuredTranscript, setStructuredTranscript] = useState<{text: string, timestamp: number}[]>([]);
    const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
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
    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    const liveTranscriptRef = useRef('');

    const startTimeRef = useRef<number>(0);

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
            const camPerm = await navigator.permissions.query({ name: 'camera' as PermissionName });
            if (camPerm.state === 'denied') {
                setError("Camera is blocked. Tap the lock icon in your browser's address bar → Permissions → Camera → Allow, then try again.");
                return;
            }
        } catch {}
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
            setStream(mediaStream);
        } catch (err) {
            console.error("Camera access error:", err);
            const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
            setError(denied
                ? "Camera access was denied. Tap the lock icon in your browser's address bar → Permissions → Camera → Allow, then try again."
                : "Could not access camera. Please check your device.");
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
        if (!file) return;

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            setError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 200MB.`);
            return;
        }

        // Validate file type
        if (mode === 'photo') {
            if (!file.type.startsWith('image/')) {
                setError('Please select a valid image file.');
                return;
            }
        } else if (mode === 'video') {
            if (!file.type.startsWith('video/')) {
                setError('Please select a valid video file.');
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (mode === 'photo') setImageDataUrl(result);
            else setVideoDataUrl(result);
            stopCamera();
        };
        reader.onerror = () => {
            setError('Failed to read file. Please try again.');
        };
        reader.readAsDataURL(file);
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
        setStructuredTranscript([]);
        startTimeRef.current = Date.now();
        
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
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        await audioContext.resume();
        const actualSampleRate = audioContext.sampleRate;
        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-latest',
            callbacks: {
              onopen: () => {
                const source = audioContext.createMediaStreamSource(stream);
                const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
                scriptProcessor.onaudioprocess = (e) => {
                  const inputData = e.inputBuffer.getChannelData(0);
                  const int16 = downsampleTo16k(inputData, actualSampleRate);
                  const bytes = new Uint8Array(int16.buffer);
                  let binary = '';
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  sessionPromiseRef.current?.then((s) => s.sendRealtimeInput({ media: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }));
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(audioContext.destination);
              },
              onmessage: (message) => {
                if (message.serverContent?.inputTranscription) {
                  const text = message.serverContent.inputTranscription.text || '';
                  const timestamp = (Date.now() - startTimeRef.current) / 1000;
                  liveTranscriptRef.current += text;
                  setTranscript(prev => prev + text);
                  setStructuredTranscript(prev => [...prev, { text, timestamp }]);
                }
              },
              onerror: (e) => { console.error(e); setError('Transcription error.'); },
              onclose: () => {},
            },
            // languageCodes is rejected outright by Gemini Live for a plain Developer
            // API key ("languageCodes parameter is only supported in Gemini Enterprise
            // Agent Platform mode, not in Gemini Developer API mode") — confirmed by a
            // real runtime error in Recorder.tsx, which uses the same API tier. This
            // app never runs in Enterprise mode, so the field can never be used here
            // either. A systemInstruction is the only lever available at this tier —
            // added below, mirroring the wording already used in Recorder.tsx.
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                systemInstruction: `You are a real-time transcription assistant for a visually impaired student describing a physical item.

                LANGUAGE: Hebrew is the default and primary language — when a word or sound is ambiguous, transcribe it as Hebrew. Only transcribe a word as English when it clearly cannot be Hebrew (e.g. a technical term, product name, acronym, or a stretch of speech that is unmistakably English). Do not let English be the default guess for unclear audio. The speaker may mix Hebrew and English, switching mid-sentence and back — transcribe each word in the language it was actually spoken in, never translate between them. Keep English technical terms, product names and acronyms in Latin script exactly as spoken, even inside a Hebrew sentence. Write numbers as digits.`,
            },
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
        setError(null);
        const content = description || transcript;
        setIsGeneratingTitle(true);
        try {
            if (content.trim()) {
                // User typed a description or spoke a voice note during recording —
                // use that as the source text, same as before.
                setTitle(await generateTitleForContent(content));
                if (!description.trim() && transcript.trim()) {
                    setDescription(transcript.trim());
                }
                return;
            }

            // No text to work from: generate title + description straight from
            // the photographed/filmed item itself. This is the common case for
            // a camera-first flow — point camera at object, tap the brain icon.
            let frameDataUrl: string | null = null;
            if (mode === 'photo' && imageDataUrl) {
                frameDataUrl = imageDataUrl;
            } else if (mode === 'video' && videoDataUrl) {
                frameDataUrl = await captureVideoFrame(videoDataUrl);
                if (!frameDataUrl) {
                    setError("Couldn't grab a frame from the video to analyze. Type a short description instead, then tap the brain icon again, or just tap Save.");
                    return;
                }
            }

            if (!frameDataUrl) {
                setError('Take a photo or record a video first — or type a description — then tap the brain icon.');
                return;
            }

            const { mimeType, data } = parseDataUrl(frameDataUrl);
            if (!data) {
                setError('Could not read the captured image. Please retake the photo or video.');
                return;
            }
            const details = await generateItemDetailsFromImage(data, mimeType);
            setTitle(details.title);
            if (!description.trim() && details.description) {
                setDescription(details.description);
            }
            if (details.title === 'Untitled' && !details.description) {
                setError('AI generation failed (check your connection or API key in Settings → AI Features). You can still type a title and Save.');
            }
        } finally {
            setIsGeneratingTitle(false);
        }
    }

    const handleSave = async () => {
        const hasMedia = (mode === 'photo' && !!imageDataUrl) || (mode === 'video' && !!videoDataUrl);
        if (!hasMedia) return;

        // Never hard-block Save on a missing title — if AI generation was never
        // run, failed (no network/API key), or was skipped, fall back to a
        // sensible default rather than leaving the user stuck.
        const finalTitle = title.trim() || formatFallbackTitle();

        const location = await getCurrentLocation();
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);

        if (mode === 'video' && videoDataUrl) {
            const newMemory: Omit<VideoItemMemory, 'id' | 'date' | 'category'> = {
                type: 'video', title: finalTitle, description,
                videoDataUrl, transcript, structuredTranscript, ...(location && { location }), tags: tagList,
            };
            onSave(newMemory);
        } else if (mode === 'photo' && imageDataUrl) {
            const newMemory: Omit<PhysicalItemMemory, 'id' | 'date' | 'category'> = {
                type: 'item', title: finalTitle, description,
                imageDataUrl, ...(location && { location }),
                ...(voiceNote.trim() && {
                    voiceNote: {
                        transcript: voiceNote.trim(),
                        audioDataUrl: audioDataUrl || undefined,
                        structuredTranscript: structuredTranscript.length > 0 ? structuredTranscript : undefined
                    }
                }),
                tags: tagList,
            };
            onSave(newMemory);
        }
        onClose();
    };

    const isSaveDisabled = (mode === 'photo' && !imageDataUrl) || (mode === 'video' && !videoDataUrl);
    const canGenerateTitle = !isGeneratingTitle && (
        (mode === 'photo' && !!imageDataUrl) ||
        (mode === 'video' && !!videoDataUrl) ||
        !!description.trim() ||
        !!transcript.trim()
    );

    return (
        <div className="fixed inset-0 bg-black/90 flex flex-col justify-center items-center z-[120] p-4">
            <div className="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col border-4 border-gray-600 overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b-4 border-gray-700 shrink-0 bg-gray-800">
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase"><CameraIcon className="w-8 h-8"/> Item</h2>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={isSaveDisabled}
                            aria-label={isSaveDisabled ? `Save is disabled: capture or choose a ${mode} first` : 'Save item'}
                            title={isSaveDisabled ? `Capture or choose a ${mode} first to enable Save` : 'Save item'}
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
                                    <Image className="w-5 h-5"/> Gallery
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
                               <button
                                   onClick={handleGenerateTitle}
                                   disabled={!canGenerateTitle}
                                   aria-label={isGeneratingTitle ? 'Generating title and description' : canGenerateTitle ? 'Generate title and description with AI' : `Capture a ${mode} first, or type a description, to enable AI generation`}
                                   title={isGeneratingTitle ? 'Generating…' : canGenerateTitle ? 'Generate title and description with AI' : `Capture a ${mode} first, or type a description`}
                                   className="p-4 bg-purple-600 text-white rounded-2xl disabled:bg-gray-700 shadow-lg active:scale-95 transition-all"
                               >
                                   {isGeneratingTitle ? <Loader2Icon className="w-6 h-6 animate-spin"/> : <BrainCircuitIcon className="w-6 h-6"/>}
                               </button>
                            </div>
                        </div>

                        <div>
                            <MiniRecorder 
                                onTranscriptChange={setVoiceNote} 
                                onAudioDataUrlChange={setAudioDataUrl}
                                onStructuredTranscriptChange={setStructuredTranscript}
                            />
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

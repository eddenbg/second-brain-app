import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { DocumentMemory } from '../types';
import { extractTextFromImage, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import QASession from './QASession';
import { ArrowLeftIcon, CameraIcon, UploadIcon, Volume2Icon, Loader2Icon } from './Icons';

interface TemporaryScanViewProps {
    onClose: () => void;
}

const TemporaryScanView: React.FC<TemporaryScanViewProps> = ({ onClose }) => {
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<'camera' | 'ocr' | 'audio' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    
    // Audio State
    const [isPlaying, setIsPlaying] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize AudioContext
    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        return () => {
            audioSourceRef.current?.stop();
            audioContextRef.current?.close();
        };
    }, []);

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    // Cleanup camera on component unmount
    useEffect(() => { return () => stopCamera(); }, [stopCamera]);

    const startCamera = async () => {
        stopCamera();
        setImageDataUrl(null);
        setExtractedText(null);
        setError(null);
        setIsLoading('camera');
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            setStream(mediaStream);
        } catch (err) {
            setError("Could not access camera. Please check permissions.");
        } finally {
            setIsLoading(null);
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
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageDataUrl(e.target?.result as string);
                setExtractedText(null); // Reset text on new image
                stopCamera();
            };
            reader.readAsDataURL(file);
        } else {
            setError('Please select a valid image file.');
        }
    };

    const handleExtractText = useCallback(async () => {
        if (!imageDataUrl) return;
        setIsLoading('ocr');
        setError(null);
        try {
            const base64Data = imageDataUrl.split(',')[1];
            const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
            const text = await extractTextFromImage(base64Data, mimeType);
            setExtractedText(text);
        } catch (e) {
            setError("Failed to extract text from the image.");
            console.error(e);
        } finally {
            setIsLoading(null);
        }
    }, [imageDataUrl]);

    // Automatically extract text when an image is ready
    useEffect(() => {
        if (imageDataUrl && !extractedText) {
            handleExtractText();
        }
    }, [imageDataUrl, extractedText, handleExtractText]);


    const handleReadAloud = async () => {
        if (isLoading === 'audio' || isPlaying || !extractedText) return;
        setIsLoading('audio');
        try {
            const audioB64 = await generateSpeechFromText(extractedText);
            if (audioB64 && audioContextRef.current) {
                const audioData = decode(audioB64);
                const audioBuffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
                
                audioSourceRef.current = audioContextRef.current.createBufferSource();
                audioSourceRef.current.buffer = audioBuffer;
                audioSourceRef.current.connect(audioContextRef.current.destination);
                audioSourceRef.current.onended = () => setIsPlaying(false);
                audioSourceRef.current.start(0);
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Failed to play audio", error);
            setError("Could not generate or play audio.");
        } finally {
            setIsLoading(null);
        }
    };

    const renderInitialState = () => (
        <div className="flex-grow flex flex-col justify-center items-center p-4">
            <div className="w-full max-w-lg aspect-video bg-gray-900 rounded-md flex items-center justify-center relative overflow-hidden border border-gray-700">
                <canvas ref={canvasRef} className="hidden" />
                {stream ? (
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                ) : (
                    <CameraIcon className="w-16 h-16 mx-auto text-gray-500" />
                )}
            </div>
            {stream ? (
                <button onClick={takePicture} className="mt-4 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                    <CameraIcon className="w-6 h-6"/> Take Picture
                </button>
            ) : (
                 <div className="mt-4 flex gap-4 justify-center">
                    <button onClick={startCamera} disabled={isLoading==='camera'} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                       {isLoading==='camera' ? <Loader2Icon className="animate-spin w-5 h-5"/> : <CameraIcon className="w-5 h-5"/>} Open Camera
                    </button>
                     <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                        <UploadIcon className="w-5 h-5"/> Upload Image
                    </button>
                     <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                </div>
            )}
        </div>
    );
    
    const renderResultState = () => {
        const tempDoc: DocumentMemory = {
            id: 'temp',
            type: 'document',
            title: 'Temporary Document',
            date: new Date().toISOString(),
            category: 'college',
            imageDataUrl: imageDataUrl!,
            extractedText: extractedText || '',
        };

        return (
            <div className="flex flex-col h-full">
                <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto mb-4 p-1">
                    <div className="bg-gray-800 rounded-lg p-2 border border-gray-700 flex justify-center items-center">
                        <img src={imageDataUrl} alt="Scanned document" className="max-w-full max-h-full object-contain rounded-md"/>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-y-auto">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-semibold text-gray-300">Extracted Text:</h3>
                            <button onClick={handleReadAloud} disabled={isLoading === 'audio' || isPlaying} className="flex items-center gap-2 px-3 py-1 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:bg-gray-500">
                                {isLoading === 'audio' ? <Loader2Icon className="w-5 h-5 animate-spin"/> : <Volume2Icon className="w-5 h-5"/>}
                                {isLoading === 'audio' ? 'Generating...' : isPlaying ? 'Playing...' : 'Read Aloud'}
                            </button>
                        </div>
                        <p className="text-gray-200 whitespace-pre-wrap">{extractedText}</p>
                    </div>
                </div>
                 <div className="flex-shrink-0">
                     <h3 className="text-lg font-semibold text-gray-300 mb-2 text-center">Ask about this document:</h3>
                    <div className="h-[30vh] border border-gray-700 rounded-lg">
                       <QASession memories={[tempDoc]} />
                    </div>
                </div>
            </div>
        );
    }

    const renderLoadingState = () => (
         <div className="flex-grow flex flex-col justify-center items-center p-4">
             <img src={imageDataUrl || ''} alt="Processing" className="max-h-80 w-auto object-contain rounded-md opacity-50" />
             <div className="mt-4 flex items-center gap-3 text-xl text-gray-300">
                <Loader2Icon className="w-8 h-8 animate-spin"/>
                <p>Extracting text from image...</p>
             </div>
         </div>
    );

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4 flex-shrink-0">
                <button onClick={onClose} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-bold">Quick Scan & Chat</h2>
            </header>
            
            <main className="flex-grow flex flex-col overflow-hidden">
                {error && <p className="text-center text-red-400 p-2 bg-red-900 bg-opacity-50 rounded-md mb-4">{error}</p>}

                {!imageDataUrl && renderInitialState()}
                {imageDataUrl && isLoading === 'ocr' && renderLoadingState()}
                {imageDataUrl && isLoading !== 'ocr' && extractedText !== null && renderResultState()}
            </main>
        </div>
    );
};

export default TemporaryScanView;

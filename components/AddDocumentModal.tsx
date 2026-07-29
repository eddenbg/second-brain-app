
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DocumentMemory } from '../types';
import { generateTitleForContent, extractTextFromImage } from '../services/geminiService';
import { getCurrentLocation } from '../utils/location';
import { XIcon, Loader2Icon, CheckIcon } from './Icons';
import { Camera, SwitchCamera, Image } from 'lucide-react';

interface AddDocumentModalProps {
    course?: string;
    onSave: (memory: Omit<DocumentMemory, 'id'|'date'>) => void;
    onClose: () => void;
}

type Phase = 'inputChoice' | 'camera' | 'processing' | 'done' | 'error';

const AddDocumentModal: React.FC<AddDocumentModalProps> = ({ course, onSave, onClose }) => {
    const [phase, setPhase] = useState<Phase>('inputChoice');
    const [statusMessage, setStatusMessage] = useState('Starting camera…');
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [stream, setStream] = useState<MediaStream | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            setStream(null);
        }
    }, [stream]);

    const startCamera = useCallback(async (facing: 'environment' | 'user') => {
        stopCamera();
        setStatusMessage('Starting camera…');
        try {
            const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
            if (perm.state === 'denied') {
                setPhase('error');
                setStatusMessage("Camera is blocked. Tap the lock icon in your browser's address bar → Permissions → Camera → Allow, then tap \"Try Again\".");
                return;
            }
        } catch {}
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            setStream(s);
            setStatusMessage('Tap anywhere on the preview to capture');
        } catch (err) {
            setPhase('error');
            const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
            setStatusMessage(denied
                ? "Camera access was denied. Tap the lock icon in your browser's address bar → Permissions → Camera → Allow, then tap \"Try Again\"."
                : "Could not open camera. Please check your device and try again.");
        }
    }, []);

    useEffect(() => {
        return () => stopCamera();
    }, [stopCamera]);

    useEffect(() => {
        if (stream && videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    const flipCamera = () => {
        const next = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(next);
        startCamera(next);
    };

    const processImage = async (imageDataUrl: string) => {
        setPhase('processing');
        setStatusMessage('Extracting text…');

        try {
            const base64 = imageDataUrl.split(',')[1];
            const mimeType = imageDataUrl.includes('png') ? 'image/png' : 'image/jpeg';
            const [text, location] = await Promise.all([
                extractTextFromImage(base64, mimeType),
                getCurrentLocation()
            ]);

            setStatusMessage('Generating title…');
            const title = await generateTitleForContent(text || `Document – ${new Date().toLocaleDateString()}`);

            onSave({
                type: 'document',
                title,
                imageDataUrl,
                extractedText: text || '',
                category: course ? 'college' : 'personal',
                course,
                ...(location && { location })
            });

            setPhase('done');
            setStatusMessage('Saved!');
            setTimeout(onClose, 800);
        } catch {
            setPhase('error');
            setStatusMessage('Could not extract text. Try again with better lighting.');
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const imageDataUrl = event.target?.result as string;
            processImage(imageDataUrl);
        };
        reader.readAsDataURL(file);
    };

    const startGalleryUpload = () => {
        fileInputRef.current?.click();
    };

    const capture = async () => {
        if (!videoRef.current || !canvasRef.current || phase !== 'camera') return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        stopCamera();

        await processImage(imageDataUrl);
    };

    return (
        <div className="fixed inset-0 z-[130] bg-black flex flex-col" aria-label="Scan or upload document">
            <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>

            {/* Hidden file input for gallery upload */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                aria-label="Choose image from gallery"
            />

            {/* Full-screen preview */}
            <div className="relative flex-grow bg-black overflow-hidden" onClick={phase === 'camera' && stream ? capture : undefined}>
                <canvas ref={canvasRef} className="hidden" />
                {phase === 'inputChoice' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-[#001F3F] px-6">
                        <div className="text-center space-y-2">
                            <p className="text-white font-black text-3xl uppercase">Scan or Upload</p>
                            <p className="text-gray-300 text-sm">Choose how to add your document</p>
                        </div>

                        <div className="w-full max-w-xs space-y-4">
                            <button
                                onClick={() => { setPhase('camera'); startCamera(facingMode); }}
                                className="w-full py-6 bg-blue-600 hover:bg-blue-500 text-white rounded-3xl font-black text-xl uppercase flex items-center justify-center gap-3 transition-all active:scale-95"
                            >
                                <Camera className="w-6 h-6" strokeWidth={2.5} />
                                Take Photo
                            </button>

                            <button
                                onClick={startGalleryUpload}
                                className="w-full py-6 bg-purple-600 hover:bg-purple-500 text-white rounded-3xl font-black text-xl uppercase flex items-center justify-center gap-3 transition-all active:scale-95"
                            >
                                <Image className="w-6 h-6" strokeWidth={2.5} />
                                Browse Gallery
                            </button>
                        </div>
                    </div>
                ) : phase === 'camera' && stream ? (
                    <>
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        {/* Document frame guide */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-[88%] h-[70%] border-4 border-white/60 rounded-2xl" />
                        </div>
                        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                            <p className="bg-black/60 text-white font-black text-xl px-6 py-3 rounded-full uppercase tracking-wide">
                                Tap to Capture
                            </p>
                        </div>
                    </>
                ) : phase === 'processing' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F]">
                        <Loader2Icon className="w-24 h-24 text-white animate-spin" />
                        <p className="text-white font-black text-2xl uppercase">{statusMessage}</p>
                    </div>
                ) : phase === 'done' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F]">
                        <CheckIcon className="w-24 h-24 text-green-400" />
                        <p className="text-white font-black text-2xl uppercase">Saved!</p>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F] px-8 text-center">
                        <p className="text-white font-black text-2xl uppercase">{statusMessage}</p>
                        <button
                            onClick={() => { setPhase('camera'); startCamera(facingMode); }}
                            className="px-8 py-5 bg-white text-[#001F3F] font-black rounded-2xl text-xl uppercase"
                        >
                            Try Again
                        </button>
                    </div>
                )}
            </div>

            {/* Top controls */}
            {(phase === 'inputChoice' || phase === 'camera') && (
                <div
                    className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 z-10"
                    style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
                >
                    <button
                        onClick={phase === 'inputChoice' ? onClose : () => setPhase('inputChoice')}
                        aria-label={phase === 'inputChoice' ? 'Close' : 'Back to input choice'}
                        className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
                    >
                        <XIcon className="w-8 h-8 text-white" />
                    </button>
                    {phase === 'camera' && (
                        <button
                            onClick={(e) => { e.stopPropagation(); flipCamera(); }}
                            aria-label="Flip camera"
                            className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
                        >
                            <SwitchCamera className="w-8 h-8 text-white" strokeWidth={2.5} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default AddDocumentModal;

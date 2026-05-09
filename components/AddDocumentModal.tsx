
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DocumentMemory } from '../types';
import { generateTitleForContent, extractTextFromImage } from '../services/geminiService';
import { getCurrentLocation } from '../utils/location';
import { XIcon, Loader2Icon, CheckIcon } from './Icons';
import { Camera, SwitchCamera } from 'lucide-react';

interface AddDocumentModalProps {
    course?: string;
    onSave: (memory: Omit<DocumentMemory, 'id'|'date'>) => void;
    onClose: () => void;
}

type Phase = 'camera' | 'processing' | 'done' | 'error';

const AddDocumentModal: React.FC<AddDocumentModalProps> = ({ course, onSave, onClose }) => {
    const [phase, setPhase] = useState<Phase>('camera');
    const [statusMessage, setStatusMessage] = useState('Starting camera…');
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [stream, setStream] = useState<MediaStream | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            setStream(null);
        }
    }, [stream]);

    const startCamera = useCallback(async (facing: 'environment' | 'user') => {
        stopCamera();
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            setStream(s);
            setStatusMessage('Tap anywhere on the preview to capture');
        } catch {
            setStatusMessage('Could not access camera. Please allow camera access and try again.');
        }
    }, []);

    useEffect(() => {
        startCamera(facingMode);
        return () => stopCamera();
    }, []);

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

    const capture = async () => {
        if (!videoRef.current || !canvasRef.current || phase !== 'camera') return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        stopCamera();

        setPhase('processing');
        setStatusMessage('Extracting text…');

        try {
            const base64 = imageDataUrl.split(',')[1];
            const mimeType = 'image/jpeg';
            const [text, location] = await Promise.all([
                extractTextFromImage(base64, mimeType),
                getCurrentLocation()
            ]);

            setStatusMessage('Generating title…');
            const title = await generateTitleForContent(text || `Scanned – ${new Date().toLocaleDateString()}`);

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

    return (
        <div className="fixed inset-0 z-[130] bg-black flex flex-col" aria-label="Scan document">
            <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>

            {/* Full-screen camera preview */}
            <div className="relative flex-grow bg-black overflow-hidden" onClick={phase === 'camera' && stream ? capture : undefined}>
                <canvas ref={canvasRef} className="hidden" />
                {phase === 'camera' && stream ? (
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
            <div
                className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 z-10"
                style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
            >
                <button
                    onClick={onClose}
                    aria-label="Close camera"
                    className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center"
                >
                    <XIcon className="w-8 h-8 text-white" />
                </button>
                {phase === 'camera' && (
                    <button
                        onClick={(e) => { e.stopPropagation(); flipCamera(); }}
                        aria-label="Flip camera"
                        className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center"
                    >
                        <SwitchCamera className="w-8 h-8 text-white" strokeWidth={2.5} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default AddDocumentModal;

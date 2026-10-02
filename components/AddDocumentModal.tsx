
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { DocumentMemory } from '../types';
import { generateTitleForContent, extractTextFromImage } from '../services/geminiService';
import { getCurrentLocation } from '../utils/location';
import { XIcon, Loader2Icon, CheckIcon } from './Icons';
import ReadAloudButton from './ReadAloudButton';
import { Camera, SwitchCamera, Image } from 'lucide-react';
import { prepareImageForOcr, createThumbnail, createThumbnailFromCanvas, splitDataUrl, resizeImage } from '../utils/image';
import { withTimeout, fallbackTitle, isPlaceholderTitle } from '../utils/timeout';

const OCR_TIMEOUT_MS = 60_000;
const TITLE_TIMEOUT_MS = 15_000;
// Saved photo: sharp enough to read, small enough for the cloud (~150–400 KB)
const STORED_PHOTO_MAX_DIM = 1600;
const STORED_PHOTO_QUALITY = 0.65;

interface AddDocumentModalProps {
    course?: string;
    onSave: (memory: Omit<DocumentMemory, 'id'|'date'>) => void | Promise<void>;
    onClose: () => void;
}

type Phase = 'inputChoice' | 'camera' | 'processing' | 'done' | 'error';

const AddDocumentModal: React.FC<AddDocumentModalProps> = ({ course, onSave, onClose }) => {
    const [phase, setPhase] = useState<Phase>('inputChoice');
    const [statusMessage, setStatusMessage] = useState('Starting camera…');
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [stream, setStream] = useState<MediaStream | null>(null);
    // Preview of the photo currently being processed. In-memory only — reset
    // on every new selection.
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    // Text read from the last photo, shown on the "Saved" screen with Read Aloud
    const [savedText, setSavedText] = useState('');
    // Incremented per selection so a slower, older OCR run can't overwrite
    // the result or preview of the photo the user just picked.
    const selectionIdRef = useRef(0);

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

    // The photo is saved with the text (compressed, ~1600px) so you can check
    // the extracted text against the original. A small thumbnail is kept for lists.
    const processImage = async (ocrImageDataUrl: string, thumbnailDataUrl: string | null, selectionId: number) => {
        const isCurrent = () => selectionId === selectionIdRef.current;
        if (!isCurrent()) return;
        setPreviewUrl(ocrImageDataUrl);
        setPhase('processing');
        setStatusMessage('Extracting text…');

        try {
            const { base64, mimeType } = splitDataUrl(ocrImageDataUrl);
            // Compressed copy of the photo to keep alongside the text
            const storedPhoto = await resizeImage(ocrImageDataUrl, STORED_PHOTO_MAX_DIM, STORED_PHOTO_QUALITY).catch(() => null);
            const [text, location] = await Promise.all([
                withTimeout(extractTextFromImage(base64, mimeType), OCR_TIMEOUT_MS),
                getCurrentLocation()
            ]);
            if (!isCurrent()) return;
            if (!text) throw new Error('No text was found in this photo. Make sure the page fills the frame and is in focus.');

            // Title generation is bounded: if the AI is slow or fails we fall
            // back to the first words of the text instead of hanging.
            setStatusMessage('Saving…');
            const title = await withTimeout(generateTitleForContent(text || ''), TITLE_TIMEOUT_MS)
                .then(t => (isPlaceholderTitle(t) ? fallbackTitle(text, 'Document') : t))
                .catch(() => fallbackTitle(text, 'Document'));
            if (!isCurrent()) return;

            try {
            await Promise.resolve(onSave({
                type: 'document',
                source: 'ocr',
                title,
                extractedText: text || '',
                category: course ? 'college' : 'personal',
                course,
                ...(storedPhoto && { imageDataUrl: storedPhoto, fileType: 'image' as const }),
                ...(thumbnailDataUrl && { thumbnailDataUrl, fileType: 'image' as const }),
                ...(location && { location })
            }) as unknown);
            } catch (saveError) {
                console.error('Saving the scan failed', saveError);
                throw new Error('The text was read, but saving failed. Check your connection and try again.');
            }

            setSavedText(text);
            setPhase('done');
            setStatusMessage('Saved!');
        } catch (e: any) {
            if (!isCurrent()) return;
            setPhase('error');
            const reason = e?.name === 'TimeoutError'
                ? 'The AI took too long to answer. Try again.'
                : (e?.message || 'The AI could not read this image.');
            setStatusMessage(reason.startsWith('The text was read') ? reason : `Could not read the text. ${reason}`);
        }
    };

    // Read the newly selected file with a fresh FileReader every time.
    const readFileAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset so onChange fires again even if the same file is picked twice
        e.target.value = '';
        if (!file) return;

        // New selection: drop any previous image/preview before processing
        const selectionId = ++selectionIdRef.current;
        setPreviewUrl(null);
        setPhase('processing');
        setStatusMessage('Reading image…');
        let ocrImage: string;
        let thumbnail: string | null = null;
        try {
            // The full-size data URL only lives inside this function; it is
            // downscaled for OCR and then discarded (never stored).
            const rawDataUrl = await readFileAsDataUrl(file);
            ocrImage = await prepareImageForOcr(rawDataUrl);
            thumbnail = await createThumbnail(ocrImage).catch(() => null);
        } catch {
            if (selectionId !== selectionIdRef.current) return;
            setPhase('error');
            setStatusMessage('Could not read this image. Please choose a different photo.');
            return;
        }
        await processImage(ocrImage, thumbnail, selectionId);
    };

    const startGalleryUpload = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setPreviewUrl(null);
        fileInputRef.current?.click();
    };

    const capture = async () => {
        if (!videoRef.current || !canvasRef.current || phase !== 'camera') return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const ocrImage = canvas.toDataURL('image/jpeg', 0.85);
        let thumbnail: string | null = null;
        try { thumbnail = createThumbnailFromCanvas(canvas); } catch { /* preview is optional */ }
        stopCamera();

        const selectionId = ++selectionIdRef.current;
        await processImage(ocrImage, thumbnail, selectionId);
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
                        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-4 px-4">
                            <button
                                onClick={(e) => { e.stopPropagation(); stopCamera(); startGalleryUpload(); }}
                                aria-label="Choose a photo from the gallery instead"
                                className="flex items-center gap-2 bg-purple-600 text-white font-black text-base px-5 py-3 rounded-full uppercase tracking-wide shadow-xl active:scale-95"
                            >
                                <Image className="w-6 h-6" strokeWidth={2.5} />
                                Gallery
                            </button>
                            <p className="bg-black/60 text-white font-black text-xl px-6 py-3 rounded-full uppercase tracking-wide pointer-events-none">
                                Tap to Capture
                            </p>
                        </div>
                    </>
                ) : phase === 'processing' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F] px-6">
                        {previewUrl && (
                            <img src={previewUrl} alt="Selected photo" className="max-h-[40vh] max-w-full object-contain rounded-2xl border-4 border-white/20" />
                        )}
                        <Loader2Icon className="w-24 h-24 text-white animate-spin" />
                        <p className="text-white font-black text-2xl uppercase">{statusMessage}</p>
                    </div>
                ) : phase === 'done' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F] px-6">
                        {previewUrl && (
                            <img src={previewUrl} alt="Selected photo" className="max-h-[40vh] max-w-full object-contain rounded-2xl border-4 border-white/20" />
                        )}
                        <div className="flex items-center gap-3">
                            <CheckIcon className="w-12 h-12 text-green-400" />
                            <p className="text-white font-black text-2xl uppercase">Saved!</p>
                        </div>
                        {savedText && (
                            <p className="w-full max-w-md max-h-32 overflow-y-auto bg-black/30 rounded-2xl p-4 text-white text-base leading-relaxed whitespace-pre-wrap" dir="auto">
                                {savedText}
                            </p>
                        )}
                        <div className="w-full max-w-md flex flex-col items-center gap-3">
                            {savedText && <ReadAloudButton text={savedText} />}
                            <div className="w-full flex gap-3">
                                <button
                                    onClick={() => { setPreviewUrl(null); setSavedText(''); setPhase('inputChoice'); }}
                                    className="flex-1 py-4 bg-white/10 text-white font-black rounded-2xl text-base uppercase border-2 border-white/20"
                                >
                                    Scan Another
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-4 bg-white text-[#001F3F] font-black rounded-2xl text-base uppercase"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#001F3F] px-8 text-center">
                        {previewUrl && (
                            <img src={previewUrl} alt="The photo that could not be read" className="max-h-[30vh] max-w-full object-contain rounded-2xl border-4 border-white/20" />
                        )}
                        <p className="text-white font-black text-xl" dir="auto">{statusMessage}</p>
                        <div className="w-full max-w-xs flex flex-col gap-3">
                            <button
                                onClick={() => { setPreviewUrl(null); startGalleryUpload(); }}
                                className="w-full py-5 bg-purple-600 text-white font-black rounded-2xl text-lg uppercase flex items-center justify-center gap-3"
                            >
                                <Image className="w-6 h-6" strokeWidth={2.5} />
                                Choose from Gallery
                            </button>
                            <button
                                onClick={() => { setPreviewUrl(null); setPhase('camera'); startCamera(facingMode); }}
                                className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl text-lg uppercase flex items-center justify-center gap-3"
                            >
                                <Camera className="w-6 h-6" strokeWidth={2.5} />
                                Take Photo
                            </button>
                            <button
                                onClick={onClose}
                                className="w-full py-4 bg-white/10 text-white font-black rounded-2xl text-base uppercase"
                            >
                                Close
                            </button>
                        </div>
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
                        onClick={phase === 'inputChoice' ? onClose : () => { stopCamera(); setPhase('inputChoice'); }}
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

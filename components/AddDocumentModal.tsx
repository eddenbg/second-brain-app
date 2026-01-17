
import React, { useState, useEffect, useRef } from 'react';
import type { DocumentMemory } from '../types';
import { generateTitleForContent, extractTextFromImage } from '../services/geminiService';
import { getCurrentLocation } from '../utils/location';
import { generatePDF } from '../services/pdfService';
import { CameraIcon, UploadIcon, SaveIcon, XIcon, BrainCircuitIcon, Loader2Icon, FileTextIcon, CheckIcon } from './Icons';

interface AddDocumentModalProps {
    course?: string; 
    onSave: (memory: Omit<DocumentMemory, 'id'|'date'>) => void;
    onClose: () => void;
}

const AddDocumentModal: React.FC<AddDocumentModalProps> = ({ course, onSave, onClose }) => {
    const [title, setTitle] = useState('');
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [extractedText, setExtractedText] = useState('');
    const [isLoading, setIsLoading] = useState<'camera'|'ocr'|'title'|null>(null);
    const [error, setError] = useState<string|null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [statusMessage, setStatusMessage] = useState(''); 
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    
    const stopCamera = React.useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => { return () => { stopCamera(); }; }, [stopCamera]);

    useEffect(() => {
        if (extractedText && titleInputRef.current) {
            titleInputRef.current.focus();
        }
    }, [extractedText]);

    const startCamera = async () => {
        stopCamera();
        setImageDataUrl(null);
        setError(null);
        setIsLoading('camera');
        setStatusMessage("Starting camera...");
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            setStream(mediaStream);
            setStatusMessage("Camera started.");
        } catch (err) { 
            setError("Could not access camera."); 
            setStatusMessage("Error: Could not access camera.");
        }
        finally { setIsLoading(null); }
    };

    useEffect(() => { if (stream && videoRef.current) { videoRef.current.srcObject = stream; } }, [stream]);

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
            setStatusMessage("Picture taken.");
        }
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageDataUrl(e.target?.result as string);
                stopCamera();
                setStatusMessage("Image uploaded.");
            };
            reader.readAsDataURL(file);
        } else {
            setError('Please select a valid image file.');
        }
    };

    const handleExtractText = async () => {
        if (!imageDataUrl) return;
        setIsLoading('ocr');
        setError(null);
        setStatusMessage("Extracting Hebrew and English text from image...");
        try {
            const base64Data = imageDataUrl.split(',')[1];
            const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
            const text = await extractTextFromImage(base64Data, mimeType);
            setExtractedText(text);
            setStatusMessage("Text extracted successfully.");
            
            // Auto-generate title if empty
            if (!title) {
                const generatedTitle = await generateTitleForContent(text);
                setTitle(generatedTitle);
            }
        } catch (e) { 
            setError("Text extraction failed. You can still save the image or try again."); 
            setStatusMessage("Error extracting text.");
        }
        finally { setIsLoading(null); }
    };
    
    const handleGenerateTitle = async () => {
        if (!extractedText.trim()) return;
        setIsLoading('title');
        setTitle(await generateTitleForContent(extractedText));
        setIsLoading(null);
        setStatusMessage("Title generated.");
    };

    const handleSave = async () => {
        if (!imageDataUrl) return;
        
        // Use default title if none provided
        const finalTitle = title.trim() || `Scanned Doc - ${new Date().toLocaleDateString()}`;
        const finalContent = extractedText.trim() || "No text extracted yet.";
        
        const location = await getCurrentLocation();
        onSave({ 
            type: 'document', 
            title: finalTitle, 
            imageDataUrl, 
            extractedText: finalContent, 
            category: course ? 'college' : 'personal',
            course, 
            ...(location && { location }) 
        });
        onClose();
    };

    const isSaveDisabled = !imageDataUrl;

    return (
        <div className="fixed inset-0 bg-black/90 flex flex-col justify-center items-center z-[130] p-4">
             <div className="bg-gray-800 rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col border-4 border-gray-600 overflow-hidden">
                <header className="flex justify-between items-center p-6 border-b-4 border-gray-700 shrink-0 bg-gray-800">
                    <h2 className="text-xl font-black text-white flex items-center gap-3 uppercase">
                        <FileTextIcon className="w-8 h-8"/> SCAN DOCUMENT
                    </h2>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={handleSave} 
                            disabled={isSaveDisabled} 
                            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-black rounded-xl text-sm uppercase shadow-xl disabled:bg-gray-700 active:scale-95 transition-all"
                        >
                            <SaveIcon className="w-5 h-5"/> SAVE
                        </button>
                        <button onClick={onClose} className="p-3 bg-gray-700 rounded-2xl active:scale-90 transition-transform"><XIcon className="w-6 h-6"/></button>
                    </div>
                </header>
                
                <div role="status" aria-live="polite" className="sr-only">
                    {statusMessage}
                </div>

                <div className="flex-grow overflow-y-auto p-6 space-y-6 scroll-smooth">
                    {extractedText || isLoading === 'ocr' ? (
                        <div className="space-y-6">
                            <div className="w-full bg-gray-900 rounded-2xl p-2 border border-gray-700 flex justify-center items-center shadow-inner">
                                <img src={imageDataUrl || ''} className="max-h-48 object-contain rounded-xl"/>
                            </div>
                             
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Document Name</label>
                                <div className="flex gap-2">
                                    <input 
                                        ref={titleInputRef}
                                        type="text" 
                                        value={title} 
                                        onChange={e => setTitle(e.target.value)} 
                                        placeholder="Enter Title" 
                                        className="flex-grow bg-gray-900 text-white text-base p-4 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-bold shadow-inner"
                                    />
                                    <button onClick={handleGenerateTitle} className="p-4 bg-purple-600 text-white rounded-2xl shadow-lg active:scale-95">
                                        {isLoading === 'title' ? <Loader2Icon className="w-6 h-6 animate-spin"/> : <BrainCircuitIcon className="w-6 h-6"/>}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Extracted Content</label>
                                {isLoading === 'ocr' ? (
                                    <div className="w-full bg-gray-900 p-10 rounded-2xl border-2 border-gray-700 flex flex-col items-center justify-center gap-4 text-blue-400">
                                        <Loader2Icon className="w-10 h-10 animate-spin" />
                                        <p className="font-black uppercase tracking-widest text-xs">Analyzing Layout & Hebrew Text...</p>
                                    </div>
                                ) : (
                                    <textarea 
                                        value={extractedText} 
                                        onChange={e => setExtractedText(e.target.value)} 
                                        rows={8} 
                                        className="w-full bg-gray-900 text-white text-sm p-5 rounded-2xl border-2 border-gray-700 outline-none focus:border-blue-600 font-medium leading-relaxed shadow-inner"
                                    />
                                )}
                            </div>
                        </div>
                    ) : imageDataUrl ? (
                        <div className="space-y-6 text-center">
                            <div className="rounded-[2rem] overflow-hidden border-2 border-gray-700 shadow-2xl">
                                <img src={imageDataUrl} className="w-full max-h-80 object-contain bg-black" />
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button onClick={() => setImageDataUrl(null)} className="flex-1 py-4 bg-gray-700 text-white font-black rounded-2xl uppercase text-xs">Retake</button>
                                <button onClick={handleExtractText} disabled={isLoading === 'ocr'} className="flex-grow py-4 bg-blue-600 text-white font-black rounded-2xl uppercase text-xs shadow-lg flex items-center justify-center gap-3">
                                     {isLoading === 'ocr' ? <Loader2Icon className="animate-spin w-5 h-5"/> : <BrainCircuitIcon className="w-5 h-5"/>}
                                     Extract Text
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 text-center">
                            <div className="w-full aspect-square bg-gray-900 rounded-[2.5rem] flex items-center justify-center relative overflow-hidden border-2 border-gray-700 shadow-inner">
                                <canvas ref={canvasRef} className="hidden" />
                                {stream ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                    : <CameraIcon className="w-24 h-24 mx-auto text-gray-500" />
                                }
                            </div>
                            {stream ? (
                                <button onClick={takePicture} className="px-10 py-5 bg-blue-600 text-white font-black rounded-2xl uppercase text-sm shadow-xl active:scale-95 transition-all">
                                    CAPTURE
                                </button>
                            ) : (
                                 <div className="flex gap-3">
                                    <button onClick={startCamera} className="flex-1 py-4 bg-gray-700 text-white font-black rounded-2xl uppercase text-xs flex items-center justify-center gap-2">
                                       <CameraIcon className="w-5 h-5"/> Camera
                                    </button>
                                     <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-4 bg-gray-700 text-white font-black rounded-2xl uppercase text-xs flex items-center justify-center gap-2">
                                        <UploadIcon className="w-5 h-5"/> File
                                    </button>
                                     <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                                </div>
                            )}
                        </div>
                    )}
                    {error && <p className="text-center text-red-400 font-bold p-3 bg-red-900/20 rounded-xl">{error}</p>}
                </div>

                <footer className="p-4 bg-gray-800 border-t-2 border-gray-700 shrink-0 text-center">
                    <button onClick={onClose} className="text-gray-500 font-black uppercase text-xs tracking-widest">Cancel Scan</button>
                </footer>
            </div>
        </div>
    );
};

export default AddDocumentModal;

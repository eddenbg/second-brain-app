
import React, { useState, useEffect, useRef } from 'react';
import type { DocumentMemory } from '../types';
import { generateTitleForContent, extractTextFromImage } from '../services/geminiService';
import { getCurrentLocation } from '../utils/location';
import { generatePDF } from '../services/pdfService';
import { CameraIcon, UploadIcon, SaveIcon, XIcon, BrainCircuitIcon, Loader2Icon, FileTextIcon, CheckIcon } from './Icons';

interface AddDocumentModalProps {
    course?: string; // Optional: If provided, saves to college category
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
    const [statusMessage, setStatusMessage] = useState(''); // For accessibility announcements
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const stopCamera = React.useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => { return () => { stopCamera(); }; }, [stopCamera]);

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
            setError("Could not access camera. Please check permissions."); 
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
            setStatusMessage("Picture taken. Ready to extract text.");
        }
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageDataUrl(e.target?.result as string);
                stopCamera();
                setStatusMessage("Image uploaded. Ready to extract text.");
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
        setStatusMessage("Extracting text using OCR. Please wait...");
        try {
            const base64Data = imageDataUrl.split(',')[1];
            const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
            const text = await extractTextFromImage(base64Data, mimeType);
            setExtractedText(text);
            setStatusMessage("Text extracted successfully. Please review.");
        } catch (e) { 
            setError("Failed to extract text."); 
            setStatusMessage("Error: Failed to extract text.");
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
        if (!imageDataUrl || !title.trim() || !extractedText.trim()) return;
        const location = await getCurrentLocation();
        onSave({ 
            type: 'document', 
            title, 
            imageDataUrl, 
            extractedText, 
            category: course ? 'college' : 'personal',
            course, 
            ...(location && { location }) 
        });
        onClose();
    };

    const handleDownloadPDF = () => {
        if (title && extractedText && imageDataUrl) {
            generatePDF(title, extractedText, imageDataUrl);
            setStatusMessage("PDF downloaded.");
        }
    }

    const renderContent = () => {
        if (extractedText) {
             return (
                <div className="space-y-4">
                     <div className="w-full bg-gray-800 rounded-lg p-2 border border-gray-700 flex justify-center items-center relative">
                        <img src={imageDataUrl || ''} alt="Scanned document source" className="max-h-60 object-contain rounded-md"/>
                     </div>
                     
                     <div className="flex flex-col gap-2">
                           <label htmlFor="doc-title" className="text-sm font-semibold text-gray-300">Name your document:</label>
                           <div className="flex gap-2">
                               <input 
                                    id="doc-title"
                                    type="text" 
                                    value={title} 
                                    onChange={e => setTitle(e.target.value)} 
                                    placeholder="e.g. Utility Bill - Oct 2023" 
                                    className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                               />
                               <button onClick={handleGenerateTitle} disabled={isLoading === 'title'} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2 flex-shrink-0">
                                   <BrainCircuitIcon className="w-5 h-5"/> {isLoading === 'title' ? '...' : 'Auto Name'}
                               </button>
                           </div>
                    </div>
                     <textarea 
                        value={extractedText} 
                        onChange={e => setExtractedText(e.target.value)} 
                        rows={8} 
                        className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600"
                        aria-label="Extracted Text"
                     />
                     
                     <button onClick={handleDownloadPDF} disabled={!title} className="w-full py-2 bg-gray-700 border border-gray-500 hover:bg-gray-600 rounded text-white font-semibold">
                        Download as PDF
                     </button>
                </div>
            )
        }
        if (imageDataUrl) {
            return (
                <div className="space-y-4 text-center">
                    <img src={imageDataUrl} alt="Preview" className="max-h-96 w-full object-contain rounded-md" />
                    <div className="flex gap-4 justify-center">
                        <button onClick={() => setImageDataUrl(null)} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Retake</button>
                        <button onClick={handleExtractText} disabled={isLoading === 'ocr'} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-500 flex items-center gap-2">
                             {isLoading === 'ocr' ? <Loader2Icon className="animate-spin w-4 h-4"/> : <BrainCircuitIcon className="w-4 h-4"/>}
                             {isLoading === 'ocr' ? 'Extracting...' : 'Extract Text (OCR)'}
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="space-y-4 text-center">
                <div className="w-full aspect-video bg-gray-900 rounded-md flex items-center justify-center relative overflow-hidden border border-gray-700">
                    <canvas ref={canvasRef} className="hidden" />
                    {stream ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        : <CameraIcon className="w-16 h-16 mx-auto text-gray-500" />
                    }
                </div>
                {stream ? (
                    <button onClick={takePicture} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto">
                        <CameraIcon className="w-5 h-5"/> Take Picture
                    </button>
                ) : (
                     <div className="flex gap-4 justify-center">
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
        )
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
             <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-600">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <FileTextIcon className="w-6 h-6"/> 
                        {course ? `Add Document to ${course}` : 'Scan Document'}
                    </h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                
                {/* Live Status Region for Accessibility */}
                <div role="status" aria-live="polite" className="sr-only">
                    {statusMessage}
                </div>

                <div className="flex-grow overflow-y-auto bg-gray-800 p-4">
                    {renderContent()}
                </div>
                {extractedText && (
                    <div className="p-4 flex flex-col items-end border-t border-gray-700 bg-gray-800 rounded-b-lg">
                        <div className="text-gray-400 text-sm mb-2">
                            Saving to: <span className="text-white font-bold bg-gray-700 px-2 py-1 rounded">{course ? course : 'Personal Notes'}</span>
                        </div>
                        <button onClick={handleSave} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                            <SaveIcon className="w-6 h-6"/> Save Document
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AddDocumentModal;

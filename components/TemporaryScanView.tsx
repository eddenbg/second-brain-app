import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { DocumentMemory } from '../types';
import { extractTextFromImage, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getStoredDriveUploadToken, connectGoogleDriveUpload, uploadFileToDrive } from '../services/googleDriveService';
import { getStoredNotionToken, searchNotionPages, createScanPage } from '../services/notionService';
import type { NotionPage } from '../services/notionService';
import QASession from './QASession';
import { ArrowLeftIcon, CameraIcon, UploadIcon, Volume2Icon, Loader2Icon, DownloadIcon } from './Icons';

interface TemporaryScanViewProps {
    onClose: () => void;
}

const TemporaryScanView: React.FC<TemporaryScanViewProps> = ({ onClose }) => {
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<'camera' | 'ocr' | 'audio' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);

    // Audio state
    const [isPlaying, setIsPlaying] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    // Export state
    const [isExporting, setIsExporting] = useState(false);
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const [driveLink, setDriveLink] = useState<string | null>(null);
    const [driveUploadToken, setDriveUploadToken] = useState<string | null>(null);
    const [showNotionPicker, setShowNotionPicker] = useState(false);
    const [notionPages, setNotionPages] = useState<NotionPage[]>([]);
    const [isLoadingNotionPages, setIsLoadingNotionPages] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        setDriveUploadToken(getStoredDriveUploadToken());
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
        } catch {
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
            setImageDataUrl(canvas.toDataURL('image/jpeg'));
            stopCamera();
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageDataUrl(e.target?.result as string);
                setExtractedText(null);
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
        } catch {
            setError("Failed to extract text from the image.");
        } finally {
            setIsLoading(null);
        }
    }, [imageDataUrl]);

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
        } catch {
            setError("Could not generate or play audio.");
        } finally {
            setIsLoading(null);
        }
    };

    const buildPDFBlob = useCallback(async (): Promise<Blob> => {
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const W = pdf.internal.pageSize.getWidth();
        const H = pdf.internal.pageSize.getHeight();
        const m = 10;
        pdf.addImage(imageDataUrl!, 'JPEG', m, m, W - 2 * m, H - 2 * m);
        if (extractedText) {
            pdf.addPage();
            pdf.setFontSize(11);
            const lines = pdf.splitTextToSize(extractedText, W - 2 * m);
            pdf.text(lines, m, m + 6);
        }
        return pdf.output('blob');
    }, [imageDataUrl, extractedText]);

    const handleDownloadPDF = useCallback(async () => {
        if (!imageDataUrl) return;
        setIsExporting(true);
        setExportError(null);
        setExportStatus(null);
        try {
            const blob = await buildPDFBlob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `scan-${new Date().toISOString().slice(0, 10)}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            setExportStatus('PDF downloaded!');
        } catch {
            setExportError('Failed to generate PDF.');
        } finally {
            setIsExporting(false);
        }
    }, [imageDataUrl, buildPDFBlob]);

    const handleSaveToDrive = useCallback(async () => {
        if (!imageDataUrl) return;
        setIsExporting(true);
        setExportError(null);
        setExportStatus(null);
        setDriveLink(null);
        try {
            let token = driveUploadToken;
            if (!token) {
                token = await connectGoogleDriveUpload();
                setDriveUploadToken(token);
            }
            const blob = await buildPDFBlob();
            const link = await uploadFileToDrive(token!, `scan-${Date.now()}.pdf`, blob);
            setExportStatus('Saved to Drive!');
            setDriveLink(link);
        } catch (e: any) {
            setExportError(e.message || 'Drive upload failed.');
            setDriveUploadToken(null);
        } finally {
            setIsExporting(false);
        }
    }, [imageDataUrl, buildPDFBlob, driveUploadToken]);

    const handleOpenNotionPicker = async () => {
        const token = getStoredNotionToken();
        if (!token) { setExportError('Connect Notion in Settings first.'); return; }
        setExportError(null);
        setExportStatus(null);
        setShowNotionPicker(true);
        setIsLoadingNotionPages(true);
        try {
            const pages = await searchNotionPages(token, '');
            setNotionPages(pages);
        } catch {
            setExportError('Could not load Notion pages.');
            setShowNotionPicker(false);
        } finally {
            setIsLoadingNotionPages(false);
        }
    };

    const handleSaveToNotion = async (parentPageId: string) => {
        const token = getStoredNotionToken();
        if (!token) return;
        setShowNotionPicker(false);
        setIsExporting(true);
        setExportError(null);
        setExportStatus(null);
        try {
            const title = `Scan — ${new Date().toLocaleDateString()}`;
            const url = await createScanPage(token, title, extractedText || '(No text extracted)', parentPageId);
            setExportStatus('Saved to Notion!');
            setDriveLink(url);
        } catch (e: any) {
            setExportError(e.message || 'Notion save failed.');
        } finally {
            setIsExporting(false);
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
                    <button onClick={startCamera} disabled={isLoading === 'camera'} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                        {isLoading === 'camera' ? <Loader2Icon className="animate-spin w-5 h-5"/> : <CameraIcon className="w-5 h-5"/>} Open Camera
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                        <UploadIcon className="w-5 h-5"/> Upload Image
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                </div>
            )}
            <p className="mt-4 text-xs text-gray-500 text-center">Supports printed and handwritten Hebrew &amp; English</p>
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
        const notionToken = getStoredNotionToken();

        return (
            <div className="flex flex-col h-full">
                <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto mb-4 p-1">
                    <div className="bg-gray-800 rounded-lg p-2 border border-gray-700 flex justify-center items-center">
                        <img src={imageDataUrl || undefined} alt="Scanned document" className="max-w-full max-h-full object-contain rounded-md"/>
                    </div>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-y-auto flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-gray-300">Extracted Text</h3>
                            <button onClick={handleReadAloud} disabled={isLoading === 'audio' || isPlaying} className="flex items-center gap-2 px-3 py-1 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:bg-gray-500 text-sm">
                                {isLoading === 'audio' ? <Loader2Icon className="w-4 h-4 animate-spin"/> : <Volume2Icon className="w-4 h-4"/>}
                                {isLoading === 'audio' ? 'Generating…' : isPlaying ? 'Playing…' : 'Read Aloud'}
                            </button>
                        </div>
                        <p className="text-gray-200 whitespace-pre-wrap text-sm flex-grow" dir="auto">{extractedText}</p>

                        {/* Export section */}
                        <div className="border-t border-gray-700 pt-3 space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Export</p>
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={handleDownloadPDF}
                                    disabled={isExporting}
                                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    <DownloadIcon className="w-4 h-4"/> PDF
                                </button>
                                <button
                                    onClick={handleSaveToDrive}
                                    disabled={isExporting}
                                    className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {isExporting ? <Loader2Icon className="w-4 h-4 animate-spin"/> : <UploadIcon className="w-4 h-4"/>}
                                    {driveUploadToken ? 'Save to Drive' : 'Connect & Save to Drive'}
                                </button>
                                <button
                                    onClick={handleOpenNotionPicker}
                                    disabled={isExporting || !notionToken}
                                    title={notionToken ? 'Save to Notion' : 'Connect Notion in Settings first'}
                                    className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-40"
                                >
                                    <span className="font-black text-sm leading-none">N</span>
                                    {notionToken ? 'Save to Notion' : 'Notion (connect first)'}
                                </button>
                            </div>

                            {isExporting && !exportStatus && (
                                <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2Icon className="w-3 h-3 animate-spin"/> Working…</p>
                            )}
                            {exportStatus && (
                                <p className="text-xs text-green-400 flex items-center gap-2">
                                    {exportStatus}
                                    {driveLink && <a href={driveLink} target="_blank" rel="noopener noreferrer" className="underline text-blue-400">Open</a>}
                                </p>
                            )}
                            {exportError && <p className="text-xs text-red-400">{exportError}</p>}

                            {showNotionPicker && (
                                <div className="bg-gray-900 rounded-lg p-3 border border-gray-600 space-y-2">
                                    <p className="text-xs text-gray-400 font-semibold">Save under which Notion page?</p>
                                    {isLoadingNotionPages ? (
                                        <Loader2Icon className="w-5 h-5 animate-spin text-gray-400"/>
                                    ) : notionPages.length > 0 ? (
                                        <div className="space-y-1 max-h-44 overflow-y-auto">
                                            {notionPages.map(page => (
                                                <button
                                                    key={page.id}
                                                    onClick={() => handleSaveToNotion(page.id)}
                                                    className="w-full text-left text-xs text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg truncate"
                                                >
                                                    {page.title}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">No pages found. Share pages with your Notion integration.</p>
                                    )}
                                    <button onClick={() => setShowNotionPicker(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                                </div>
                            )}
                        </div>
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
    };

    const renderLoadingState = () => (
        <div className="flex-grow flex flex-col justify-center items-center p-4">
            <img src={imageDataUrl || ''} alt="Processing" className="max-h-80 w-auto object-contain rounded-md opacity-50" />
            <div className="mt-4 flex items-center gap-3 text-xl text-gray-300">
                <Loader2Icon className="w-8 h-8 animate-spin"/>
                <p>Extracting text from image…</p>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4 flex-shrink-0">
                <button onClick={onClose} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-bold">Quick Scan &amp; Chat</h2>
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

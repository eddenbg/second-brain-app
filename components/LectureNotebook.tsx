
import React, { useState, useRef, useEffect } from 'react';
import type { NotebookData, DrawingStroke, StrokePoint } from '../types';
import { PenToolIcon, EraserIcon, FilePlusIcon, TrashIcon, XIcon, CheckIcon, Loader2Icon } from './Icons';
import { extractHandwritingFromImage } from '../services/geminiService';

interface LectureNotebookProps {
    onUpdate: (data: NotebookData) => void;
    initialData?: NotebookData;
    startTime: number;
    isRecording: boolean;
    courseMaterials?: { title: string; url: string }[];
}

const LectureNotebook: React.FC<LectureNotebookProps> = ({ onUpdate, initialData, startTime, isRecording, courseMaterials }) => {
    const [strokes, setStrokes] = useState<DrawingStroke[]>(initialData?.strokes || []);
    const [tool, setTool] = useState<'pen' | 'eraser' | 'lasso'>('pen');
    const [showMaterialPicker, setShowMaterialPicker] = useState(false);
    const [bgImage, setBgImage] = useState<string | undefined>(initialData?.backgroundImageUrl);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [showTextModal, setShowTextModal] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef<DrawingStroke | null>(null);
    const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);

    // Fixed blue color for visibility (better for low vision)
    const PEN_COLOR = '#60A5FA';
    const ERASER_COLOR = '#1f2937';
    const PEN_WIDTH = 3;
    const ERASER_WIDTH = 20;
    const LASSO_COLOR = '#FBBF24';

    // Sync notebook data with parent
    useEffect(() => {
        onUpdate({ strokes, backgroundImageUrl: bgImage });
    }, [strokes, bgImage, onUpdate]);

    // Redraw canvas when strokes change
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            strokes.forEach(stroke => {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                stroke.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.stroke();
            });
        }
    }, [strokes]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return;

        const pos = getPos(e);
        isDrawingRef.current = true;
        const timestamp = Date.now() - startTime;

        if (tool === 'lasso') {
            lassoPointsRef.current = [pos];
        } else {
            currentStrokeRef.current = {
                color: tool === 'pen' ? PEN_COLOR : ERASER_COLOR,
                width: tool === 'pen' ? PEN_WIDTH : ERASER_WIDTH,
                points: [{ ...pos, t: timestamp }]
            };

            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = currentStrokeRef.current.color;
                ctx.lineWidth = currentStrokeRef.current.width;
            }
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current || !canvasRef.current) return;

        const pos = getPos(e);
        const timestamp = Date.now() - startTime;

        if (tool === 'lasso') {
            lassoPointsRef.current.push(pos);
            // Draw lasso preview
            const ctx = canvasRef.current.getContext('2d');
            if (ctx && lassoPointsRef.current.length > 1) {
                const prev = lassoPointsRef.current[lassoPointsRef.current.length - 2];
                ctx.strokeStyle = LASSO_COLOR;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(prev.x, prev.y);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (currentStrokeRef.current) {
            currentStrokeRef.current.points.push({ ...pos, t: timestamp });
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            }
        }
    };

    const stopDrawing = () => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;

        if (tool === 'lasso' && lassoPointsRef.current.length > 0) {
            // Handle lasso selection - convert enclosed area to text
            convertLassoAreaToText();
            lassoPointsRef.current = [];
        } else if (currentStrokeRef.current) {
            setStrokes(prev => [...prev, currentStrokeRef.current!]);
            currentStrokeRef.current = null;
        }
    };

    const convertLastStrokeToText = async () => {
        if (strokes.length === 0) {
            setExtractedText("No strokes to convert. Start drawing first.");
            setShowTextModal(true);
            return;
        }

        setIsExtracting(true);
        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Get just the last stroke and convert it
            const lastStroke = strokes[strokes.length - 1];
            const imageData = canvas.toDataURL('image/png');
            const base64 = imageData.split(',')[1];

            const text = await extractHandwritingFromImage(base64);
            setExtractedText(text);
            setShowTextModal(true);
        } catch (error) {
            console.error('Conversion error:', error);
            setExtractedText("Error converting. Please try again.");
            setShowTextModal(true);
        } finally {
            setIsExtracting(false);
        }
    };

    const convertLassoAreaToText = async () => {
        if (lassoPointsRef.current.length < 3) return;

        setIsExtracting(true);
        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Crop to lasso area and convert
            const points = lassoPointsRef.current;
            const xs = points.map(p => p.x);
            const ys = points.map(p => p.y);
            const minX = Math.max(0, Math.min(...xs) - 10);
            const minY = Math.max(0, Math.min(...ys) - 10);
            const maxX = Math.min(canvas.width, Math.max(...xs) + 10);
            const maxY = Math.min(canvas.height, Math.max(...ys) + 10);

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = maxX - minX;
            cropCanvas.height = maxY - minY;
            const cropCtx = cropCanvas.getContext('2d');
            if (cropCtx) {
                cropCtx.drawImage(canvas, minX, minY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
                const base64 = cropCanvas.toDataURL('image/png').split(',')[1];
                const text = await extractHandwritingFromImage(base64);
                setExtractedText(text);
                setShowTextModal(true);
            }
        } catch (error) {
            console.error('Lasso conversion error:', error);
            setExtractedText("Error with lasso conversion.");
            setShowTextModal(true);
        } finally {
            setIsExtracting(false);
        }
    };

    const clearCanvas = () => {
        if (window.confirm("Clear all notes?")) {
            setStrokes([]);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx && canvas) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 rounded-2xl overflow-hidden border-2 border-gray-700">
            {/* Simplified Toolbar */}
            <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700 shrink-0">
                <div className="flex gap-3">
                    <button
                        onClick={() => setTool('pen')}
                        className={`px-4 py-2 rounded-xl transition-all font-bold uppercase tracking-wider ${
                            tool === 'pen' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
                        }`}
                        aria-label="Pen Tool"
                    >
                        ✏️ Pen
                    </button>
                    <button
                        onClick={() => setTool('eraser')}
                        className={`px-4 py-2 rounded-xl transition-all font-bold uppercase tracking-wider ${
                            tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
                        }`}
                        aria-label="Eraser Tool"
                    >
                        🧹 Erase
                    </button>
                    <button
                        onClick={() => setTool('lasso')}
                        className={`px-4 py-2 rounded-xl transition-all font-bold uppercase tracking-wider ${
                            tool === 'lasso' ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400'
                        }`}
                        aria-label="Lasso Selection Tool"
                        title="Draw a box to select area for text conversion"
                    >
                        📦 Select
                    </button>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={convertLastStrokeToText}
                        disabled={isExtracting || strokes.length === 0}
                        className="px-4 py-2 rounded-xl bg-green-700 text-green-100 hover:bg-green-600 disabled:bg-gray-600 disabled:text-gray-400 font-bold text-sm uppercase tracking-wider flex items-center gap-2"
                        aria-label="Convert last stroke to text"
                        title="Convert your last handwritten word to text"
                    >
                        {isExtracting ? <Loader2Icon className="w-5 h-5 animate-spin" /> : '📝'}
                        <span className="hidden sm:inline">Word</span>
                    </button>
                    <button
                        onClick={() => setShowMaterialPicker(true)}
                        className="px-4 py-2 rounded-xl bg-purple-700 text-purple-100 hover:bg-purple-600 font-bold text-sm uppercase tracking-wider"
                        aria-label="Import PDF slides"
                    >
                        📄
                    </button>
                    <button
                        onClick={clearCanvas}
                        className="px-4 py-2 rounded-xl bg-red-700 text-red-100 hover:bg-red-600 font-bold text-sm uppercase tracking-wider"
                        aria-label="Clear Notebook"
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {/* Drawing Surface */}
            <div className="flex-grow flex bg-[#1f2937] overflow-hidden">
                {bgImage && (
                    <div className="w-2/5 overflow-y-auto border-r border-gray-700 bg-black/40 p-3">
                        <img src={bgImage} className="w-full rounded-lg object-cover" alt="Lecture Slide" />
                        <button
                            onClick={() => setBgImage(undefined)}
                            className="mt-3 w-full py-2 px-4 bg-red-900/40 text-red-300 rounded-lg text-sm font-bold hover:bg-red-900/60"
                        >
                            Clear PDF
                        </button>
                    </div>
                )}

                <div className={`relative ${bgImage ? 'flex-1' : 'w-full'}`}>
                    <canvas
                        ref={canvasRef}
                        width={1200}
                        height={1600}
                        className="w-full h-full touch-none cursor-crosshair"
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        aria-label="Drawing canvas for lecture notes"
                    />
                </div>
            </div>

            {/* Material Picker Modal */}
            {showMaterialPicker && (
                <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center p-6 rounded-2xl">
                    <div className="bg-gray-800 rounded-3xl w-full max-w-sm p-6 border-4 border-gray-700 space-y-6">
                        <h3 className="text-xl font-black text-white">IMPORT SLIDES</h3>
                        <div className="space-y-3 max-h-60 overflow-y-auto">
                            {courseMaterials?.length ? (
                                courseMaterials.map(m => (
                                    <button
                                        key={m.url}
                                        onClick={() => { setBgImage(m.url); setShowMaterialPicker(false); }}
                                        className="w-full text-left p-4 bg-gray-700 rounded-2xl hover:bg-gray-600 text-white font-bold"
                                    >
                                        {m.title}
                                    </button>
                                ))
                            ) : (
                                <p className="text-gray-500 italic">No materials found</p>
                            )}
                        </div>
                        <button onClick={() => setShowMaterialPicker(false)} className="w-full py-3 bg-gray-700 text-white font-bold rounded-2xl">
                            CLOSE
                        </button>
                    </div>
                </div>
            )}

            {/* Extracted Text Modal */}
            {showTextModal && (
                <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center p-6">
                    <div className="bg-gray-800 rounded-3xl w-full max-w-2xl max-h-96 p-6 border-4 border-gray-700 space-y-4 flex flex-col">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-black text-white">Extracted Text</h3>
                            <button onClick={() => setShowTextModal(false)} className="p-2 hover:bg-gray-700 rounded-lg">
                                <XIcon className="w-6 h-6 text-gray-400" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-gray-900 p-4 rounded-2xl border-2 border-gray-700">
                            <p className="text-white whitespace-pre-wrap leading-relaxed text-lg">
                                {extractedText}
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    if (extractedText) {
                                        navigator.clipboard.writeText(extractedText);
                                        alert("Text copied!");
                                    }
                                }}
                                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 uppercase"
                            >
                                Copy
                            </button>
                            <button
                                onClick={() => setShowTextModal(false)}
                                className="flex-1 py-3 bg-gray-700 text-white font-bold rounded-2xl hover:bg-gray-600 uppercase"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!isRecording && strokes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                    <p className="text-4xl font-black text-white rotate-[-15deg]">LECTURE NOTEBOOK</p>
                </div>
            )}
        </div>
    );
};

export default React.memo(LectureNotebook);

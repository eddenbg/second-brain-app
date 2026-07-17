
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { NotebookData, DrawingStroke, StrokePoint } from '../types';
import { PenToolIcon, EraserIcon, FilePlusIcon, TrashIcon, XIcon, CheckIcon, Loader2Icon } from './Icons';
import { extractHandwritingFromImage } from '../services/geminiService';

interface LectureNotebookProps {
    onUpdate: (data: NotebookData) => void;
    initialData?: NotebookData;
    startTime: number; // Date.now() when recording started
    isRecording: boolean;
    courseMaterials?: { title: string; url: string }[];
}

const LectureNotebook: React.FC<LectureNotebookProps> = ({ onUpdate, initialData, startTime, isRecording, courseMaterials }) => {
    const [strokes, setStrokes] = useState<DrawingStroke[]>(initialData?.strokes || []);
    const [color, setColor] = useState('#60A5FA');
    const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
    const [showMaterialPicker, setShowMaterialPicker] = useState(false);
    const [bgImage, setBgImage] = useState<string | undefined>(initialData?.backgroundImageUrl);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [showTextModal, setShowTextModal] = useState(false);
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef<DrawingStroke | null>(null);

    // Sync up state with outer component
    useEffect(() => {
        onUpdate({ strokes, backgroundImageUrl: bgImage });
    }, [strokes, bgImage, onUpdate]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        // Account for scale
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        const pos = getPos(e);
        isDrawingRef.current = true;
        
        const timestamp = Date.now() - startTime;
        
        currentStrokeRef.current = {
            color: tool === 'pen' ? color : '#1f2937', // Match bg color for eraser
            width: tool === 'pen' ? 3 : 20,
            points: [{ ...pos, t: timestamp }]
        };

        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineCap = 'round';
            ctx.strokeStyle = currentStrokeRef.current.color;
            ctx.lineWidth = currentStrokeRef.current.width;
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current || !currentStrokeRef.current) return;
        
        const pos = getPos(e);
        const timestamp = Date.now() - startTime;
        
        currentStrokeRef.current.points.push({ ...pos, t: timestamp });
        
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }
    };

    const stopDrawing = () => {
        if (!isDrawingRef.current || !currentStrokeRef.current) return;
        isDrawingRef.current = false;
        setStrokes(prev => [...prev, currentStrokeRef.current!]);
        currentStrokeRef.current = null;
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

    const convertHandwritingToText = async () => {
        if (!canvasRef.current || strokes.length === 0) {
            setExtractedText("No notes to convert. Start drawing first.");
            setShowTextModal(true);
            return;
        }

        setIsExtracting(true);
        try {
            const canvas = canvasRef.current;
            const imageData = canvas.toDataURL('image/png');
            // Extract base64 data without the data:image/png;base64, prefix
            const base64 = imageData.split(',')[1];

            const text = await extractHandwritingFromImage(base64);
            setExtractedText(text);
            setShowTextModal(true);
        } catch (error) {
            console.error('Conversion error:', error);
            setExtractedText("Error converting handwriting to text. Please try again.");
            setShowTextModal(true);
        } finally {
            setIsExtracting(false);
        }
    };

    // Redraw if background changes or on initial mount
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
                stroke.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.stroke();
            });
        }
    }, [strokes]);

    return (
        <div className="flex flex-col h-full bg-gray-900 rounded-2xl overflow-hidden border-2 border-gray-700">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-2 bg-gray-800 border-b border-gray-700 shrink-0">
                <div className="flex gap-2">
                    <button 
                        onClick={() => setTool('pen')}
                        className={`p-3 rounded-xl transition-all ${tool === 'pen' ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-700'}`}
                        aria-label="Pen Tool"
                    >
                        <PenToolIcon className="w-6 h-6" />
                    </button>
                    <button 
                        onClick={() => setTool('eraser')}
                        className={`p-3 rounded-xl transition-all ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'text-gray-400 bg-gray-700'}`}
                        aria-label="Eraser Tool"
                    >
                        <EraserIcon className="w-6 h-6" />
                    </button>
                    <div className="w-px h-8 bg-gray-600 self-center mx-1"></div>
                    {['#60A5FA', '#F87171', '#34D399', '#FBBF24', '#FFFFFF'].map(c => (
                        <button 
                            key={c}
                            onClick={() => { setColor(c); setTool('pen'); }}
                            className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c && tool === 'pen' ? 'scale-125 border-white shadow-lg' : 'border-transparent'}`}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>
                
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowMaterialPicker(true)}
                        className="p-3 rounded-xl bg-gray-700 text-purple-400 hover:text-purple-300"
                        aria-label="Import Moodle Materials"
                    >
                        <FilePlusIcon className="w-6 h-6" />
                    </button>
                    <button
                        onClick={convertHandwritingToText}
                        disabled={isExtracting || strokes.length === 0}
                        className="px-4 py-3 rounded-xl bg-blue-700 text-blue-100 hover:bg-blue-600 disabled:bg-gray-600 disabled:text-gray-400 font-bold text-sm uppercase tracking-wider flex items-center gap-2"
                        aria-label="Convert notes to text"
                    >
                        {isExtracting ? <Loader2Icon className="w-5 h-5 animate-spin" /> : '📝'}
                        <span className="hidden sm:inline">Convert</span>
                    </button>
                    <button
                        onClick={clearCanvas}
                        className="p-3 rounded-xl bg-gray-700 text-red-400 hover:text-red-300"
                        aria-label="Clear Notebook"
                    >
                        <TrashIcon className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* Drawing Surface - Split Layout (PDF + Canvas) */}
            <div className="flex-grow flex bg-[#1f2937]">
                {/* Left: PDF/Slide Preview (if bgImage selected) */}
                {bgImage && (
                    <div className="w-2/5 overflow-y-auto border-r border-gray-700 bg-black/40 p-3">
                        <img
                            src={bgImage}
                            className="w-full rounded-lg object-cover"
                            alt="Lecture Slide Background"
                        />
                        <button
                            onClick={() => setBgImage(undefined)}
                            className="mt-3 w-full py-2 px-4 bg-red-900/40 text-red-300 rounded-lg text-sm font-bold hover:bg-red-900/60"
                        >
                            Clear PDF Background
                        </button>
                    </div>
                )}

                {/* Right: Drawing Canvas (always full width if no PDF, else 55%) */}
                <div className={`relative ${bgImage ? 'flex-1' : 'w-full'}`}>
                    <canvas
                        ref={canvasRef}
                        width={1200}
                        height={1600}
                        className="w-full h-full touch-none"
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                    />
                </div>
            </div>

            {/* Material Picker Modal (Simulating Moodle Docs) */}
            {showMaterialPicker && (
                <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center p-6">
                    <div className="bg-gray-800 rounded-3xl w-full max-w-sm p-6 border-4 border-gray-700 space-y-6">
                        <h3 className="text-xl font-black text-white flex items-center gap-2">
                            <FilePlusIcon className="w-6 h-6 text-purple-400" />
                            IMPORT FROM MOODLE
                        </h3>
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                            {courseMaterials?.length ? courseMaterials.map(m => (
                                <button 
                                    key={m.url}
                                    onClick={() => { setBgImage(m.url); setShowMaterialPicker(false); }}
                                    className="w-full text-left p-4 bg-gray-700 rounded-2xl hover:bg-gray-600 text-white font-bold flex justify-between"
                                >
                                    <span className="truncate">{m.title}</span>
                                    <CheckIcon className="w-5 h-5 text-green-400" />
                                </button>
                            )) : (
                                <p className="text-gray-500 italic">No Moodle materials found for this course.</p>
                            )}
                            {/* Manual Upload simulation */}
                            <button 
                                onClick={() => setShowMaterialPicker(false)}
                                className="w-full p-4 bg-indigo-900/30 text-indigo-300 rounded-2xl border-2 border-indigo-700 font-bold"
                            >
                                + Upload New PDF/Slide
                            </button>
                        </div>
                        <button onClick={() => setShowMaterialPicker(false)} className="w-full py-4 bg-gray-700 text-white font-bold rounded-2xl">CLOSE</button>
                    </div>
                </div>
            )}
            
            {!isRecording && strokes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                    <p className="text-4xl font-black text-white rotate-[-15deg]">SYNCED LECTURE NOTEBOOK</p>
                </div>
            )}

            {/* Extracted Text Modal */}
            {showTextModal && (
                <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center p-6 rounded-2xl">
                    <div className="bg-gray-800 rounded-3xl w-full max-w-2xl max-h-96 p-6 border-4 border-gray-700 space-y-4 flex flex-col">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-black text-white">Extracted Text</h3>
                            <button
                                onClick={() => setShowTextModal(false)}
                                className="p-2 hover:bg-gray-700 rounded-lg"
                            >
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
                                        alert("Text copied to clipboard!");
                                    }
                                }}
                                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 uppercase tracking-wider"
                            >
                                Copy Text
                            </button>
                            <button
                                onClick={() => setShowTextModal(false)}
                                className="flex-1 py-3 bg-gray-700 text-white font-bold rounded-2xl hover:bg-gray-600 uppercase tracking-wider"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LectureNotebook;

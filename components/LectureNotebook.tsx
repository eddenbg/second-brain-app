
import React, { useState, useRef, useEffect } from 'react';
import type { NotebookData, DrawingStroke, StrokePoint } from '../types';
import { PenToolIcon, EraserIcon, FilePlusIcon, TrashIcon, XIcon, CheckIcon, Loader2Icon } from './Icons';
import ConfirmationModal from './ConfirmationModal';
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
    const [tool, setTool] = useState<'pen' | 'eraser' | 'lasso' | 'rectangle' | 'circle' | 'line'>('pen');
    const [showMaterialPicker, setShowMaterialPicker] = useState(false);
    const [bgImage, setBgImage] = useState<string | undefined>(initialData?.backgroundImageUrl);
    const [extractedText, setExtractedText] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [showTextModal, setShowTextModal] = useState(false);
    const [textAnnotations, setTextAnnotations] = useState<Array<{ text: string; x: number; y: number; id: string }>>([]);
    const [hasLassoSelection, setHasLassoSelection] = useState(false);
    const [lastLassoSelection, setLastLassoSelection] = useState<{ x: number; y: number; minX: number; minY: number; maxX: number; maxY: number } | null>(null);;
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Undo/Redo stacks
    const [undoStack, setUndoStack] = useState<DrawingStroke[][]>([]);
    const [redoStack, setRedoStack] = useState<DrawingStroke[][]>([]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef<DrawingStroke | null>(null);
    const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
    const eraserPositionsRef = useRef<{ x: number; y: number }[]>([]);
    const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
    const SNAP_GRID = 10; // Snap to 10px grid

    // Fixed white color for better contrast against blue background
    const PEN_COLOR = '#FFFFFF';
    const PEN_WIDTH = 3;
    const ERASER_WIDTH = 20;
    const LASSO_COLOR = '#FBBF24';
    const SHAPE_COLOR = '#FFFFFF';
    const SHAPE_WIDTH = 2;

    const snapToGrid = (value: number, gridSize: number = SNAP_GRID): number => {
        return Math.round(value / gridSize) * gridSize;
    };

    // Sync notebook data with parent
    useEffect(() => {
        onUpdate({ strokes, backgroundImageUrl: bgImage });
    }, [strokes, bgImage, onUpdate]);

    // Handle canvas resize to match container size
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resizeCanvas = () => {
            const parent = canvas.parentElement;
            if (!parent) return;

            const rect = parent.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            // Set canvas resolution to match display size
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);

            // Scale context to account for device pixel ratio
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.scale(dpr, dpr);
            }
        };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, []);

    // Redraw canvas when strokes or text annotations change
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw strokes
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

            // Draw text annotations
            textAnnotations.forEach((annotation: { text: string; x: number; y: number; id: string }) => {
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 24px Arial, sans-serif';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeText(annotation.text, annotation.x, annotation.y);
                ctx.fillText(annotation.text, annotation.x, annotation.y);
            });
        }
    }, [strokes, textAnnotations]);

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
        } else if (tool === 'eraser') {
            eraserPositionsRef.current = [pos];
        } else if (['rectangle', 'circle', 'line'].includes(tool)) {
            shapeStartRef.current = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
        } else {
            currentStrokeRef.current = {
                color: PEN_COLOR,
                width: PEN_WIDTH,
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

    const drawShapePreview = (startPos: { x: number; y: number }, endPos: { x: number; y: number }, shapeType: string) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Redraw everything first
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

        // Draw shape preview
        const snapX = snapToGrid(endPos.x);
        const snapY = snapToGrid(endPos.y);
        const width = snapX - startPos.x;
        const height = snapY - startPos.y;

        ctx.strokeStyle = SHAPE_COLOR;
        ctx.lineWidth = SHAPE_WIDTH;

        if (shapeType === 'rectangle') {
            ctx.strokeRect(startPos.x, startPos.y, width, height);
        } else if (shapeType === 'circle') {
            const radius = Math.sqrt(width * width + height * height) / 2;
            ctx.beginPath();
            ctx.arc(startPos.x + width / 2, startPos.y + height / 2, radius, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (shapeType === 'line') {
            ctx.beginPath();
            ctx.moveTo(startPos.x, startPos.y);
            ctx.lineTo(snapX, snapY);
            ctx.stroke();
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
        } else if (tool === 'eraser') {
            eraserPositionsRef.current.push(pos);
        } else if (['rectangle', 'circle', 'line'].includes(tool) && shapeStartRef.current) {
            drawShapePreview(shapeStartRef.current, pos, tool);
        } else if (currentStrokeRef.current) {
            currentStrokeRef.current.points.push({ ...pos, t: timestamp });
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            }
        }
    };

    const stopDrawing = (e?: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;

        if (tool === 'lasso' && lassoPointsRef.current.length > 0) {
            // Handle lasso selection - just mark that selection is active
            const points = lassoPointsRef.current;
            const xs = points.map(p => p.x);
            const ys = points.map(p => p.y);
            const minX = Math.max(0, Math.min(...xs) - 10);
            const minY = Math.max(0, Math.min(...ys) - 10);
            const maxX = Math.max(...xs) + 10;
            const maxY = Math.max(...ys) + 10;

            setLastLassoSelection({ x: minX, y: minY, minX, minY, maxX, maxY });
            setHasLassoSelection(true);
            lassoPointsRef.current = [];
        } else if (tool === 'eraser' && eraserPositionsRef.current.length > 0) {
            // Batch eraser updates - only update state once when erasing stops
            const eraserRadius = ERASER_WIDTH / 2;
            const positions = eraserPositionsRef.current;
            setStrokes(prev => {
                const updated = prev.filter(stroke => {
                    return !stroke.points.some(p =>
                        positions.some(pos => Math.hypot(p.x - pos.x, p.y - pos.y) < eraserRadius)
                    );
                });
                if (updated.length < prev.length) {
                    setUndoStack(undoStack => [...undoStack, prev]);
                    setRedoStack([]);
                }
                return updated;
            });
            eraserPositionsRef.current = [];
        } else if (['rectangle', 'circle', 'line'].includes(tool) && shapeStartRef.current && e) {
            // Create shape stroke
            const endPos = getPos(e);
            const snapX = snapToGrid(endPos.x);
            const snapY = snapToGrid(endPos.y);
            const startPos = shapeStartRef.current;
            const timestamp = Date.now() - startTime;

            let shapePoints: StrokePoint[] = [];

            if (tool === 'rectangle') {
                // Create rectangle outline as points
                shapePoints = [
                    { x: startPos.x, y: startPos.y, t: timestamp },
                    { x: snapX, y: startPos.y, t: timestamp },
                    { x: snapX, y: snapY, t: timestamp },
                    { x: startPos.x, y: snapY, t: timestamp },
                    { x: startPos.x, y: startPos.y, t: timestamp }
                ];
            } else if (tool === 'circle') {
                // Create circle as points
                const centerX = startPos.x + (snapX - startPos.x) / 2;
                const centerY = startPos.y + (snapY - startPos.y) / 2;
                const radius = Math.sqrt(
                    Math.pow(snapX - startPos.x, 2) + Math.pow(snapY - startPos.y, 2)
                ) / 2;
                for (let i = 0; i <= 360; i += 10) {
                    const angle = (i * Math.PI) / 180;
                    shapePoints.push({
                        x: centerX + radius * Math.cos(angle),
                        y: centerY + radius * Math.sin(angle),
                        t: timestamp
                    });
                }
            } else if (tool === 'line') {
                shapePoints = [
                    { x: startPos.x, y: startPos.y, t: timestamp },
                    { x: snapX, y: snapY, t: timestamp }
                ];
            }

            if (shapePoints.length > 0) {
                const newStroke: DrawingStroke = {
                    color: SHAPE_COLOR,
                    width: SHAPE_WIDTH,
                    points: shapePoints
                };

                setStrokes(prev => {
                    const newStrokes = [...prev, newStroke];
                    setRedoStack([]);
                    setUndoStack(undoStack => [...undoStack, prev]);
                    return newStrokes;
                });
            }

            shapeStartRef.current = null;
        } else if (currentStrokeRef.current) {
            setStrokes(prev => {
                const newStrokes = [...prev, currentStrokeRef.current!];
                // Clear redo stack when new stroke is added
                setRedoStack([]);
                // Add previous state to undo stack
                setUndoStack(undoStack => [...undoStack, prev]);
                return newStrokes;
            });
            currentStrokeRef.current = null;
        }
    };

    const convertLastStrokeToText = async () => {
        if (strokes.length === 0) {
            alert("No strokes to convert. Start drawing first.");
            return;
        }

        setIsExtracting(true);
        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Get just the last stroke's bounding box
            const lastStroke = strokes[strokes.length - 1];
            if (lastStroke.points.length === 0) return;

            const xs = lastStroke.points.map(p => p.x);
            const ys = lastStroke.points.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);

            // Crop around the stroke
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = Math.max(maxX - minX + 20, 100);
            cropCanvas.height = Math.max(maxY - minY + 20, 50);
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) return;

            cropCtx.drawImage(
                canvas,
                Math.max(minX - 10, 0), Math.max(minY - 10, 0),
                cropCanvas.width, cropCanvas.height,
                0, 0, cropCanvas.width, cropCanvas.height
            );

            const base64 = cropCanvas.toDataURL('image/png').split(',')[1];
            const text = await extractHandwritingFromImage(base64);

            // Add text annotation to canvas at the stroke location
            setTextAnnotations((prev: { text: string; x: number; y: number; id: string }[]) => [...prev, {
                text: text.trim(),
                x: minX,
                y: maxY + 30,
                id: Date.now().toString()
            }]);
        } catch (error) {
            console.error('Conversion error:', error);
            alert("Error converting. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    const convertLassoAreaToText = async () => {
        if (!lastLassoSelection) return;

        setIsExtracting(true);
        try {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const { minX, minY, maxX, maxY } = lastLassoSelection;

            // Crop to lasso area and convert
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = maxX - minX;
            cropCanvas.height = maxY - minY;
            const cropCtx = cropCanvas.getContext('2d');
            if (cropCtx) {
                cropCtx.drawImage(canvas, minX, minY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
                const base64 = cropCanvas.toDataURL('image/png').split(',')[1];
                const text = await extractHandwritingFromImage(base64);

                // Add text annotation at the selected area (replace handwriting)
                setTextAnnotations((prev: { text: string; x: number; y: number; id: string }[]) => [...prev, {
                    text: text.trim(),
                    x: minX,
                    y: minY + (cropCanvas.height / 2),
                    id: Date.now().toString()
                }]);

                // Clear the selected area and reset selection
                setHasLassoSelection(false);
                setLastLassoSelection(null);
            }
        } catch (error) {
            console.error('Lasso conversion error:', error);
            alert("Error converting handwriting to text.");
        } finally {
            setIsExtracting(false);
        }
    };

    const clearCanvas = () => {
        setShowClearConfirm(true);
    };

    const handleClearConfirm = () => {
        setStrokes([]);
        setUndoStack([]);
        setRedoStack([]);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        setShowClearConfirm(false);
    };

    const handleUndo = () => {
        if (strokes.length === 0) return;
        const newUndoStack = [...undoStack, strokes];
        const newStrokes = strokes.slice(0, -1);
        setUndoStack(newUndoStack);
        setRedoStack([]);
        setStrokes(newStrokes);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const lastRedo = redoStack[redoStack.length - 1];
        setUndoStack([...undoStack, strokes]);
        setRedoStack(redoStack.slice(0, -1));
        setStrokes(lastRedo);
    };

    return (
        <div className="flex flex-col h-full bg-[#001F3F] overflow-hidden">
            {/* Top Toolbar - Samsung Notes Style */}
            <div className="flex items-center gap-2 p-3 bg-black/60 backdrop-blur border-b border-white/10 shrink-0">
                {/* Drawing Tools */}
                <button
                    onClick={() => { setTool('pen'); setHasLassoSelection(false); }}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'pen' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Pen Tool"
                    title="Draw with pen"
                >
                    ✏️
                </button>
                <button
                    onClick={() => { setTool('eraser'); setHasLassoSelection(false); }}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Eraser Tool"
                    title="Erase"
                >
                    🧹
                </button>

                {/* Shape Tools */}
                <button
                    onClick={() => { setTool('rectangle'); setHasLassoSelection(false); }}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'rectangle' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Rectangle Tool"
                    title="Draw rectangle (snaps to grid)"
                >
                    ⬜
                </button>
                <button
                    onClick={() => { setTool('circle'); setHasLassoSelection(false); }}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'circle' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Circle Tool"
                    title="Draw circle (snaps to grid)"
                >
                    ⭕
                </button>
                <button
                    onClick={() => { setTool('line'); setHasLassoSelection(false); }}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'line' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Line Tool"
                    title="Draw line (snaps to grid)"
                >
                    📏
                </button>

                <button
                    onClick={() => setTool('lasso')}
                    className={`p-2 rounded-lg transition-all ${
                        tool === 'lasso'
                            ? hasLassoSelection
                                ? 'bg-green-600 text-white shadow-lg ring-2 ring-green-400'
                                : 'bg-yellow-600 text-white shadow-lg ring-2 ring-yellow-400'
                            : 'bg-gray-700 text-gray-300 hover:bg-yellow-600/30 hover:text-yellow-400'
                    }`}
                    aria-label={hasLassoSelection ? "Convert selection to text" : "Lasso Selection Tool - Convert handwriting to text"}
                    title={hasLassoSelection ? "Tap to convert selected handwriting to text" : "Draw lasso around handwriting to select"}
                >
                    {hasLassoSelection && tool === 'lasso' ? '📝' : '◯'}
                </button>

                {/* Divider */}
                <div className="w-px h-6 bg-gray-600 mx-1"></div>

                {/* Undo/Redo */}
                <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className="p-2 rounded-lg transition-all bg-gray-700 text-gray-400 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Undo"
                    title="Undo"
                >
                    ↶
                </button>
                <button
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="p-2 rounded-lg transition-all bg-gray-700 text-gray-400 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Redo"
                    title="Redo"
                >
                    ↷
                </button>

                {/* Text Conversion Button - appears after lasso selection */}
                {hasLassoSelection && (
                    <>
                        <div className="w-px h-6 bg-gray-600 mx-1"></div>
                        <button
                            onClick={convertLassoAreaToText}
                            disabled={isExtracting}
                            className="px-3 py-2 rounded-lg transition-all bg-green-600 text-white hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg"
                            aria-label="Convert selection to text"
                            title="Convert handwriting to text (Hebrew + English)"
                        >
                            {isExtracting ? <Loader2Icon className="w-5 h-5 animate-spin" /> : '🎯'}
                            {isExtracting ? 'Converting...' : 'CONVERT'}
                        </button>
                    </>
                )}

                <div className="flex-1" />
            </div>

            {/* Drawing Surface - Full Screen Canvas */}
            <div className="flex-1 flex overflow-hidden">
                {bgImage && isRecording && (
                    <div className="w-1/3 overflow-y-auto border-r border-gray-700 bg-black/40 p-2">
                        <img src={bgImage} className="w-full rounded-lg object-cover" alt="Lecture Slide" />
                        <button
                            onClick={() => setBgImage(undefined)}
                            className="mt-2 w-full py-1 px-2 bg-red-900/40 text-red-300 rounded-lg text-xs font-bold hover:bg-red-900/60"
                        >
                            Clear PDF
                        </button>
                    </div>
                )}

                <div className={`relative ${bgImage ? 'flex-1' : 'w-full'}`} style={{ display: 'flex' }}>
                    <canvas
                        ref={canvasRef}
                        className="w-full h-full touch-none cursor-crosshair"
                        style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={(e) => stopDrawing(e)}
                        onMouseLeave={() => stopDrawing()}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={(e) => stopDrawing(e)}
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


            {showClearConfirm && (
                <ConfirmationModal
                    title="Clear Notes"
                    message="Are you sure you want to clear all notes? This cannot be undone."
                    confirmText="Clear"
                    cancelText="Cancel"
                    isDangerous={true}
                    onConfirm={handleClearConfirm}
                    onCancel={() => setShowClearConfirm(false)}
                />
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

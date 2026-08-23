
import React, { useState, useRef, useEffect } from 'react';
import type { NotebookData, DrawingStroke, StrokePoint } from '../types';
import { PenToolIcon, EraserIcon, FilePlusIcon, TrashIcon, XIcon, CheckIcon, Loader2Icon } from './Icons';
import ConfirmationModal from './ConfirmationModal';
import { extractHandwritingFromImage } from '../services/geminiService';

/** A dashed lasso loop with a hanging rope end, distinct from a plain round
 *  outline at a glance. */
const LassoGlyph: React.FC = () => (
    <svg
        width="44"
        height="44"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
    >
        <ellipse cx="10" cy="7.5" rx="7" ry="5" strokeDasharray="3 2.5" />
        <path d="M6.5 12.2 L6.5 16" />
        <circle cx="6.5" cy="17.2" r="1.3" fill="currentColor" stroke="none" />
    </svg>
);

/** Shared sizing for every toolbar button: a large square tap target with a
 *  large glyph inside it. The user is legally blind and reported the previous
 *  small square buttons (~32px) as much too hard to see — this roughly
 *  quadruples the tap target. There is plenty of unused horizontal room above
 *  the canvas on a tablet, so this does not risk wrapping to a second row or
 *  overflowing a ~2000px-wide landscape screen.
 *
 *  `text-5xl` sizes the text/emoji glyphs (Undo/Redo's ↶ ↷); it was bumped up
 *  from `text-4xl` (36px -> 48px) after further feedback that the button
 *  backgrounds were big enough but the glyph drawn on top of them still read
 *  too small. The SVG tool icons (pen, eraser, lasso) are sized directly via
 *  their own width/height props instead, since an SVG's size isn't driven by
 *  font-size. */
const TOOLBAR_BUTTON_SIZE = 'w-20 h-20 flex items-center justify-center text-5xl shrink-0';
/** Explicit pixel size for the SVG tool icons inside a TOOLBAR_BUTTON_SIZE
 *  button — deliberately close to the button's own 80px so the glyph reads
 *  as bold and unmissable rather than lost in the middle of the tap target. */
const TOOLBAR_SVG_ICON_SIZE = 44;

type Point2D = { x: number; y: number };

const HOLD_SNAP_MS = 200;
const HOLD_MOVE_TOLERANCE = 5; // CSS px the pen may drift and still count as "held"

/**
 * The CSS spec's own reference-pixel definition: 96px = 1 real inch,
 * regardless of the device's actual physical density. Every coordinate this
 * file works with — stroke points, the hold-tolerance above, shape geometry
 * below — is already in that same CSS-pixel space (see getPos()'s note on
 * why devicePixelRatio must NOT be reapplied to it), so this conversion is a
 * real cm-to-px estimate with no extra dpr factor needed.
 */
const CSS_PX_PER_CM = 96 / 2.54; // ~37.8 CSS px per centimeter

/** extractHandwritingFromImage resolves with a sentinel string instead of
 *  throwing, so a failure has to be recognised from the returned text. */
const EXTRACTION_FAILURE_PREFIXES = [
    'No text found',
    'Error extracting',
    'AI features are currently unavailable',
];

const pathLength = (points: Point2D[]): number => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
};

const perpendicularDistance = (p: Point2D, a: Point2D, b: Point2D): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};

// Ramer-Douglas-Peucker: reduces a traced outline to its corners.
const simplifyPath = (points: Point2D[], epsilon: number): Point2D[] => {
    if (points.length < 3) return [...points];

    const first = points[0];
    const last = points[points.length - 1];
    let maxDistance = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const distance = perpendicularDistance(points[i], first, last);
        if (distance > maxDistance) {
            maxDistance = distance;
            index = i;
        }
    }

    if (maxDistance <= epsilon) return [first, last];

    const left = simplifyPath(points.slice(0, index + 1), epsilon);
    const right = simplifyPath(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
};

const ellipseOutline = (cx: number, cy: number, rx: number, ry: number): Point2D[] => {
    const points: Point2D[] = [];
    for (let angle = 0; angle <= 360; angle += 10) {
        const radians = (angle * Math.PI) / 180;
        points.push({ x: cx + rx * Math.cos(radians), y: cy + ry * Math.sin(radians) });
    }
    return points;
};

/**
 * Recognise a rough freehand stroke as a clean primitive, or return null.
 *
 * Every test is deliberately strict: snapping the wrong thing destroys notes
 * the user cannot easily redraw, so an unrecognised stroke is left untouched.
 */
const recognizeShape = (points: Point2D[]): Point2D[] | null => {
    if (points.length < 8) return null;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const diagonal = Math.hypot(width, height);
    if (diagonal < 40) return null; // too small to be a deliberate shape

    const first = points[0];
    const last = points[points.length - 1];
    const gap = Math.hypot(last.x - first.x, last.y - first.y);
    const traced = pathLength(points);

    // How far the stroke's end point may land from its start and still count
    // as "closed". A quarter of the shape's own diagonal is generous for a
    // large shape, but for a smaller one (e.g. a hand-sized triangle) that
    // quarter-diagonal can shrink to well under a centimeter, which is what
    // user testing reported as needing near-pixel-perfect precision to close.
    // Flooring it at ~1cm guarantees a real fingertip's worth of slack no
    // matter how small the shape is, while the relative term still grows the
    // allowance further for bigger shapes.
    const closeTolerance = Math.max(diagonal * 0.25, CSS_PX_PER_CM);

    if (gap > closeTolerance) {
        // Open stroke: only a straight line qualifies, and it must not wander
        // off its own chord or double back on itself.
        const deviation = points.reduce((worst, p) => Math.max(worst, perpendicularDistance(p, first, last)), 0);
        if (gap > 30 && deviation < Math.max(4, gap * 0.06) && traced < gap * 1.15) {
            return [{ x: first.x, y: first.y }, { x: last.x, y: last.y }];
        }
        return null;
    }

    if (width < 25 || height < 25) return null;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = width / 2;
    const ry = height / 2;

    // Circle / ellipse: every point sits at the same normalised radius.
    const radii = points.map(p => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry));
    const meanRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    const spread = Math.sqrt(radii.reduce((sum, r) => sum + (r - meanRadius) ** 2, 0) / radii.length);
    if (meanRadius > 0.85 && meanRadius < 1.15 && spread < 0.12) {
        return ellipseOutline(cx, cy, rx, ry);
    }

    // Rectangle: nearly every point lies on the bounding box outline.
    const edgeTolerance = Math.max(6, Math.min(width, height) * 0.12);
    const onEdge = points.filter(p =>
        Math.min(Math.abs(p.x - minX), Math.abs(p.x - maxX)) <= edgeTolerance ||
        Math.min(Math.abs(p.y - minY), Math.abs(p.y - maxY)) <= edgeTolerance
    ).length;
    if (onEdge / points.length > 0.9) {
        return [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
            { x: minX, y: minY },
        ];
    }

    // Triangle: the closed outline reduces to exactly three corners.
    let corners = simplifyPath([...points, first], diagonal * 0.06).slice(0, -1);
    if (corners.length === 4) {
        // Strokes usually start mid-edge, which leaves an extra "corner" that is
        // collinear with the two real ones on either side of it.
        if (perpendicularDistance(corners[0], corners[3], corners[1]) < diagonal * 0.08) {
            corners = corners.slice(1);
        }
    }
    if (corners.length === 3) {
        const [a, b, c] = corners;
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        if (area > width * height * 0.3) {
            return [a, b, c, a].map(p => ({ x: p.x, y: p.y }));
        }
    }

    return null;
};

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
    const holdTimerRef = useRef<number | null>(null);
    const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
    const dprRef = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const cssSizeRef = useRef({ width: 0, height: 0 });
    // Lets the resize handler repaint without depending on state it cannot see.
    const redrawAllRef = useRef<(() => void) | null>(null);

    // Fixed white color for better contrast against blue background
    const PEN_COLOR = '#FFFFFF';
    const PEN_WIDTH = 3;
    const ERASER_WIDTH = 20;
    const LASSO_COLOR = '#FBBF24';

    // Sync notebook data with parent
    useEffect(() => {
        // Omit the key entirely when there is no background: Firestore rejects a
        // document containing undefined and fails the whole save.
        const { width, height } = cssSizeRef.current;
        const base = width && height
            ? { strokes, canvasWidth: width, canvasHeight: height }
            : { strokes };
        onUpdate(bgImage ? { ...base, backgroundImageUrl: bgImage } : base);
    }, [strokes, bgImage, onUpdate]);

    // Handle canvas resize to match container size
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resizeCanvas = () => {
            const parent = canvas.parentElement;
            if (!parent) return;

            const rect = parent.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const dpr = window.devicePixelRatio || 1;
            dprRef.current = dpr;
            cssSizeRef.current = { width: rect.width, height: rect.height };

            // Backing store in device pixels for sharpness; everything we draw is
            // then expressed in CSS pixels via the transform below. Assigning
            // width/height resets the transform, so it must be set afterwards.
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;

            const ctx = canvas.getContext('2d');
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            redrawAllRef.current?.();
        };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', resizeCanvas);

        // The notebook opens inside a container that is still being laid out, so
        // the first measurement can be wrong. Watch the element instead of
        // measuring once.
        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => resizeCanvas())
            : null;
        if (observer && canvas.parentElement) observer.observe(canvas.parentElement);

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            window.removeEventListener('orientationchange', resizeCanvas);
            observer?.disconnect();
        };
    }, []);

    // Redraw canvas when strokes or text annotations change
    useEffect(() => {
        const redrawAll = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) {
            // Clear in device space, then work in CSS pixels again. Clearing with
            // the CSS-pixel transform still applied would leave the bottom-right
            // of the backing store untouched on a high-DPI screen.
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const dpr = dprRef.current;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
        };

        redrawAllRef.current = redrawAll;
        redrawAll();
    }, [strokes, textAnnotations]);

    /**
     * Pointer position in CSS pixels — the same space the canvas transform uses.
     *
     * This used to multiply by canvas.width / rect.width, which is exactly the
     * device pixel ratio, on top of a context already scaled by that ratio. Every
     * coordinate was therefore scaled twice: on a 2x tablet a stroke landed four
     * times away from the pen, which is why drawing did not follow the stylus.
     *
     * Pointer Events unify mouse/touch/pen into a single clientX/clientY shape,
     * so this stays position-only — pressure is read separately by the caller.
     */
    const getPos = (e: React.PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();

        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    };

    /**
     * Pen tool line width, scaled by S Pen pressure.
     *
     * Only real styluses (`pointerType === 'pen'`) report a meaningful 0-1
     * pressure value — mouse reports 0 and touch reports a flat 0.5, neither of
     * which reflects intentional force, so both fall back to the fixed width to
     * keep mouse/touch drawing identical to before this feature existed.
     *
     * Chosen per-stroke (sampled once at pointerdown) rather than per-point:
     * it reads naturally for handwriting-width variation without adding a new
     * field to the shared StrokePoint type in types.ts, which this task must
     * not touch while other agents are editing sibling components concurrently.
     */
    const getPenStrokeWidth = (pointerType: string, pressure: number): number => {
        if (pointerType !== 'pen') return PEN_WIDTH;
        const clampedPressure = Math.min(1, Math.max(0, pressure));
        return PEN_WIDTH * (0.5 + clampedPressure);
    };

    const clearHoldSnap = () => {
        if (holdTimerRef.current !== null) {
            window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
        holdAnchorRef.current = null;
    };

    /** Fires when the pen has been held still: if the stroke drawn so far looks
     *  like a primitive, replace it with a clean one and finish the stroke. */
    const snapHeldStroke = () => {
        holdTimerRef.current = null;
        holdAnchorRef.current = null;

        const stroke = currentStrokeRef.current;
        if (!isDrawingRef.current || !stroke || stroke.points.length < 2) return;

        const snapped = recognizeShape(stroke.points);
        if (!snapped) return;

        // Playback seeks on `t`, so the replacement has to span the same window:
        // keep the original first and last stamps and spread the rest evenly.
        const firstT = stroke.points[0].t;
        const lastT = stroke.points[stroke.points.length - 1].t;
        const points: StrokePoint[] = snapped.map((p, i) => ({
            x: p.x,
            y: p.y,
            t: i === 0
                ? firstT
                : i === snapped.length - 1
                    ? lastT
                    : Math.round(firstT + ((lastT - firstT) * i) / (snapped.length - 1)),
        }));

        const snappedStroke: DrawingStroke = { color: stroke.color, width: stroke.width, points };

        isDrawingRef.current = false;
        currentStrokeRef.current = null;

        setStrokes(prev => {
            setRedoStack([]);
            setUndoStack(undoStack => [...undoStack, prev]);
            return [...prev, snappedStroke];
        });
    };

    const armHoldSnap = (pos: { x: number; y: number }) => {
        if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
        holdAnchorRef.current = pos;
        holdTimerRef.current = window.setTimeout(snapHeldStroke, HOLD_SNAP_MS);
    };

    useEffect(() => clearHoldSnap, []);

    const startDrawing = (e: React.PointerEvent) => {
        if (!canvasRef.current) return;

        const pos = getPos(e);
        isDrawingRef.current = true;
        const timestamp = Date.now() - startTime;

        if (tool === 'lasso') {
            lassoPointsRef.current = [pos];
        } else if (tool === 'eraser') {
            eraserPositionsRef.current = [pos];
        } else {
            currentStrokeRef.current = {
                color: PEN_COLOR,
                width: getPenStrokeWidth(e.pointerType, e.pressure),
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

            armHoldSnap(pos);
        }
    };

    const draw = (e: React.PointerEvent) => {
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
        } else if (currentStrokeRef.current) {
            currentStrokeRef.current.points.push({ ...pos, t: timestamp });
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            }

            // Restart the hold timer only once the pen has actually moved away,
            // so small jitter while resting still counts as holding still.
            const anchor = holdAnchorRef.current;
            if (!anchor || Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > HOLD_MOVE_TOLERANCE) {
                armHoldSnap(pos);
            }
        }
    };

    const stopDrawing = (e?: React.PointerEvent) => {
        clearHoldSnap();
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

            // Crop around the stroke. Bounds are CSS pixels; the backing store is
            // device pixels, so the source rectangle has to be scaled by dpr.
            const dpr = dprRef.current;
            const cropWidth = Math.max(maxX - minX + 20, 100);
            const cropHeight = Math.max(maxY - minY + 20, 50);

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = Math.round(cropWidth * dpr);
            cropCanvas.height = Math.round(cropHeight * dpr);
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) return;

            cropCtx.fillStyle = '#000000';
            cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
            cropCtx.drawImage(
                canvas,
                Math.round(Math.max(minX - 10, 0) * dpr), Math.round(Math.max(minY - 10, 0) * dpr),
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
        const canvas = canvasRef.current;
        if (!lastLassoSelection || !canvas) {
            alert("Nothing is selected. Draw a lasso around your handwriting first.");
            return;
        }

        // The lasso bounds are padded outwards, so clamp them back onto the
        // surface before they are used as a source rectangle.
        const { width: cssWidth, height: cssHeight } = cssSizeRef.current;
        const minX = Math.max(0, Math.min(lastLassoSelection.minX, cssWidth));
        const minY = Math.max(0, Math.min(lastLassoSelection.minY, cssHeight));
        const maxX = Math.max(minX, Math.min(lastLassoSelection.maxX, cssWidth));
        const maxY = Math.max(minY, Math.min(lastLassoSelection.maxY, cssHeight));

        const containsInk = strokes.some(stroke =>
            stroke.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
        );
        if (!containsInk || maxX - minX < 4 || maxY - minY < 4) {
            alert("That selection is empty. Draw the lasso around the handwriting you want to convert.");
            setHasLassoSelection(false);
            setLastLassoSelection(null);
            return;
        }

        setIsExtracting(true);
        try {
            // The dashed lasso preview is still painted on the canvas; repaint so
            // only the handwriting is sent to the model.
            redrawAllRef.current?.();

            // Selection bounds are CSS pixels, but drawImage reads the backing
            // store, which is device pixels because the context is scaled by dpr.
            // Without this scaling the crop lands on the wrong region entirely.
            const dpr = dprRef.current;
            const srcX = Math.round(minX * dpr);
            const srcY = Math.round(minY * dpr);
            const srcWidth = Math.max(1, Math.round((maxX - minX) * dpr));
            const srcHeight = Math.max(1, Math.round((maxY - minY) * dpr));

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = srcWidth;
            cropCanvas.height = srcHeight;
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) {
                alert("This device could not prepare the image for conversion.");
                return;
            }

            // Notes are white ink on a transparent canvas over a black page; a
            // transparent PNG decodes as blank, so flatten onto the same black.
            cropCtx.fillStyle = '#000000';
            cropCtx.fillRect(0, 0, srcWidth, srcHeight);
            cropCtx.drawImage(canvas, srcX, srcY, srcWidth, srcHeight, 0, 0, srcWidth, srcHeight);

            const base64 = cropCanvas.toDataURL('image/png').split(',')[1];
            const text = (await extractHandwritingFromImage(base64)).trim();

            if (!text || EXTRACTION_FAILURE_PREFIXES.some(prefix => text.startsWith(prefix))) {
                alert(text
                    ? `Could not convert that selection: ${text}`
                    : "The AI returned no text for that selection. Try selecting a tighter area.");
                return;
            }

            // Place the converted text clear of the original handwriting rather
            // than on top of it. This used to sit at minX / vertical-mid-selection
            // — squarely inside the selection box, i.e. directly over the ink it
            // was converted from, which read as overlapping garble rather than a
            // new line of text. Prefer just below the selection (a fixed 30px gap,
            // matching the same convention already used by convertLastStrokeToText
            // above); if there isn't room below on this page, place it just above
            // instead so it never lands off-canvas and invisible.
            const TEXT_GAP = 30;
            const belowFits = maxY + TEXT_GAP <= cssHeight - 10;
            const textY = belowFits ? maxY + TEXT_GAP : Math.max(minY - TEXT_GAP, 10);

            setTextAnnotations((prev: { text: string; x: number; y: number; id: string }[]) => [...prev, {
                text,
                x: minX,
                y: textY,
                id: Date.now().toString()
            }]);

            // Clear the selected area and reset selection, and hand control back
            // to the pen: staying on the lasso tool after a successful conversion
            // was reported as a real usability problem — the user kept trying to
            // write while still in select-mode because nothing switched them back.
            setHasLassoSelection(false);
            setLastLassoSelection(null);
            setTool('pen');
        } catch (error) {
            console.error('Lasso conversion error:', error);
            alert(`Could not convert that selection: ${error instanceof Error ? error.message : 'unexpected error'}`);
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
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
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
        <div className="flex flex-col h-full bg-black overflow-hidden">
            {/* Top Toolbar - Samsung Notes Style */}
            <div className="flex items-center gap-6 px-6 py-4 bg-black border-b border-white/10 shrink-0 overflow-x-auto no-scrollbar">
                {/* Drawing Tools */}
                <button
                    onClick={() => { setTool('pen'); setHasLassoSelection(false); }}
                    className={`${TOOLBAR_BUTTON_SIZE} rounded-2xl transition-all ${
                        tool === 'pen' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Pen Tool"
                    title="Draw with pen"
                >
                    <PenToolIcon width={TOOLBAR_SVG_ICON_SIZE} height={TOOLBAR_SVG_ICON_SIZE} strokeWidth={2.25} />
                </button>
                <button
                    onClick={() => { setTool('eraser'); setHasLassoSelection(false); }}
                    className={`${TOOLBAR_BUTTON_SIZE} rounded-2xl transition-all ${
                        tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    aria-label="Eraser Tool"
                    title="Erase"
                >
                    {/* A broom emoji (🧹) previously sat here and read as "sweeping",
                        not "erasing", to the user. This is the app's own established
                        eraser icon (already used elsewhere, e.g. FilesView/StudyHub),
                        so it also matches the rest of the app's icon style. */}
                    <EraserIcon width={TOOLBAR_SVG_ICON_SIZE} height={TOOLBAR_SVG_ICON_SIZE} strokeWidth={2.25} />
                </button>

                {/* Shape tools (rectangle/circle/line) were removed: the hold-to-snap
                    auto-detection above already recognises hand-drawn shapes, and the
                    user asked for the extra dedicated buttons to go away entirely. */}

                <button
                    onClick={() => {
                        // While a lasso selection is active, tapping this same button
                        // again performs the conversion — matching what its icon/label
                        // now say. Previously this button's onClick was just
                        // `setTool('lasso')` even in the "selected" state, so tapping it
                        // silently did nothing while its own tooltip claimed it would
                        // convert to text — a real source of the confusion reported.
                        if (hasLassoSelection) {
                            convertLassoAreaToText();
                        } else {
                            setTool('lasso');
                        }
                    }}
                    disabled={hasLassoSelection && isExtracting}
                    className={`${TOOLBAR_BUTTON_SIZE} rounded-2xl transition-all ${
                        tool === 'lasso'
                            ? hasLassoSelection
                                ? 'bg-green-600 text-white shadow-lg ring-2 ring-green-400'
                                : 'bg-yellow-600 text-white shadow-lg ring-2 ring-yellow-400'
                            : 'bg-gray-700 text-gray-300 hover:bg-yellow-600/30 hover:text-yellow-400'
                    } disabled:opacity-60`}
                    aria-label={hasLassoSelection ? "Convert selection to text" : "Lasso Selection Tool - Convert handwriting to text"}
                    title={hasLassoSelection ? "Tap to convert selected handwriting to text" : "Draw lasso around handwriting to select"}
                >
                    {hasLassoSelection && tool === 'lasso' ? (
                        // Replaces a bare 📝 emoji ("what does this note icon mean?")
                        // with an icon + short readable label, per this user's vision
                        // needs — a checkmark reads as "selection made", and the label
                        // spells out what tapping again will do.
                        isExtracting ? (
                            <Loader2Icon className="w-9 h-9 animate-spin" />
                        ) : (
                            <span className="flex flex-col items-center justify-center gap-0.5 leading-none">
                                <CheckIcon className="w-8 h-8" />
                                <span className="text-[10px] font-black tracking-wide">TO TEXT</span>
                            </span>
                        )
                    ) : (
                        <LassoGlyph />
                    )}
                </button>

                {/* Divider */}
                <div className="w-px h-14 bg-gray-600 shrink-0"></div>

                {/* Undo/Redo */}
                <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className={`${TOOLBAR_BUTTON_SIZE} rounded-2xl transition-all bg-gray-700 text-gray-400 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-label="Undo"
                    title="Undo"
                >
                    ↶
                </button>
                <button
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className={`${TOOLBAR_BUTTON_SIZE} rounded-2xl transition-all bg-gray-700 text-gray-400 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-label="Redo"
                    title="Redo"
                >
                    ↷
                </button>

                {/* Text Conversion Button - appears after lasso selection */}
                {hasLassoSelection && (
                    <>
                        <div className="w-px h-14 bg-gray-600 shrink-0"></div>
                        <button
                            onClick={convertLassoAreaToText}
                            disabled={isExtracting}
                            className="px-6 py-4 rounded-2xl transition-all bg-green-600 text-white hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed font-black text-xl uppercase tracking-widest flex items-center gap-3 shadow-lg shrink-0"
                            aria-label="Convert selection to text"
                            title="Convert handwriting to text (Hebrew + English)"
                        >
                            {isExtracting ? <Loader2Icon className="w-8 h-8 animate-spin" /> : <span className="text-3xl">🎯</span>}
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
                            aria-label="Clear PDF Background"
                            title="Remove the imported slide background"
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
                        onPointerDown={startDrawing}
                        onPointerMove={draw}
                        onPointerUp={(e) => stopDrawing(e)}
                        onPointerLeave={() => stopDrawing()}
                        onPointerCancel={() => stopDrawing()}
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
                        <button
                            onClick={() => setShowMaterialPicker(false)}
                            className="w-full py-3 bg-gray-700 text-white font-bold rounded-2xl"
                            aria-label="Close Material Picker"
                        >
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

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { NotebookData } from '../types';

/** Fraction of the canvas kept clear on each side so nothing touches the edge. */
const FIT_MARGIN = 0.04;

interface NotebookViewerProps {
    notebook: NotebookData;
    /** Recorded audio for this notebook. Given this, the viewer renders its own
     *  player and replays the strokes in sync. */
    audioSrc?: string;
    audioElement?: HTMLAudioElement | null;
    /**
     * Shown in place of the (missing) play button when the caller has
     * definitively determined there is no audio to offer — neither `audioSrc`
     * nor `audioElement` was passed at all. Opt-in and omitted by default:
     * callers that route audio through a loading/error flow of their own
     * (LectureSplitView via useDriveAudio) already surface a specific reason
     * above this component and should leave this unset to avoid a second,
     * possibly contradictory message. A caller with no such flow (Recorder's
     * own post-recording review) should pass this so a save that ended up
     * with no audio is loud instead of just quietly missing a Play button.
     */
    noAudioMessage?: string;
}

const NotebookViewer: React.FC<NotebookViewerProps> = ({ notebook, audioSrc, audioElement: externalAudio, noAudioMessage }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ownAudioRef = useRef<HTMLAudioElement>(null);
    const [ownAudioReady, setOwnAudioReady] = useState(false);
    // Prefer our own element; fall back to one passed in by a caller.
    const audioElement = audioSrc ? (ownAudioReady ? ownAudioRef.current : null) : externalAudio;
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const animationFrameRef = useRef<number | null>(null);
    const [highlightedPoint, setHighlightedPoint] = useState<{ x: number; y: number; alpha: number } | null>(null);
    const highlightFadeRef = useRef<number | null>(null);
    const currentTimeRef = useRef(0);
    const repaintRef = useRef<() => void>(() => {});

    // Calculate max time from notebook strokes
    useEffect(() => {
        // Seconds, to match the audio clock. Stroke timestamps are milliseconds, so
        // using them raw made the progress bar and seeking wildly out of scale.
        if (notebook.strokes && notebook.strokes.length > 0) {
            const maxMs = Math.max(
                ...notebook.strokes.map(stroke =>
                    Math.max(...stroke.points.map(p => p.t), 0)
                ),
                0
            );
            setDuration(maxMs / 1000);
        }
    }, [notebook.strokes]);

    // Once the recording loads, its real length wins.
    useEffect(() => {
        const el = audioElement;
        if (!el) return;
        const onMeta = () => { if (Number.isFinite(el.duration)) setDuration(el.duration); };
        if (Number.isFinite(el.duration) && el.duration > 0) onMeta();
        el.addEventListener('loadedmetadata', onMeta);
        return () => el.removeEventListener('loadedmetadata', onMeta);
    }, [audioElement]);

    /**
     * Extent of the ink itself, in the coordinates the strokes were captured in.
     * Used as the source rect for notebooks saved before the capture size was
     * recorded: scaling those 1:1 pushed right-to-left handwriting, which starts
     * near the right edge of a full-screen surface, clean off this small canvas.
     */
    const strokeBounds = useMemo(() => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const stroke of notebook.strokes || []) {
            for (const point of stroke.points) {
                if (point.x < minX) minX = point.x;
                if (point.y < minY) minY = point.y;
                if (point.x > maxX) maxX = point.x;
                if (point.y > maxY) maxY = point.y;
            }
        }

        if (!Number.isFinite(minX)) return null;
        // A dot or a perfectly straight line has no extent on one axis; keep a
        // floor so the scale stays finite.
        return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
    }, [notebook.strokes]);

    /**
     * Maps the recorded drawing surface onto this canvas, preserving aspect ratio
     * and centring the result with a small margin. Everything is in CSS pixels —
     * the context carries the device-pixel-ratio transform.
     */
    const fitScale = useCallback(() => {
        const canvas = canvasRef.current;
        const cw = canvas?.offsetWidth || 0;
        const ch = canvas?.offsetHeight || 0;
        const src = notebook.canvasWidth && notebook.canvasHeight
            ? { x: 0, y: 0, width: notebook.canvasWidth, height: notebook.canvasHeight }
            : strokeBounds;

        if (!cw || !ch || !src) return { k: 1, dx: 0, dy: 0, sx: 0, sy: 0, sw: cw, sh: ch };

        const k = Math.min((cw * (1 - FIT_MARGIN * 2)) / src.width, (ch * (1 - FIT_MARGIN * 2)) / src.height);
        // Folding the source origin into the offset keeps the mapping a plain
        // `x * k + dx`, so the hit test can invert it with `(x - dx) / k`.
        return {
            k,
            dx: (cw - src.width * k) / 2 - src.x * k,
            dy: (ch - src.height * k) / 2 - src.y * k,
            sx: src.x,
            sy: src.y,
            sw: src.width,
            sh: src.height,
        };
    }, [notebook.canvasWidth, notebook.canvasHeight, strokeBounds]);

    /** upToTime is in SECONDS (audio clock); stroke timestamps are milliseconds. */
    const redrawStrokes = useCallback((upToTime: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Everything below is in CSS pixels because the context carries the dpr
        // transform; canvas.width/height are device pixels and would over-fill.
        const cssWidth = canvas.offsetWidth;
        const cssHeight = canvas.offsetHeight;

        // Match the notebook's black page. The pen draws in white, so a white
        // canvas here rendered every stroke invisible — the notes looked blank.
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        // Draw background image if exists
        if (notebook.backgroundImageUrl) {
            const img = new Image();
            img.onload = () => {
                // The page image shares the strokes' coordinate space, so it gets
                // the same fit transform — otherwise the two drift apart.
                const s = fitScale();
                ctx.drawImage(img, s.sx * s.k + s.dx, s.sy * s.k + s.dy, s.sw * s.k, s.sh * s.k);
                drawStrokesUpToTime(upToTime);
                drawHighlight();
            };
            img.src = notebook.backgroundImageUrl;
        } else {
            drawStrokesUpToTime(upToTime);
            drawHighlight();
        }

        function drawStrokesUpToTime(time: number) {
            if (!notebook.strokes) return;

            // Strokes were captured on the full-screen notebook. Replaying them
            // 1:1 on this much smaller canvas put most of the drawing outside the
            // visible area, which read as "my notes are missing". Fit them instead,
            // preserving aspect ratio so handwriting is not distorted.
            const s = fitScale();

            notebook.strokes.forEach(stroke => {
                // Stroke timestamps are milliseconds since recording started, while
                // the audio clock is in seconds. Comparing them directly meant
                // virtually nothing was drawn until the very end of playback.
                const pointsUpToTime = stroke.points.filter(p => p.t <= time * 1000);
                if (pointsUpToTime.length === 0) return;

                ctx!.strokeStyle = stroke.color;
                ctx!.lineWidth = Math.max(1, stroke.width * s.k);
                ctx!.lineCap = 'round';
                ctx!.lineJoin = 'round';

                ctx!.beginPath();
                ctx!.moveTo(pointsUpToTime[0].x * s.k + s.dx, pointsUpToTime[0].y * s.k + s.dy);

                for (let i = 1; i < pointsUpToTime.length; i++) {
                    ctx!.lineTo(pointsUpToTime[i].x * s.k + s.dx, pointsUpToTime[i].y * s.k + s.dy);
                }

                ctx!.stroke();
            });
        }

        function drawHighlight() {
            if (!highlightedPoint) return;

            const radius = 8;
            const s = fitScale();
            const hx = highlightedPoint.x * s.k + s.dx;
            const hy = highlightedPoint.y * s.k + s.dy;

            // Draw outer glow circle with fade
            ctx!.fillStyle = `rgba(76, 175, 80, ${highlightedPoint.alpha * 0.3})`;
            ctx!.beginPath();
            ctx!.arc(hx, hy, radius * 1.8, 0, Math.PI * 2);
            ctx!.fill();

            // Draw inner highlight circle
            ctx!.fillStyle = `rgba(76, 175, 80, ${highlightedPoint.alpha * 0.8})`;
            ctx!.beginPath();
            ctx!.arc(hx, hy, radius, 0, Math.PI * 2);
            ctx!.fill();

            // Draw white center
            ctx!.fillStyle = '#ffffff';
            ctx!.beginPath();
            ctx!.arc(hx, hy, radius * 0.5, 0, Math.PI * 2);
            ctx!.fill();
        }
    }, [notebook.backgroundImageUrl, notebook.strokes, highlightedPoint, fitScale]);

    // Repaint at the playhead rather than at 0: a tap seeks and then changes the
    // highlight, and rewinding to 0 on that re-render wiped the notes off screen.
    const repaint = useCallback(() => redrawStrokes(currentTimeRef.current), [redrawStrokes]);

    useEffect(() => {
        currentTimeRef.current = currentTime;
    }, [currentTime]);

    // Keeps the resize handler on the latest paint function without re-subscribing.
    useEffect(() => {
        repaintRef.current = repaint;
        repaint();
    }, [notebook, repaint]);

    // Size the backing store to the element, and keep doing it. The panel is laid
    // out with flex and percentage heights and grows a controls row once the audio
    // metadata loads, so a single measurement at mount left the backing store
    // stretched over a box of a different size while fitScale kept using the live
    // one — which magnified the strokes about the top-left corner and pushed
    // right-to-left handwriting off the right edge, out of tap range.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resizeCanvas = () => {
            const width = canvas.offsetWidth;
            const height = canvas.offsetHeight;
            if (!width || !height) return;

            const dpr = window.devicePixelRatio || 1;
            const backingWidth = Math.round(width * dpr);
            const backingHeight = Math.round(height * dpr);
            if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
                canvas.width = backingWidth;
                canvas.height = backingHeight;
            }

            // Assigning width/height resets the transform, and the ratio itself can
            // change (moving between screens), so re-apply it on every pass.
            canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
            repaintRef.current();
        };

        resizeCanvas();

        const observer = new ResizeObserver(resizeCanvas);
        observer.observe(canvas);
        window.addEventListener('orientationchange', resizeCanvas);

        return () => {
            observer.disconnect();
            window.removeEventListener('orientationchange', resizeCanvas);
        };
    }, []);

    const handlePlay = useCallback(() => {
        if (!audioElement) return;

        if (isPlaying) {
            audioElement.pause();
            setIsPlaying(false);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        } else {
            audioElement.currentTime = currentTime;
            audioElement.play();
            setIsPlaying(true);

            const syncPlayback = () => {
                if (!audioElement || audioElement.paused) {
                    setIsPlaying(false);
                    return;
                }

                setCurrentTime(audioElement.currentTime);
                redrawStrokes(audioElement.currentTime);
                animationFrameRef.current = requestAnimationFrame(syncPlayback);
            };

            animationFrameRef.current = requestAnimationFrame(syncPlayback);
        }
    }, [audioElement, currentTime, isPlaying, redrawStrokes]);

    // Handle audio end
    useEffect(() => {
        if (!audioElement) return;

        const handleAudioEnd = () => {
            setIsPlaying(false);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            redrawStrokes(duration);
        };

        audioElement.addEventListener('ended', handleAudioEnd);
        return () => audioElement.removeEventListener('ended', handleAudioEnd);
    }, [audioElement, duration, redrawStrokes]);

    // Shared seek mechanics: clamp to the valid range, update the audio clock,
    // React state, and repaint the strokes up to the new time. Both the mouse
    // click handler and the keyboard handler drive playback through this so
    // there's exactly one place that touches audioElement.currentTime.
    const seekTo = useCallback((newTime: number) => {
        if (!audioElement || duration === 0) return;

        const clamped = Math.min(Math.max(newTime, 0), duration);
        setCurrentTime(clamped);
        audioElement.currentTime = clamped;
        redrawStrokes(clamped);
    }, [audioElement, duration, redrawStrokes]);

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioElement || duration === 0) return;

        const progressBar = e.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        seekTo(percent * duration);
    };

    const SEEK_STEP_SECONDS = 5;

    const handleProgressKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!audioElement || duration === 0) return;

        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                e.preventDefault();
                seekTo(currentTime - SEEK_STEP_SECONDS);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                e.preventDefault();
                seekTo(currentTime + SEEK_STEP_SECONDS);
                break;
            case 'Home':
                e.preventDefault();
                seekTo(0);
                break;
            case 'End':
                e.preventDefault();
                seekTo(duration);
                break;
            default:
                break;
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Spoken-word version of formatTime's own mins/secs split, for aria-valuetext
    // — NVDA reads "1:12" digit-by-digit, which is much harder to parse by ear
    // than "1 minute 12 seconds".
    const describeTimeForScreenReader = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const minPart = `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
        const secPart = `${secs} ${secs === 1 ? 'second' : 'seconds'}`;
        return `${minPart} ${secPart}`;
    };

    // Hit detection: Find if click is near any stroke point
    const detectHitStroke = (
        canvasX: number,
        canvasY: number,
        hitDistance: number = 12
    ): { timestamp: number; x: number; y: number } | null => {
        if (!notebook.strokes) return null;

        type Candidate = { timestamp: number; x: number; y: number; distance: number };

        const candidates: Candidate[] = [];

        for (const stroke of notebook.strokes) {
            for (const point of stroke.points) {
                const distance = Math.hypot(canvasX - point.x, canvasY - point.y);
                if (distance < hitDistance) {
                    candidates.push({ timestamp: point.t, x: point.x, y: point.y, distance });
                }
            }
        }

        if (candidates.length === 0) return null;

        const closest = candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
        return { timestamp: closest.timestamp, x: closest.x, y: closest.y };
    };

    // Handle canvas click to jump to audio timestamp
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!audioElement || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Drawing happens in CSS pixels, so multiplying by the device pixel ratio
        // here put the hit test in a different space from the strokes. Convert the
        // tap back through the same fit transform used to render them.
        const s = fitScale();
        const canvasX = ((e.clientX - rect.left) - s.dx) / s.k;
        const canvasY = ((e.clientY - rect.top) - s.dy) / s.k;

        const hit = detectHitStroke(canvasX, canvasY, 12 / (s.k || 1));

        if (hit) {
            // Convert milliseconds to seconds for audio element
            const timeInSeconds = hit.timestamp / 1000;
            setCurrentTime(timeInSeconds);
            audioElement.currentTime = timeInSeconds;
            redrawStrokes(timeInSeconds);

            // Show visual feedback: highlight the clicked point
            setHighlightedPoint({ x: hit.x, y: hit.y, alpha: 1 });

            // Clear any existing fade animation
            if (highlightFadeRef.current) {
                cancelAnimationFrame(highlightFadeRef.current);
            }

            // Fade out the highlight over 300ms
            const startTime = Date.now();
            const fadeOut = () => {
                const elapsed = Date.now() - startTime;
                const alpha = Math.max(0, 1 - elapsed / 300);

                if (alpha > 0) {
                    setHighlightedPoint(prev => prev ? { ...prev, alpha } : null);
                    highlightFadeRef.current = requestAnimationFrame(fadeOut);
                } else {
                    setHighlightedPoint(null);
                    highlightFadeRef.current = null;
                }
            };

            highlightFadeRef.current = requestAnimationFrame(fadeOut);
        }
    };

    // Handle canvas mouse move for cursor feedback
    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        const s = fitScale();
        const canvasX = ((e.clientX - rect.left) - s.dx) / s.k;
        const canvasY = ((e.clientY - rect.top) - s.dy) / s.k;

        const hit = detectHitStroke(canvasX, canvasY, 12 / (s.k || 1));
        canvas.style.cursor = hit ? 'pointer' : 'default';
    };

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Neither an audioSrc nor an externalAudio element was given at all — as
    // opposed to one being given but still loading (audioSrc present but
    // ownAudioReady still false, or externalAudio explicitly passed as null).
    // Only fires when the caller opted in via noAudioMessage, so a caller with
    // its own loading/error UI (LectureSplitView) never gets a second,
    // possibly-contradictory message from in here.
    const noAudioProvided = Boolean(noAudioMessage) && !audioSrc && externalAudio === undefined;

    return (
        <div className="notebook-viewer">
            {audioSrc && (
                <audio
                    ref={ownAudioRef}
                    src={audioSrc}
                    preload="metadata"
                    onLoadedMetadata={() => setOwnAudioReady(true)}
                    onCanPlay={() => setOwnAudioReady(true)}
                    style={{ display: 'none' }}
                />
            )}
            <div className="notebook-canvas-wrapper">
                <canvas
                    ref={canvasRef}
                    className="notebook-canvas"
                    onClick={handleCanvasClick}
                    onMouseMove={handleCanvasMouseMove}
                />

                {audioElement && (
                    <button
                        onClick={handlePlay}
                        className="notebook-play-button"
                        aria-label={isPlaying ? 'Pause notes' : 'Play notes'}
                    >
                        {isPlaying ? '⏸ STOP' : '▶ PLAY NOTES'}
                    </button>
                )}

                {noAudioProvided && (
                    <div className="notebook-no-audio" role="status">
                        {noAudioMessage}
                    </div>
                )}
            </div>

            {audioElement && (
                <div className="notebook-controls">
                    <div
                        className="notebook-progress"
                        onClick={handleProgressClick}
                        onKeyDown={handleProgressKeyDown}
                        role="slider"
                        tabIndex={0}
                        aria-label="Seek notes"
                        aria-valuemin={0}
                        aria-valuemax={duration}
                        aria-valuenow={currentTime}
                        aria-valuetext={`${describeTimeForScreenReader(currentTime)} of ${describeTimeForScreenReader(duration)}`}
                    >
                        <div
                            className="notebook-progress-bar"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    <div className="notebook-time">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>

                    <span className="sr-only" aria-live="polite">
                        {isPlaying ? 'Playing' : 'Paused'}
                    </span>
                </div>
            )}

            <style>{`
                .notebook-viewer {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    padding: 12px;
                    height: 100%;
                    background: transparent;
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.12);
                }

                .notebook-canvas-wrapper {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    min-height: 240px;
                    background: #000;
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid #ddd;
                }

                .notebook-canvas {
                    display: block;
                    width: 100%;
                    height: 100%;
                }

                .notebook-play-button {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    padding: 12px 24px;
                    font-size: 14px;
                    font-weight: 600;
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    transition: all 0.2s ease;
                }

                .notebook-play-button:hover {
                    background-color: #45a049;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }

                .notebook-play-button:active {
                    transform: translate(-50%, -50%) scale(0.95);
                }

                .notebook-no-audio {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    max-width: 85%;
                    padding: 14px 20px;
                    font-size: 15px;
                    font-weight: 700;
                    text-align: center;
                    color: #fde68a;
                    background-color: rgba(120, 53, 15, 0.55);
                    border: 1px solid rgba(253, 230, 138, 0.4);
                    border-radius: 10px;
                }

                .notebook-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .notebook-progress {
                    width: 100%;
                    height: 4px;
                    background-color: #e0e0e0;
                    border-radius: 2px;
                    cursor: pointer;
                    position: relative;
                }

                .notebook-progress-bar {
                    height: 100%;
                    background-color: #4CAF50;
                    border-radius: 2px;
                    transition: width 0.05s linear;
                }

                .notebook-time {
                    display: flex;
                    justify-content: space-between;
                    font-size: 12px;
                    color: #666;
                    font-weight: 500;
                }

                .notebook-progress:focus-visible {
                    outline: 2px solid #4CAF50;
                    outline-offset: 2px;
                }

                .sr-only {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    padding: 0;
                    margin: -1px;
                    overflow: hidden;
                    clip: rect(0, 0, 0, 0);
                    white-space: nowrap;
                    border: 0;
                }
            `}</style>
        </div>
    );
};

export default NotebookViewer;

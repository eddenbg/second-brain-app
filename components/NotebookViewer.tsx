import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { NotebookData } from '../types';

/** Fraction of the canvas kept clear on each side so nothing touches the edge. */
const FIT_MARGIN = 0.04;

/**
 * Radius (rendered CSS px, i.e. what actually shows on screen — see the note
 * at each call site on why dividing by `s.k` first cancels back out to this)
 * a tap must land within to count as hitting a stroke.
 *
 * This used to be a bare `12`, which is a reasonable *mouse* click tolerance
 * but reported as simply not registering taps on a real tablet: a 12px radius
 * is a 24px-diameter target, well under the ~44-48px minimum most touch
 * target guidelines call for, and this app's own reviewer already had to
 * quadruple its toolbar buttons for the same reason. ~1cm (the CSS spec's own
 * 96px-per-inch reference pixel, independent of devicePixelRatio) is a
 * generous, well-justified stand-in for a fingertip's contact patch.
 */
const TOUCH_HIT_RADIUS_CSS_PX = 96 / 2.54; // ~37.8 CSS px (~1cm)

/**
 * Color for whichever stroke was last tapped while browsing (not actively
 * playing) — a bright, saturated amber chosen for strong contrast against
 * both the black page and the plain white ink, for a user with a visual
 * impairment. Deliberately does NOT dim the rest of the notes: the point is
 * to make the selected stroke unmistakable while keeping everything else at
 * full, normal legibility.
 */
const SELECTED_STROKE_COLOR = '#FFD600';

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
    // Index into notebook.strokes for whichever stroke the user last tapped
    // while browsing (paused). Persistent — unlike the old fading dot marker,
    // this stays lit until a different stroke is tapped or playback starts,
    // so it's actually usable as a "you selected this" indicator rather than
    // a blink-and-you-miss-it flash.
    const [selectedStrokeIndex, setSelectedStrokeIndex] = useState<number | null>(null);
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
            };
            img.src = notebook.backgroundImageUrl;
        } else {
            drawStrokesUpToTime(upToTime);
        }

        function drawStrokesUpToTime(time: number) {
            if (!notebook.strokes) return;

            // Strokes were captured on the full-screen notebook. Replaying them
            // 1:1 on this much smaller canvas put most of the drawing outside the
            // visible area, which read as "my notes are missing". Fit them instead,
            // preserving aspect ratio so handwriting is not distorted.
            const s = fitScale();

            // While actively playing, reveal strokes progressively in sync with
            // the audio, same as always. While paused/browsing (the default —
            // including the very first render, before Play has ever been
            // tapped), show the WHOLE set of notes immediately rather than a
            // blank canvas the user has to press Play to fill in: "I want to
            // see my whole notes before hitting play so I can choose which
            // part... to jump to."
            const showEverything = !isPlaying;

            const drawOneStroke = (stroke: typeof notebook.strokes[number], isSelected: boolean, time: number) => {
                const points = showEverything ? stroke.points : stroke.points.filter(p => p.t <= time * 1000);
                if (points.length === 0) return;

                ctx!.strokeStyle = isSelected ? SELECTED_STROKE_COLOR : stroke.color;
                // A little thicker too, so the color change isn't the only cue —
                // matters for anyone who has trouble distinguishing colors, not
                // just low vision generally.
                ctx!.lineWidth = Math.max(1, stroke.width * s.k) * (isSelected ? 1.6 : 1);
                ctx!.lineCap = 'round';
                ctx!.lineJoin = 'round';

                ctx!.beginPath();
                ctx!.moveTo(points[0].x * s.k + s.dx, points[0].y * s.k + s.dy);

                for (let i = 1; i < points.length; i++) {
                    ctx!.lineTo(points[i].x * s.k + s.dx, points[i].y * s.k + s.dy);
                }

                ctx!.stroke();
            };

            // Draw the selected stroke last (on top) in a second pass, so it can
            // never end up visually buried under a stroke drawn after it in the
            // original recording order.
            notebook.strokes.forEach((stroke, strokeIndex) => {
                if (showEverything && strokeIndex === selectedStrokeIndex) return;
                drawOneStroke(stroke, false, time);
            });
            if (showEverything && selectedStrokeIndex !== null && notebook.strokes[selectedStrokeIndex]) {
                drawOneStroke(notebook.strokes[selectedStrokeIndex], true, time);
            }
        }
    }, [notebook.backgroundImageUrl, notebook.strokes, isPlaying, selectedStrokeIndex, fitScale]);

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
            // Progressive-reveal playback and the paused "show everything, one
            // stroke picked out" browse mode are different visual languages —
            // carrying a stale selection into playback would be confusing.
            setSelectedStrokeIndex(null);

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
        hitDistance: number = TOUCH_HIT_RADIUS_CSS_PX
    ): { timestamp: number; strokeIndex: number } | null => {
        if (!notebook.strokes) return null;

        type Candidate = { timestamp: number; strokeIndex: number; distance: number };

        const candidates: Candidate[] = [];

        notebook.strokes.forEach((stroke, strokeIndex) => {
            for (const point of stroke.points) {
                const distance = Math.hypot(canvasX - point.x, canvasY - point.y);
                if (distance < hitDistance) {
                    candidates.push({ timestamp: point.t, strokeIndex, distance });
                }
            }
        });

        if (candidates.length === 0) return null;

        const closest = candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
        return { timestamp: closest.timestamp, strokeIndex: closest.strokeIndex };
    };

    // Handle canvas click to jump to audio timestamp and mark that stroke as
    // the selected one — see SELECTED_STROKE_COLOR above.
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

        const hit = detectHitStroke(canvasX, canvasY, TOUCH_HIT_RADIUS_CSS_PX / (s.k || 1));

        if (hit) {
            // Convert milliseconds to seconds for audio element
            const timeInSeconds = hit.timestamp / 1000;
            setCurrentTime(timeInSeconds);
            audioElement.currentTime = timeInSeconds;
            setSelectedStrokeIndex(hit.strokeIndex);
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

        const hit = detectHitStroke(canvasX, canvasY, TOUCH_HIT_RADIUS_CSS_PX / (s.k || 1));
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

                {noAudioProvided && (
                    <div className="notebook-no-audio" role="status">
                        {noAudioMessage}
                    </div>
                )}

                {!isPlaying && selectedStrokeIndex !== null && (
                    <div
                        className="notebook-selection-badge"
                        role="status"
                        aria-label={`Selected: ${describeTimeForScreenReader(currentTime)} — tap Play to resume from here`}
                    >
                        Selected: {formatTime(currentTime)} — tap Play to resume from here
                    </div>
                )}
            </div>

            {audioElement && (
                <div className="notebook-controls">
                    <div className="notebook-transport-row">
                        <button
                            onClick={handlePlay}
                            className="notebook-play-icon-button"
                            aria-label={isPlaying ? 'Pause notes' : 'Play notes'}
                        >
                            {isPlaying ? '⏸' : '▶'}
                        </button>

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

                .notebook-transport-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                /*
                 * Moved off the canvas entirely — it used to sit centered on top of
                 * the drawing (a big "PLAY NOTES" button), covering handwriting right
                 * where notes are now shown in full by default. A small icon next to
                 * the timeline, matching the request, but still a real touch target
                 * (44px) rather than shrunk to the point of being hard to tap.
                 */
                .notebook-play-icon-button {
                    flex-shrink: 0;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                    transition: all 0.15s ease;
                }

                .notebook-play-icon-button:hover {
                    background-color: #45a049;
                }

                .notebook-play-icon-button:active {
                    transform: scale(0.92);
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

                .notebook-selection-badge {
                    position: absolute;
                    bottom: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    max-width: 90%;
                    padding: 8px 16px;
                    font-size: 14px;
                    font-weight: 800;
                    text-align: center;
                    color: #000;
                    background-color: #FFD600;
                    border-radius: 999px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
                }

                .notebook-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .notebook-progress {
                    flex: 1;
                    min-width: 0;
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

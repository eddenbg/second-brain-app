import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { NotebookData } from '../types';

interface NotebookViewerProps {
    notebook: NotebookData;
    /** Recorded audio for this notebook. Given this, the viewer renders its own
     *  player and replays the strokes in sync. */
    audioSrc?: string;
    audioElement?: HTMLAudioElement | null;
}

const NotebookViewer: React.FC<NotebookViewerProps> = ({ notebook, audioSrc, audioElement: externalAudio }) => {
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
     * Maps the recorded drawing surface onto this canvas, preserving aspect ratio
     * and centring the result. Falls back to 1:1 for notebooks saved before the
     * capture size was recorded.
     */
    const fitScale = useCallback(() => {
        const canvas = canvasRef.current;
        const cw = canvas?.offsetWidth || 0;
        const ch = canvas?.offsetHeight || 0;
        const sw = notebook.canvasWidth || cw;
        const sh = notebook.canvasHeight || ch;
        if (!cw || !ch || !sw || !sh) return { k: 1, dx: 0, dy: 0 };
        const k = Math.min(cw / sw, ch / sh);
        return { k, dx: (cw - sw * k) / 2, dy: (ch - sh * k) / 2 };
    }, [notebook.canvasWidth, notebook.canvasHeight]);

    /** upToTime is in SECONDS (audio clock); stroke timestamps are milliseconds. */
    const redrawStrokes = useCallback((upToTime: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Match the notebook's black page. The pen draws in white, so a white
        // canvas here rendered every stroke invisible — the notes looked blank.
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw background image if exists
        if (notebook.backgroundImageUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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

    // Initialize canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
        }

        redrawStrokes(0);
    }, [notebook, redrawStrokes]);

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

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioElement || duration === 0) return;

        const progressBar = e.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = percent * duration;

        setCurrentTime(newTime);
        audioElement.currentTime = newTime;
        redrawStrokes(newTime);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
                    >
                        {isPlaying ? '⏸ STOP' : '▶ PLAY NOTES'}
                    </button>
                )}
            </div>

            {audioElement && (
                <div className="notebook-controls">
                    <div
                        className="notebook-progress"
                        onClick={handleProgressClick}
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
            `}</style>
        </div>
    );
};

export default NotebookViewer;

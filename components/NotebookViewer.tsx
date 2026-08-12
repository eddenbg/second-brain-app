import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { NotebookData } from '../types';

interface NotebookViewerProps {
    notebook: NotebookData;
    audioElement?: HTMLAudioElement | null;
}

const NotebookViewer: React.FC<NotebookViewerProps> = ({ notebook, audioElement }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const animationFrameRef = useRef<number | null>(null);
    const [highlightedPoint, setHighlightedPoint] = useState<{ x: number; y: number; alpha: number } | null>(null);
    const highlightFadeRef = useRef<number | null>(null);

    // Calculate max time from notebook strokes
    useEffect(() => {
        if (notebook.strokes && notebook.strokes.length > 0) {
            const maxTime = Math.max(
                ...notebook.strokes.map(stroke =>
                    Math.max(...stroke.points.map(p => p.t), 0)
                ),
                0
            );
            setDuration(maxTime);
        }
    }, [notebook.strokes]);

    const redrawStrokes = useCallback((upToTime: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas with white background
        ctx.fillStyle = '#ffffff';
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

            notebook.strokes.forEach(stroke => {
                const pointsUpToTime = stroke.points.filter(p => p.t <= time);
                if (pointsUpToTime.length === 0) return;

                ctx!.strokeStyle = stroke.color;
                ctx!.lineWidth = stroke.width;
                ctx!.lineCap = 'round';
                ctx!.lineJoin = 'round';

                ctx!.beginPath();
                ctx!.moveTo(pointsUpToTime[0].x, pointsUpToTime[0].y);

                for (let i = 1; i < pointsUpToTime.length; i++) {
                    ctx!.lineTo(pointsUpToTime[i].x, pointsUpToTime[i].y);
                }

                ctx!.stroke();
            });
        }

        function drawHighlight() {
            if (!highlightedPoint) return;

            const radius = 8;
            const dpr = window.devicePixelRatio || 1;

            // Draw outer glow circle with fade
            ctx!.fillStyle = `rgba(76, 175, 80, ${highlightedPoint.alpha * 0.3})`;
            ctx!.beginPath();
            ctx!.arc(highlightedPoint.x, highlightedPoint.y, radius * 1.8, 0, Math.PI * 2);
            ctx!.fill();

            // Draw inner highlight circle
            ctx!.fillStyle = `rgba(76, 175, 80, ${highlightedPoint.alpha * 0.8})`;
            ctx!.beginPath();
            ctx!.arc(highlightedPoint.x, highlightedPoint.y, radius, 0, Math.PI * 2);
            ctx!.fill();

            // Draw white center
            ctx!.fillStyle = '#ffffff';
            ctx!.beginPath();
            ctx!.arc(highlightedPoint.x, highlightedPoint.y, radius * 0.5, 0, Math.PI * 2);
            ctx!.fill();
        }
    }, [notebook.backgroundImageUrl, notebook.strokes, highlightedPoint]);

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

        let closestHit: { timestamp: number; x: number; y: number; distance: number } | null = null;

        notebook.strokes.forEach(stroke => {
            stroke.points.forEach(point => {
                const distance = Math.sqrt(
                    Math.pow(canvasX - point.x, 2) + Math.pow(canvasY - point.y, 2)
                );

                if (distance < hitDistance) {
                    if (!closestHit || distance < closestHit.distance) {
                        closestHit = {
                            timestamp: point.t,
                            x: point.x,
                            y: point.y,
                            distance,
                        };
                    }
                }
            });
        });

        return closestHit ? { timestamp: closestHit.timestamp, x: closestHit.x, y: closestHit.y } : null;
    };

    // Handle canvas click to jump to audio timestamp
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!audioElement || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Calculate click position relative to canvas, accounting for device pixel ratio
        const canvasX = (e.clientX - rect.left) * dpr;
        const canvasY = (e.clientY - rect.top) * dpr;

        const hit = detectHitStroke(canvasX, canvasY);

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
        const dpr = window.devicePixelRatio || 1;

        const canvasX = (e.clientX - rect.left) * dpr;
        const canvasY = (e.clientY - rect.top) * dpr;

        const hit = detectHitStroke(canvasX, canvasY);
        canvas.style.cursor = hit ? 'pointer' : 'default';
    };

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="notebook-viewer">
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
                    gap: 16px;
                    padding: 16px;
                    background: linear-gradient(135deg, #f0f4f8 0%, #e9eef5 100%);
                    border-radius: 12px;
                    border: 1px solid #d1d8e0;
                }

                .notebook-canvas-wrapper {
                    position: relative;
                    width: 100%;
                    height: 300px;
                    background: white;
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

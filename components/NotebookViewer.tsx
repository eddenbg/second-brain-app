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
            };
            img.src = notebook.backgroundImageUrl;
        } else {
            drawStrokesUpToTime(upToTime);
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
    }, [notebook.backgroundImageUrl, notebook.strokes]);

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

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="notebook-viewer">
            <div className="notebook-canvas-wrapper">
                <canvas
                    ref={canvasRef}
                    className="notebook-canvas"
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

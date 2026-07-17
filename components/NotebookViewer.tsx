import React, { useEffect, useRef, useState } from 'react';
import type { NotebookData } from '../types';

interface NotebookViewerProps {
    notebook: NotebookData;
    audioElement?: HTMLAudioElement | null;
    syncWithAudio?: boolean;
}

const NotebookViewer: React.FC<NotebookViewerProps> = ({ notebook, audioElement, syncWithAudio = true }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw background image if exists
        if (notebook.backgroundImageUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                redrawStrokes(ctx, canvas);
            };
            img.src = notebook.backgroundImageUrl;
        } else {
            redrawStrokes(ctx, canvas);
        }
    }, [notebook]);

    const redrawStrokes = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
        // Determine which strokes to show based on sync time
        const maxTime = syncWithAudio ? currentTime * 1000 : Infinity;

        notebook.strokes.forEach(stroke => {
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const visiblePoints = stroke.points.filter(p => p.t <= maxTime);
            if (visiblePoints.length === 0) return;

            ctx.beginPath();
            ctx.moveTo(visiblePoints[0].x, visiblePoints[0].y);
            for (let i = 1; i < visiblePoints.length; i++) {
                ctx.lineTo(visiblePoints[i].x, visiblePoints[i].y);
            }
            ctx.stroke();
        });
    };

    // Handle audio sync
    useEffect(() => {
        if (!syncWithAudio || !audioElement) return;

        const handleTimeUpdate = () => {
            setCurrentTime(audioElement.currentTime);
        };

        audioElement.addEventListener('timeupdate', handleTimeUpdate);
        return () => audioElement.removeEventListener('timeupdate', handleTimeUpdate);
    }, [audioElement, syncWithAudio]);

    // Redraw when time changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (notebook.backgroundImageUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                redrawStrokes(ctx, canvas);
            };
            img.src = notebook.backgroundImageUrl;
        } else {
            redrawStrokes(ctx, canvas);
        }
    }, [currentTime, notebook]);

    return (
        <canvas
            ref={canvasRef}
            width={1200}
            height={1600}
            className="w-full h-full max-h-96 mx-auto rounded-2xl border-2 border-white/10 shadow-lg bg-gray-800"
        />
    );
};

export default NotebookViewer;

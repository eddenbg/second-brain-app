import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { VoiceMemory, NotebookData, TranscriptSegment } from '../types';

interface NotebookPlaybackProps {
  memory: VoiceMemory;
  audioElement?: HTMLAudioElement | null;
  onClose?: () => void;
}

const NotebookPlayback: React.FC<NotebookPlaybackProps> = ({ memory, audioElement, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // State management
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(audioElement || null);

  // Get notebook data, safely handling missing strokes
  const notebook = memory.notebook || { strokes: [] };
  const transcript = memory.structuredTranscript || [];

  // Calculate duration from notebook strokes or audio
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

    // Also try to get duration from audio element
    const audio = audioRef.current;
    if (audio) {
      const updateDuration = () => {
        if (audio.duration && !isNaN(audio.duration)) {
          setDuration(prev => Math.max(prev, audio.duration));
        }
      };

      audio.addEventListener('loadedmetadata', updateDuration);
      if (audio.duration && !isNaN(audio.duration)) {
        updateDuration();
      }

      return () => audio.removeEventListener('loadedmetadata', updateDuration);
    }
  }, [notebook.strokes]);

  // Find currently active transcript segment
  const activeSegmentIndex = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].timestamp <= currentTime) {
        return i;
      }
    }
    return -1;
  }, [currentTime, transcript]);

  // Auto-scroll transcript to active segment
  useEffect(() => {
    if (activeSegmentRef.current && transcriptContainerRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeSegmentIndex]);

  // Redraw canvas with strokes up to current time
  const redrawStrokes = useCallback((upToTime: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !notebook.strokes) return;

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

        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(pointsUpToTime[0].x, pointsUpToTime[0].y);

        for (let i = 1; i < pointsUpToTime.length; i++) {
          ctx.lineTo(pointsUpToTime[i].x, pointsUpToTime[i].y);
        }

        ctx.stroke();
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

  // Play/pause handler
  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    } else {
      audio.currentTime = currentTime;
      audio.play();
      setIsPlaying(true);

      const syncPlayback = () => {
        if (!audio || audio.paused) {
          setIsPlaying(false);
          return;
        }

        setCurrentTime(audio.currentTime);
        redrawStrokes(audio.currentTime);
        animationFrameRef.current = requestAnimationFrame(syncPlayback);
      };

      animationFrameRef.current = requestAnimationFrame(syncPlayback);
    }
  }, [currentTime, isPlaying, redrawStrokes]);

  // Handle audio end
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioEnd = () => {
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      redrawStrokes(duration);
    };

    audio.addEventListener('ended', handleAudioEnd);
    return () => audio.removeEventListener('ended', handleAudioEnd);
  }, [duration, redrawStrokes]);

  // Progress bar click handler
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || duration === 0) return;

    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = Math.max(0, Math.min(percent * duration, duration));

    setCurrentTime(newTime);
    audio.currentTime = newTime;
    redrawStrokes(newTime);
  };

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="notebook-playback-container">
      {/* Audio element - hidden, used for playback control */}
      {memory.audioDataUrl && (
        <audio ref={audioRef} src={memory.audioDataUrl} />
      )}

      {/* Header with close button */}
      {onClose && (
        <div className="notebook-playback-header">
          <h2 className="notebook-playback-title">{memory.title}</h2>
          <button
            onClick={onClose}
            className="notebook-playback-close-btn"
            aria-label="Close playback"
          >
            ✕
          </button>
        </div>
      )}

      {/* Audio Controls */}
      <div className="notebook-playback-controls">
        <button
          onClick={handlePlay}
          disabled={!memory.audioDataUrl}
          className="notebook-playback-play-btn"
          aria-label={isPlaying ? 'Pause playback' : 'Play audio'}
        >
          {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
        </button>

        <div className="notebook-playback-time-display">
          <span className="notebook-playback-current-time">{formatTime(currentTime)}</span>
          <span className="notebook-playback-divider">/</span>
          <span className="notebook-playback-total-time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Progress bar */}
      {memory.audioDataUrl && (
        <div
          className="notebook-playback-progress"
          onClick={handleProgressClick}
        >
          <div
            className="notebook-playback-progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Split view: Transcript (left) and Canvas (right) */}
      <div className="notebook-playback-splitview">
        {/* LEFT: Structured Transcript */}
        <div className="notebook-playback-transcript-panel">
          <h3 className="notebook-playback-section-title">Transcript</h3>
          <div
            ref={transcriptContainerRef}
            className="notebook-playback-transcript-content"
          >
            {transcript.length > 0 ? (
              <div className="notebook-playback-segments">
                {transcript.map((segment, idx) => (
                  <div
                    key={idx}
                    ref={idx === activeSegmentIndex ? activeSegmentRef : null}
                    className={`notebook-playback-segment ${
                      idx === activeSegmentIndex
                        ? 'notebook-playback-segment-active'
                        : ''
                    }`}
                    onClick={() => {
                      if (audioRef.current) {
                        audioRef.current.currentTime = segment.timestamp;
                        setCurrentTime(segment.timestamp);
                        redrawStrokes(segment.timestamp);
                      }
                    }}
                  >
                    {segment.speakerId !== undefined && (
                      <span className="notebook-playback-speaker-label">
                        Speaker {segment.speakerId}:
                      </span>
                    )}
                    <span className="notebook-playback-timestamp">
                      [{formatTime(segment.timestamp)}]
                    </span>
                    <span className="notebook-playback-text">{segment.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="notebook-playback-no-transcript">
                <p>No structured transcript available</p>
                {memory.transcript && (
                  <p className="notebook-playback-fallback-transcript">
                    {memory.transcript}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Synchronized Canvas */}
        <div className="notebook-playback-canvas-panel">
          <h3 className="notebook-playback-section-title">Strokes</h3>
          <div className="notebook-playback-canvas-wrapper">
            <canvas
              ref={canvasRef}
              className="notebook-playback-canvas"
            />
          </div>
        </div>
      </div>

      <style>{`
        .notebook-playback-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
          padding: 20px;
          gap: 16px;
          overflow: hidden;
        }

        .notebook-playback-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding-bottom: 12px;
          border-bottom: 3px solid #4CAF50;
        }

        .notebook-playback-title {
          font-size: 24px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin: 0;
          flex: 1;
        }

        .notebook-playback-close-btn {
          background: #ff4444;
          color: white;
          border: none;
          width: 48px;
          height: 48px;
          border-radius: 8px;
          font-size: 24px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .notebook-playback-close-btn:hover {
          background: #ff2222;
          transform: scale(1.05);
        }

        /* Audio Controls */
        .notebook-playback-controls {
          display: flex;
          align-items: center;
          gap: 16px;
          justify-content: flex-start;
        }

        .notebook-playback-play-btn {
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          background-color: #4CAF50;
          color: white;
          border: 3px solid #45a049;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          transition: all 0.2s ease;
          min-width: 140px;
        }

        .notebook-playback-play-btn:hover:not(:disabled) {
          background-color: #45a049;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
          transform: translateY(-2px);
        }

        .notebook-playback-play-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .notebook-playback-play-btn:disabled {
          background-color: #888;
          cursor: not-allowed;
          opacity: 0.5;
        }

        .notebook-playback-time-display {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 700;
          color: #ffff00;
          font-family: 'Courier New', monospace;
          letter-spacing: 1px;
        }

        .notebook-playback-current-time {
          min-width: 50px;
          text-align: right;
        }

        .notebook-playback-divider {
          opacity: 0.6;
        }

        .notebook-playback-total-time {
          min-width: 50px;
          text-align: left;
        }

        /* Progress Bar */
        .notebook-playback-progress {
          width: 100%;
          height: 8px;
          background-color: #444;
          border-radius: 4px;
          cursor: pointer;
          position: relative;
          border: 1px solid #666;
        }

        .notebook-playback-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #4CAF50, #45a049);
          border-radius: 4px;
          transition: width 0.05s linear;
          box-shadow: 0 0 8px rgba(76, 175, 80, 0.6);
        }

        /* Split View */
        .notebook-playback-splitview {
          display: flex;
          gap: 16px;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        /* Transcript Panel (Left) */
        .notebook-playback-transcript-panel {
          flex: 0 0 45%;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: rgba(0, 0, 0, 0.4);
          border: 2px solid #4CAF50;
          border-radius: 12px;
          padding: 16px;
          overflow: hidden;
        }

        .notebook-playback-section-title {
          font-size: 16px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #4CAF50;
          margin: 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #4CAF50;
        }

        .notebook-playback-transcript-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          scroll-behavior: smooth;
        }

        /* Custom scrollbar for transcript */
        .notebook-playback-transcript-content::-webkit-scrollbar {
          width: 12px;
        }

        .notebook-playback-transcript-content::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
        }

        .notebook-playback-transcript-content::-webkit-scrollbar-thumb {
          background: #4CAF50;
          border-radius: 6px;
        }

        .notebook-playback-transcript-content::-webkit-scrollbar-thumb:hover {
          background: #45a049;
        }

        .notebook-playback-segments {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .notebook-playback-segment {
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-left: 4px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .notebook-playback-segment:hover {
          background: rgba(76, 175, 80, 0.2);
          border-left-color: #ffff00;
        }

        .notebook-playback-segment-active {
          background: linear-gradient(90deg, rgba(76, 175, 80, 0.4), rgba(255, 255, 0, 0.2));
          border-left-color: #ffff00;
          box-shadow: 0 0 12px rgba(76, 175, 80, 0.4);
          font-weight: 600;
        }

        .notebook-playback-speaker-label {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          color: #4CAF50;
          letter-spacing: 1px;
        }

        .notebook-playback-timestamp {
          font-size: 12px;
          color: #ffff00;
          font-family: 'Courier New', monospace;
          font-weight: 700;
        }

        .notebook-playback-text {
          font-size: 16px;
          line-height: 1.5;
          color: #ffffff;
          word-break: break-word;
        }

        .notebook-playback-no-transcript {
          padding: 20px;
          text-align: center;
          color: #888;
          font-size: 14px;
        }

        .notebook-playback-fallback-transcript {
          margin-top: 12px;
          font-size: 14px;
          color: #aaa;
          line-height: 1.6;
          text-align: left;
        }

        /* Canvas Panel (Right) */
        .notebook-playback-canvas-panel {
          flex: 0 0 55%;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: rgba(0, 0, 0, 0.4);
          border: 2px solid #4CAF50;
          border-radius: 12px;
          padding: 16px;
          overflow: hidden;
        }

        .notebook-playback-canvas-wrapper {
          flex: 1;
          background: white;
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #ddd;
          min-height: 200px;
        }

        .notebook-playback-canvas {
          display: block;
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
        }

        /* Responsive: Stack on smaller screens */
        @media (max-width: 1200px) {
          .notebook-playback-splitview {
            flex-direction: column;
          }

          .notebook-playback-transcript-panel,
          .notebook-playback-canvas-panel {
            flex: 1;
            min-height: 300px;
          }
        }

        @media (max-width: 768px) {
          .notebook-playback-container {
            padding: 12px;
            gap: 12px;
          }

          .notebook-playback-title {
            font-size: 18px;
          }

          .notebook-playback-time-display {
            font-size: 16px;
          }

          .notebook-playback-text {
            font-size: 14px;
          }
        }
      `}</style>
    </div>
  );
};

export default NotebookPlayback;

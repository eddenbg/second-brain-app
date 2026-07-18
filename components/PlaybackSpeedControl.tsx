import React from 'lucide-react';

interface PlaybackSpeedControlProps {
    currentSpeed: number;
    onSpeedChange: (speed: number) => void;
}

const PlaybackSpeedControl: React.FC<PlaybackSpeedControlProps> = ({ currentSpeed, onSpeedChange }) => {
    const speeds = [0.75, 1, 1.25, 1.5, 2];

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-white/60 uppercase">Speed:</span>
            {speeds.map(speed => (
                <button
                    key={speed}
                    onClick={() => onSpeedChange(speed)}
                    className={`px-3 py-1 rounded-lg text-xs font-black uppercase transition-all ${
                        Math.abs(currentSpeed - speed) < 0.01
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    style={{ minHeight: 'unset' }}
                >
                    {speed}x
                </button>
            ))}
        </div>
    );
};

export default PlaybackSpeedControl;

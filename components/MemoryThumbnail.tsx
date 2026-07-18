import React from 'react';
import { Mic, FileText, Globe, Package, Camera, Heart } from 'lucide-react';
import type { AnyMemory } from '../types';

interface MemoryThumbnailProps {
    memory: AnyMemory;
    onClick?: () => void;
    onFavoriteToggle?: (id: string, isFavorite: boolean) => void;
}

const MemoryThumbnail: React.FC<MemoryThumbnailProps> = ({ memory, onClick, onFavoriteToggle }) => {
    const handleFavoriteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onFavoriteToggle?.(memory.id, !(memory as any).isFavorite);
    };

    const getThumbnailContent = () => {
        switch (memory.type) {
            case 'voice':
                return (
                    <div className="w-full h-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                        <Mic className="w-8 h-8 text-white" strokeWidth={3} />
                    </div>
                );
            case 'document':
                const docMemory = memory as any;
                return docMemory.imageDataUrl ? (
                    <img
                        src={docMemory.imageDataUrl}
                        alt={memory.title}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center">
                        <FileText className="w-8 h-8 text-white" strokeWidth={3} />
                    </div>
                );
            case 'web':
                return (
                    <div className="w-full h-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
                        <Globe className="w-8 h-8 text-white" strokeWidth={3} />
                    </div>
                );
            case 'item':
                const itemMemory = memory as any;
                return itemMemory.imageDataUrl ? (
                    <img
                        src={itemMemory.imageDataUrl}
                        alt={memory.title}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                        <Package className="w-8 h-8 text-white" strokeWidth={3} />
                    </div>
                );
            case 'video':
                const videoMemory = memory as any;
                return videoMemory.videoDataUrl ? (
                    <video
                        src={videoMemory.videoDataUrl}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center">
                        <Camera className="w-8 h-8 text-white" strokeWidth={3} />
                    </div>
                );
            default:
                return (
                    <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                        <FileText className="w-8 h-8 text-gray-400" strokeWidth={3} />
                    </div>
                );
        }
    };

    return (
        <button
            onClick={onClick}
            className="relative group overflow-hidden rounded-xl border-2 border-gray-600 hover:border-gray-400 transition-all aspect-square bg-gray-800"
        >
            {getThumbnailContent()}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-end justify-between p-2">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs font-black line-clamp-2">{memory.title}</p>
                </div>
            </div>

            {/* Favorite button */}
            <button
                onClick={handleFavoriteClick}
                className="absolute top-2 right-2 p-1 rounded-full bg-white/80 hover:bg-white transition-all opacity-0 group-hover:opacity-100"
                aria-label={`${(memory as any).isFavorite ? 'Remove from' : 'Add to'} favorites`}
            >
                <Heart
                    className={`w-4 h-4 transition-colors ${(memory as any).isFavorite ? 'text-red-600 fill-red-600' : 'text-gray-600'}`}
                    strokeWidth={3}
                />
            </button>
        </button>
    );
};

export default MemoryThumbnail;

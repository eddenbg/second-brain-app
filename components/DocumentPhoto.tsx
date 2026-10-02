import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { AnyMemory } from '../types';
import { getLocal, localKey } from '../utils/mediaStore';

// The original photo of a scanned page, shown above its extracted text so
// OCR mistakes are easy to spot. Tap to open it full size (scroll / zoom).
const DocumentPhoto: React.FC<{ memory: AnyMemory }> = ({ memory }) => {
    const inline = (memory as any).imageDataUrl as string | undefined;
    const [src, setSrc] = useState<string | undefined>(inline);
    const [fullSize, setFullSize] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setSrc(inline);
        if (!inline && memory.localImage) {
            getLocal<string>(localKey(memory.id, 'image')).then(v => { if (!cancelled && v) setSrc(v); });
        }
        return () => { cancelled = true; };
    }, [memory.id, inline]);

    if (!src) {
        return memory.localImage
            ? <p className="text-white/50 text-sm font-bold">The photo is saved on the device you scanned with.</p>
            : null;
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setFullSize(true)}
                aria-label="Open the original photo full size"
                className="block w-full p-0 bg-transparent border-0"
                style={{ minHeight: 'unset' }}
            >
                <img src={src} alt={`Original photo: ${memory.title}`} className="w-full max-h-[50vh] object-contain rounded-2xl border-2 border-white/20 bg-black/30" />
                <span className="block text-white/50 text-xs font-bold uppercase tracking-widest mt-2">Tap the photo to enlarge</span>
            </button>
            {fullSize && (
                <div className="fixed inset-0 z-[400] bg-black flex flex-col" role="dialog" aria-label="Original photo">
                    <div className="flex justify-end p-3 shrink-0">
                        <button
                            onClick={() => setFullSize(false)}
                            aria-label="Close photo"
                            className="w-14 h-14 rounded-2xl bg-white/10 border-2 border-white/30 flex items-center justify-center"
                            style={{ minHeight: 'unset' }}
                        >
                            <X className="w-8 h-8 text-white" strokeWidth={3} />
                        </button>
                    </div>
                    {/* Natural size inside a scroll area: drag to move around, pinch to zoom */}
                    <div className="flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
                        <img src={src} alt={`Original photo: ${memory.title}`} className="max-w-none" style={{ width: '200%' }} />
                    </div>
                </div>
            )}
        </>
    );
};

export default DocumentPhoto;

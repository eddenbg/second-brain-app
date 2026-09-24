// Image helpers. Raw camera/gallery images are only ever held in memory for
// OCR — what gets persisted is a small thumbnail (or, for belongings, a
// compressed photo) so documents stay well under Firestore's 1 MB limit and
// never bloat localStorage.

export const THUMBNAIL_MAX_WIDTH = 200;
export const THUMBNAIL_QUALITY = 0.3;

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = src;
    });

/** Draw `source` into a JPEG no wider/taller than `maxDim`. */
const renderJpeg = (img: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, width: number, height: number, maxDim: number, quality: number, limitWidthOnly = false): string => {
    const scale = limitWidthOnly
        ? Math.min(1, maxDim / width)
        : Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    // Release the backing store right away (matters on mobile Safari)
    canvas.width = 0;
    canvas.height = 0;
    return out;
};

/** Resize an image (data URL, blob URL or File) to a JPEG data URL. */
export const resizeImage = async (source: string | Blob, maxDim: number, quality: number): Promise<string> => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    try {
        const img = await loadImage(url);
        return renderJpeg(img, img.naturalWidth, img.naturalHeight, maxDim, quality);
    } finally {
        if (typeof source !== 'string') URL.revokeObjectURL(url);
    }
};

/** Small preview: max 200px wide, JPEG quality 0.3 (a few KB). */
export const createThumbnail = async (source: string | Blob): Promise<string> => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    try {
        const img = await loadImage(url);
        return renderJpeg(img, img.naturalWidth, img.naturalHeight, THUMBNAIL_MAX_WIDTH, THUMBNAIL_QUALITY, true);
    } finally {
        if (typeof source !== 'string') URL.revokeObjectURL(url);
    }
};

/** Thumbnail straight from a canvas (e.g. a camera capture). */
export const createThumbnailFromCanvas = (canvas: HTMLCanvasElement): string =>
    renderJpeg(canvas, canvas.width, canvas.height, THUMBNAIL_MAX_WIDTH, THUMBNAIL_QUALITY, true);

/**
 * Prepare a gallery file / capture for OCR: a downscaled JPEG that is sent to
 * the AI and then discarded. Never persist the returned value.
 */
export const prepareImageForOcr = (source: string | Blob): Promise<string> =>
    resizeImage(source, 1600, 0.85);

/** Split a data URL into the base64 payload and its mime type. */
export const splitDataUrl = (dataUrl: string): { base64: string; mimeType: string } => ({
    base64: dataUrl.split(',')[1] || '',
    mimeType: dataUrl.match(/^data:([^;]+);/)?.[1] || 'image/jpeg',
});

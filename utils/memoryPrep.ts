import type { AnyMemory, NotebookData, TranscriptSegment } from '../types';
import { putLocal, localKey } from './mediaStore';

// Firestore rejects documents over 1 MB (a few minutes of recorded audio
// already exceeds that). Before a memory goes to the cloud, large parts are
// moved to device storage and the rest is compacted, so saving never fails
// because of size.

const MAX_CLOUD_BYTES = 900_000;
// Timestamped transcript pieces are merged into chunks of about this length
const SEGMENT_MERGE_SECONDS = 5;

const isDataUrl = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:');

export const cloudSize = (m: unknown): number => {
    try { return new Blob([JSON.stringify(m)]).size; } catch { return JSON.stringify(m).length * 2; }
};

const mergeSegments = (segments: TranscriptSegment[]): TranscriptSegment[] => {
    const out: TranscriptSegment[] = [];
    for (const seg of segments) {
        const last = out[out.length - 1];
        if (last && seg.timestamp - last.timestamp < SEGMENT_MERGE_SECONDS && last.speakerId === seg.speakerId) {
            last.text += seg.text;
        } else {
            out.push({ ...seg, timestamp: Math.round(seg.timestamp * 10) / 10 });
        }
    }
    return out;
};

const compactNotebook = (nb: NotebookData): NotebookData => ({
    ...nb,
    strokes: (nb.strokes || []).map(s => ({
        ...s,
        points: s.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), t: Math.round(p.t) })),
    })),
});

export const prepareMemoryForCloud = async (memory: AnyMemory): Promise<AnyMemory> => {
    const m: any = { ...memory };
    const id = m.id as string;

    // 1. Recorded audio/video never goes to the cloud — keep it on this device
    for (const field of ['videoDataUrl', 'audioDataUrl'] as const) {
        if (isDataUrl(m[field]) && m.type !== 'item') {
            try {
                await putLocal(localKey(id, 'audio'), m[field]);
                m.localMedia = true;
            } catch (e) {
                console.warn('Could not keep audio on this device', e);
            }
            delete m[field];
        }
    }
    if (m.voiceNote && isDataUrl(m.voiceNote.audioDataUrl)) {
        const { audioDataUrl, ...rest } = m.voiceNote;
        m.voiceNote = rest;
    }

    // 2. Compact the transcript timeline and drawings
    if (Array.isArray(m.structuredTranscript) && m.structuredTranscript.length > 0) {
        m.structuredTranscript = mergeSegments(m.structuredTranscript);
    }
    if (m.notebook?.strokes) m.notebook = compactNotebook(m.notebook);

    // 3. Still too big (very long lecture with lots of writing): move the
    //    biggest parts to this device
    if (cloudSize(m) > MAX_CLOUD_BYTES && m.notebook) {
        await putLocal(localKey(id, 'notebook'), m.notebook).catch(() => {});
        delete m.notebook;
        m.localNotebook = true;
    }
    if (cloudSize(m) > MAX_CLOUD_BYTES && m.structuredTranscript) {
        await putLocal(localKey(id, 'structuredTranscript'), m.structuredTranscript).catch(() => {});
        delete m.structuredTranscript;
        m.localStructuredTranscript = true;
    }
    if (cloudSize(m) > MAX_CLOUD_BYTES && typeof m.transcript === 'string') {
        // Extremely long transcript: keep the full text on device, the cloud copy is trimmed
        await putLocal(`${id}:transcript`, m.transcript).catch(() => {});
        m.transcript = m.transcript.slice(0, 250_000) + '\n\n[Transcript continues on the device it was recorded on.]';
    }
    // Firestore rejects `undefined` values
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    return m as AnyMemory;
};

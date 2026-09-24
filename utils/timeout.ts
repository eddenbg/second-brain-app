// Promise timeout helpers so a hung network/AI call can never leave the UI
// stuck on a spinner.

export class TimeoutError extends Error {
    constructor(message = 'Operation timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}

/** Reject with TimeoutError if `promise` hasn't settled within `ms`. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, message?: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); }
        );
    });

/** Title used when AI title generation fails or times out. */
export const fallbackTitle = (text: string | undefined | null, label = 'Recording'): string => {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (words.length > 0) return words.join(' ');
    return `${label} ${new Date().toLocaleDateString()}`;
};

/** True for AI placeholder titles that mean "no real title was generated". */
export const isPlaceholderTitle = (title: string | undefined | null): boolean =>
    !title || ['untitled', 'voice note'].includes(title.trim().toLowerCase());

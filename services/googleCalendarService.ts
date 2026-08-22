import type { CalendarEvent } from '../types';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { retryWithExponentialBackoff } from '../utils/retryWithExponentialBackoff';

const CLIENT_ID_STORAGE_KEY = 'google_oauth_client_id';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_KEY = 'google_cal_token';
const TOKEN_EXPIRY_KEY = 'google_cal_token_expiry';

/**
 * Fired on `window` every time the stored Calendar token is written or
 * cleared (connect, disconnect, or a 401 discovered mid-fetch). Nothing about
 * a localStorage write is reactive on its own — the native `storage` event
 * does not even fire in the tab that made the change — so anything that needs
 * to notice a token appearing or disappearing (the Schedule view's fetch
 * effect, Settings' connection-status display) listens for this instead of
 * polling.
 */
export const GOOGLE_TOKEN_CHANGE_EVENT = 'google-calendar-token-changed';

const notifyTokenChanged = (): void => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(GOOGLE_TOKEN_CHANGE_EVENT));
};

const getClientId = (): string =>
    localStorage.getItem(CLIENT_ID_STORAGE_KEY) || process.env.GOOGLE_CLIENT_ID || '';

export const saveGoogleClientId = (id: string): void => {
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, id.trim());
};

export const getStoredGoogleClientId = (): string =>
    localStorage.getItem(CLIENT_ID_STORAGE_KEY) || process.env.GOOGLE_CLIENT_ID || '';

declare global {
    interface Window {
        google?: any;
    }
}

let scriptLoaded = false;

export const loadGIS = (): Promise<void> => {
    if (scriptLoaded || window.google?.accounts) {
        scriptLoaded = true;
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => { scriptLoaded = true; resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

export const getStoredToken = (): string | null => {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (token && expiry && Date.now() < parseInt(expiry)) return token;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
};

export const connectGoogleCalendar = (): Promise<string> => {
    const clientId = getClientId();
    if (!clientId) return Promise.reject(new Error('No Google Client ID configured'));
    return loadGIS().then(() => new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPE,
            callback: (response: any) => {
                if (response.error) { reject(new Error(response.error)); return; }
                const token = response.access_token;
                const expiry = Date.now() + (response.expires_in - 60) * 1000;
                localStorage.setItem(TOKEN_KEY, token);
                localStorage.setItem(TOKEN_EXPIRY_KEY, expiry.toString());
                notifyTokenChanged();
                resolve(token);
            }
        });
        client.requestAccessToken({ prompt: 'consent' });
    }));
};

export const saveGoogleToken = (token: string, expiresInSeconds = 3600): void => {
    const expiry = Date.now() + (expiresInSeconds - 60) * 1000;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiry.toString());
    notifyTokenChanged();
};

export const disconnectGoogleCalendar = () => {
    const token = getStoredToken();
    if (token && window.google?.accounts?.oauth2) {
        window.google.accounts.oauth2.revoke(token);
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    notifyTokenChanged();
};

export const fetchGoogleCalendarEvents = async (token: string): Promise<CalendarEvent[]> => {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`;
    const response = await retryWithExponentialBackoff(() =>
        fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }),
        { maxRetries: 3, initialDelayMs: 1000 }
    );

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(TOKEN_EXPIRY_KEY);
            notifyTokenChanged();
        }
        const error = new Error(`Calendar API error: ${response.status}`) as Error & { code?: string };
        if (response.status === 401) error.code = 'GOOGLE_AUTH_EXPIRED';
        throw error;
    }

    const data = await response.json();
    return (data.items || []).map((item: any): CalendarEvent => ({
        id: `google-${item.id}`,
        title: item.summary || 'Untitled Event',
        startTime: item.start?.dateTime || item.start?.date || now.toISOString(),
        endTime: item.end?.dateTime || item.end?.date || now.toISOString(),
        category: 'personal',
        description: item.description,
        source: 'google'
    }));
};

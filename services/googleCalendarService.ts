import type { CalendarEvent } from '../types';

const CLIENT_ID_STORAGE_KEY = 'google_oauth_client_id';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_KEY = 'google_cal_token';
const TOKEN_EXPIRY_KEY = 'google_cal_token_expiry';

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
                resolve(token);
            }
        });
        client.requestAccessToken({ prompt: 'consent' });
    }));
};

export const disconnectGoogleCalendar = () => {
    const token = getStoredToken();
    if (token && window.google?.accounts?.oauth2) {
        window.google.accounts.oauth2.revoke(token);
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
};

export const fetchGoogleCalendarEvents = async (token: string): Promise<CalendarEvent[]> => {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(TOKEN_EXPIRY_KEY);
        }
        throw new Error(`Calendar API error: ${response.status}`);
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

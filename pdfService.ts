import type { CalendarEvent } from '../types';

export async function fetchGoogleCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
    const timeMin = new Date().toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&singleEvents=true&orderBy=startTime`;
    
    try {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                console.warn("Google API token expired or invalid.");
            }
            throw new Error(`Google Calendar API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.items) {
            return data.items.map((e: any) => ({
                id: `google_${e.id}`,
                title: e.summary,
                startTime: e.start.dateTime || e.start.date,
                endTime: e.end.dateTime || e.end.date,
                category: 'personal',
                description: e.description,
                source: 'google',
            }));
        }
    } catch (error) {
        console.error("Failed to fetch Google Calendar events:", error);
        throw error;
    }

    return [];
}
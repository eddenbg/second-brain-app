export interface Location {
    latitude: number;
    longitude: number;
}

export interface NamedLocation {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number; // how close to count as "this location"
}

const SAVED_LOCATIONS_KEY = 'second_brain_locations';

const DEFAULT_LOCATIONS: NamedLocation[] = [
    // Pre-seeded with the user's known locations – can be edited in Settings
    { name: 'Home (Tzor\'on)', latitude: 32.9191, longitude: 35.5023, radiusMeters: 300 },
    { name: 'Hostel (Mevaseret Zion)', latitude: 31.8054, longitude: 35.1536, radiusMeters: 300 },
];

function getSavedLocations(): NamedLocation[] {
    try {
        const stored = localStorage.getItem(SAVED_LOCATIONS_KEY);
        if (stored) return JSON.parse(stored) as NamedLocation[];
    } catch {}
    return DEFAULT_LOCATIONS;
}

export function saveNamedLocation(loc: NamedLocation): void {
    const locations = getSavedLocations();
    const idx = locations.findIndex(l => l.name === loc.name);
    if (idx >= 0) locations[idx] = loc;
    else locations.push(loc);
    localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(locations));
}

/** Haversine distance in meters between two coords */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Returns the name of a known location if GPS matches, otherwise null */
export function resolveLocationName(lat: number, lon: number): string | null {
    const locations = getSavedLocations();
    for (const loc of locations) {
        if (distanceMeters(lat, lon, loc.latitude, loc.longitude) <= loc.radiusMeters) {
            return loc.name;
        }
    }
    return null;
}

export const getCurrentLocation = (): Promise<Location | null> => {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
};

/** Gets current GPS position AND resolves it to a named location string */
export const getLocationName = async (): Promise<string | null> => {
    const loc = await getCurrentLocation();
    if (!loc) return null;
    return resolveLocationName(loc.latitude, loc.longitude);
};

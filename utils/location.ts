export interface Location {
    latitude: number;
    longitude: number;
}

export const getCurrentLocation = (): Promise<Location | null> => {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve(null);
        }
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            }),
            () => resolve(null), // Error or permission denied
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
};

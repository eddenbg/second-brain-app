import { useState, useEffect, useCallback } from 'react';

export const useServiceWorker = () => {
    const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    const onUpdate = useCallback((registration: ServiceWorkerRegistration) => {
        if (registration.waiting) {
            setWaitingWorker(registration.waiting);
            setUpdateAvailable(true);
        }
    }, []);

    useEffect(() => {
        const registerSW = () => {
            if ('serviceWorker' in navigator) {
                // Use the simplest, most robust relative path.
                navigator.serviceWorker.register('./sw.js').then(registration => {
                    if (registration.waiting) {
                        onUpdate(registration);
                    }
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (newWorker.state === 'installed') {
                                    onUpdate(registration);
                                }
                            });
                        }
                    });
                }).catch(error => {
                    console.error('Service Worker registration failed:', error);
                });

                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (!refreshing) {
                        window.location.reload();
                        refreshing = true;
                    }
                });
            }
        };

        window.addEventListener('load', registerSW);
        return () => window.removeEventListener('load', registerSW);

    }, [onUpdate]);

    const updateServiceWorker = useCallback(() => {
        if (waitingWorker) {
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
    }, [waitingWorker]);

    return { updateAvailable, updateServiceWorker };
};

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
        if ('serviceWorker' in navigator) {
            const handleRegistration = () => {
                // Construct an absolute URL for the service worker to avoid cross-origin issues.
                const swUrl = `${window.location.origin}/sw.js`;
                navigator.serviceWorker.register(swUrl).then(registration => {
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
            };

            // Wait until the page is fully loaded before trying to register the service worker.
            window.addEventListener('load', handleRegistration);

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    window.location.reload();
                    refreshing = true;
                }
            });

            // Cleanup the event listener when the component unmounts.
            return () => {
                window.removeEventListener('load', handleRegistration);
            };
        }
    }, [onUpdate]);

    const updateServiceWorker = useCallback(() => {
        if (waitingWorker) {
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
    }, [waitingWorker]);

    return { updateAvailable, updateServiceWorker };
};

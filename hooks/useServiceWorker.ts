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
            const registerAndListen = () => {
                navigator.serviceWorker.register('sw.js').then(registration => {
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
            
            // Register the service worker once the page is fully loaded.
            window.addEventListener('load', registerAndListen);

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    window.location.reload();
                    refreshing = true;
                }
            });

            // Cleanup the event listener when the component unmounts.
            return () => {
                window.removeEventListener('load', registerAndListen);
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

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
                // Fix: Force the registration to use the current window's origin
                // to avoid mismatch errors in proxied preview environments.
                const swUrl = new URL('sw.js', window.location.href).href;
                
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
            
            if (document.readyState === 'complete') {
                registerAndListen();
            } else {
                window.addEventListener('load', registerAndListen);
                return () => window.removeEventListener('load', registerAndListen);
            }

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!refreshing) {
                    window.location.reload();
                    refreshing = true;
                }
            });
        }
    }, [onUpdate]);

    const updateServiceWorker = useCallback(() => {
        if (waitingWorker) {
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
    }, [waitingWorker]);

    return { updateAvailable, updateServiceWorker };
};
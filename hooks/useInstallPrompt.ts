
import { useState, useEffect } from 'react';
import { getInstallPrompt, clearInstallPrompt } from '../index';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => getInstallPrompt() as BeforeInstallPromptEvent | null
  );
  const [isInstallable, setIsInstallable] = useState(
    () => getInstallPrompt() !== null
  );

  useEffect(() => {
    // Pick up prompt if it was already captured before React mounted
    const existing = getInstallPrompt();
    if (existing) {
      setDeferredPrompt(existing as BeforeInstallPromptEvent);
      setIsInstallable(true);
    }

    // Also listen for future firings (e.g. after dismissal + re-visit)
    const onReady = () => {
      const prompt = getInstallPrompt();
      if (prompt) {
        setDeferredPrompt(prompt as BeforeInstallPromptEvent);
        setIsInstallable(true);
      }
    };
    window.addEventListener('installpromptready', onReady);
    return () => window.removeEventListener('installpromptready', onReady);
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    (deferredPrompt as BeforeInstallPromptEvent).prompt();
    const { outcome } = await (deferredPrompt as BeforeInstallPromptEvent).userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setDeferredPrompt(null);
      clearInstallPrompt();
    }
  };

  return { isInstallable, installApp };
};

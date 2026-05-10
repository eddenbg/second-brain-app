
import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const getPrompt = (): BeforeInstallPromptEvent | null =>
  (window as any).__installPrompt ?? null;

export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(getPrompt);
  const [isInstallable, setIsInstallable] = useState(() => getPrompt() !== null);

  useEffect(() => {
    // Pick up prompt captured before React mounted
    const existing = getPrompt();
    if (existing && !deferredPrompt) {
      setDeferredPrompt(existing);
      setIsInstallable(true);
    }

    const onReady = () => {
      const prompt = getPrompt();
      if (prompt) {
        setDeferredPrompt(prompt);
        setIsInstallable(true);
      }
    };
    window.addEventListener('installpromptready', onReady);
    return () => window.removeEventListener('installpromptready', onReady);
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      (window as any).__installPrompt = null;
      setDeferredPrompt(null);
      setIsInstallable(false);
    }
  };

  return { isInstallable, installApp };
};

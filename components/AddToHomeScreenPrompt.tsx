import React, { useState, useEffect } from 'react';
import { PlusCircleIcon, XIcon } from './Icons';

// The BeforeInstallPromptEvent is a non-standard event, so we need to define its type.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const AddToHomeScreenPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Update UI to notify the user they can add to home screen
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Listen for the appinstalled event
    const handleAppInstalled = () => {
        // Hide the prompt if the app is installed
        setIsVisible(false);
        setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);


    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }
    // Show the prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    await deferredPrompt.userChoice;
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
    // Hide the banner
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 text-white py-3 px-6 rounded-lg shadow-lg flex items-center gap-4 animate-fade-in-up w-11/12 max-w-md">
      <PlusCircleIcon className="w-8 h-8 text-blue-400 flex-shrink-0" />
      <div className="flex-grow">
        <p className="font-semibold">Add to Home Screen</p>
        <p className="text-sm text-gray-400">Install this app for offline use and easy access.</p>
      </div>
      <button
        onClick={handleInstallClick}
        className="flex-shrink-0 bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
      >
        Install
      </button>
      <button onClick={handleDismiss} className="p-2 rounded-full hover:bg-gray-700 flex-shrink-0">
        <XIcon className="w-5 h-5" />
      </button>
    </div>
  );
};

export default AddToHomeScreenPrompt;
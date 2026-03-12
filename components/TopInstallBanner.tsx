import React from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { PlusCircleIcon, XIcon, CheckIcon } from './Icons';

const TopInstallBanner: React.FC = () => {
    const { isInstallable, installApp } = useInstallPrompt();
    const [dismissed, setDismissed] = React.useState(false);

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    // If already standalone, or dismissed, or browser doesn't support the prompt, hide it.
    if (!isInstallable || isStandalone || dismissed) {
        return null;
    }

    return (
        <div 
            className="bg-blue-600 border-b-4 border-blue-400 p-4 flex items-center justify-between gap-4 shadow-2xl"
            role="alert"
            aria-live="polite"
        >
            <div className="flex items-center gap-3">
                <PlusCircleIcon className="w-8 h-8 text-white" />
                <p className="text-sm font-black text-white uppercase tracking-tight leading-tight">Install App for full experience</p>
            </div>
            
            <div className="flex items-center gap-2">
                <button 
                    onClick={installApp}
                    className="px-4 py-2 bg-white text-blue-600 font-black text-xs rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-2"
                >
                    INSTALL
                </button>
                <button 
                    onClick={() => setDismissed(true)}
                    className="p-2 text-blue-200"
                    aria-label="Dismiss"
                >
                    <XIcon className="w-6 h-6" />
                </button>
            </div>
        </div>
    );
};

export default TopInstallBanner;

import React, { useMemo } from 'react';
import { XIcon, LogOutIcon, SettingsIcon, PlusCircleIcon, CheckIcon, UploadIcon, RefreshCwIcon, Loader2Icon } from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth, getCurrentConfig } from '../utils/firebase';
import { signOut } from 'firebase/auth';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
    hasUnsavedChanges?: boolean;
    onSync?: () => Promise<void>;
    onFetch?: () => Promise<void>;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose, hasUnsavedChanges, onSync, onFetch }) => {
    const { isInstallable, installApp } = useInstallPrompt();
    
    const handleSignOut = async () => {
        if(window.confirm("Are you sure you want to sign out?")) {
            // @ts-ignore
            if (auth && auth.type === 'mock') {
                // @ts-ignore
                await auth.signOut();
            } else {
                await signOut(auth);
            }
            onClose();
        }
    };

    const currentConfig = getCurrentConfig();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    const isIOS = useMemo(() => {
        return [
            'iPad Simulator',
            'iPhone Simulator',
            'iPod Simulator',
            'iPad',
            'iPhone',
            'iPod'
        ].includes(navigator.platform)
        || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    }, []);

    const handleIOSInstallInstructions = () => {
        alert("To install on iPhone/iPad:\n\n1. Tap the 'Share' button (the square with an arrow pointing up at the bottom of Safari).\n2. Scroll down and tap 'Add to Home Screen'.\n3. Tap 'Add' in the top right.\n\nThe app will now appear on your home screen without browser bars.");
    };

    return (
         <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 id="settings-title" className="text-2xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700" aria-label="Close Settings">
                        <XIcon className="w-8 h-8 text-gray-300"/>
                    </button>
                </header>
                <div className="p-6 space-y-8 max-h-[80vh] overflow-y-auto">
                    
                    {/* INSTALLATION SECTION - PRIORITY */}
                    <div className="space-y-4">
                        <h3 className="text-blue-400 font-bold text-sm uppercase tracking-wider">Application Mode</h3>
                        {isStandalone ? (
                            <div className="flex items-center gap-3 p-4 bg-green-900 bg-opacity-30 border border-green-500 rounded-xl text-green-400" role="status">
                                <CheckIcon className="w-8 h-8 flex-shrink-0" />
                                <div>
                                    <p className="font-bold text-lg">Installed Mode</p>
                                    <p className="text-sm opacity-80">Full-screen active</p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {isInstallable ? (
                                    <button 
                                        onClick={installApp}
                                        className="w-full flex items-center justify-center gap-4 p-5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xl rounded-xl shadow-xl transition-all border-b-4 border-blue-800 active:border-b-0 active:translate-y-1"
                                        aria-label="Install Second Brain App"
                                    >
                                        <PlusCircleIcon className="w-8 h-8" />
                                        INSTALL APP
                                    </button>
                                ) : isIOS ? (
                                    <button 
                                        onClick={handleIOSInstallInstructions}
                                        className="w-full flex items-center justify-center gap-4 p-5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xl rounded-xl shadow-xl transition-all border-b-4 border-blue-800 active:border-b-0 active:translate-y-1"
                                        aria-label="Learn how to Add to Home Screen on iPhone"
                                    >
                                        <PlusCircleIcon className="w-8 h-8" />
                                        INSTALL APP
                                    </button>
                                ) : (
                                    <div className="p-4 bg-gray-700 rounded-xl border border-gray-600">
                                        <p className="text-white text-sm">Open your browser menu and select <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong> for the best experience.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* CLOUD SYNC SECTION */}
                    <div className="border-t border-gray-700 pt-6 space-y-4">
                        <h3 className="text-indigo-400 font-bold text-sm uppercase tracking-wider">Cloud Data</h3>
                        <div className="grid grid-cols-1 gap-4">
                            <button 
                                onClick={() => onSync?.()}
                                className={`w-full flex items-center justify-center gap-4 p-5 rounded-xl font-black text-lg transition-all border-b-4 active:border-b-0 active:translate-y-1 ${hasUnsavedChanges ? 'bg-green-600 text-white border-green-800 shadow-lg' : 'bg-gray-700 text-gray-500 border-gray-800'}`}
                                aria-label="Upload changes to cloud"
                            >
                                <UploadIcon className="w-7 h-7" />
                                PUSH TO CLOUD
                            </button>
                            
                            <button 
                                onClick={() => {
                                    if (window.confirm("This will replace your local notes with the cloud version. Continue?")) {
                                        onFetch?.();
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-4 p-5 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl border-b-4 border-gray-900 active:border-b-0 active:translate-y-1"
                                aria-label="Download latest data from cloud"
                            >
                                <RefreshCwIcon className="w-7 h-7" />
                                FETCH FROM CLOUD
                            </button>
                        </div>
                        {hasUnsavedChanges && (
                            <p className="text-yellow-400 text-center font-bold animate-pulse" role="alert">
                                You have unsaved changes.
                            </p>
                        )}
                    </div>

                    {/* ACCOUNT SECTION */}
                    <div className="border-t border-gray-700 pt-6 space-y-4">
                        <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wider">Account</h3>
                        <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-xs mb-1">Signed in as:</p>
                            <p className="text-white font-bold break-all text-lg">{syncId}</p>
                        </div>
                        <button 
                            onClick={handleSignOut} 
                            className="w-full p-5 bg-red-600 text-white font-bold rounded-xl border-b-4 border-red-800 active:border-b-0 active:translate-y-1 transition-all"
                            aria-label="Sign out of your account"
                        >
                            <LogOutIcon className="w-6 h-6 inline mr-2"/> Sign Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;

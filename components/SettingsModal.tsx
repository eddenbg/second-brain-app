
import React from 'react';
import { XIcon, LogOutIcon, SettingsIcon, PlusCircleIcon, CheckIcon } from './Icons';
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
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose }) => {
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
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    return (
         <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
                    
                    {/* Device & PWA Section */}
                    <div className="space-y-3">
                        <h3 className="text-gray-400 font-bold text-xs uppercase tracking-wider">App Installation</h3>
                        {isStandalone ? (
                            <div className="flex items-center gap-3 p-4 bg-green-900 bg-opacity-20 border border-green-700 rounded-lg text-green-400">
                                <CheckIcon className="w-6 h-6" />
                                <span className="font-semibold">App is installed & standalone</span>
                            </div>
                        ) : isInstallable ? (
                            <button 
                                onClick={installApp}
                                className="w-full flex items-center justify-center gap-3 p-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg transition-all"
                            >
                                <PlusCircleIcon className="w-6 h-6" />
                                Install as Full-Screen App
                            </button>
                        ) : (
                            <div className="p-4 bg-gray-700 rounded-lg text-gray-300 text-sm">
                                <p>To enable full-screen mode, use the browser menu (⋮) and select "Install App" or "Add to Home Screen".</p>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-700 pt-6">
                        <p className="text-gray-400 text-sm mb-1">Signed in as:</p>
                        <p className="text-white font-semibold text-lg break-all">{syncId}</p>
                    </div>

                    <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                        <h3 className="text-gray-300 font-bold mb-2 flex items-center gap-2">
                            <SettingsIcon className="w-4 h-4"/> Sync Details
                        </h3>
                        <p className="text-xs text-gray-500 mb-1">Project ID:</p>
                        <p className="text-white font-mono text-sm mb-3">{currentConfig?.projectId || 'Not Configured'}</p>
                    </div>
                    
                    <div className="pt-2">
                         <button onClick={handleSignOut} className="w-full px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                            <LogOutIcon className="w-5 h-5"/> Sign Out
                         </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;

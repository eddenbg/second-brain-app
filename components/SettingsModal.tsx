
import React from 'react';
import { XIcon, LogOutIcon, SettingsIcon } from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth, getCurrentConfig } from '../utils/firebase';
import { signOut } from 'firebase/auth';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose }) => {
    
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

    return (
         <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <div className="p-6 space-y-6">
                    <div className="border-b border-gray-700 pb-6">
                        <p className="text-gray-400 text-sm mb-1">Signed in as:</p>
                        <p className="text-white font-semibold text-lg break-all">{syncId}</p>
                    </div>

                    <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                        <h3 className="text-gray-300 font-bold mb-2 flex items-center gap-2">
                            <SettingsIcon className="w-4 h-4"/> Connection Details
                        </h3>
                        <p className="text-xs text-gray-500 mb-1">Project ID:</p>
                        <p className="text-white font-mono text-sm mb-3">{currentConfig?.projectId || 'Not Configured'}</p>
                        
                        <p className="text-xs text-gray-500 mb-1">Auth Domain:</p>
                        <p className="text-white font-mono text-sm">{currentConfig?.authDomain || 'Not Configured'}</p>
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

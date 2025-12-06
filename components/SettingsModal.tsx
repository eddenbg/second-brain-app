import React from 'react';
import { XIcon, LogOutIcon } from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth } from '../utils/firebase';
import { signOut } from 'firebase/auth';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose }) => {

    const handleSignOut = () => {
        if(window.confirm("Are you sure you want to sign out?")) {
            signOut(auth);
            onClose();
        }
    };

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
                        <p className="text-white font-semibold text-lg">{syncId}</p>
                    </div>
                    
                    <div className="pt-4">
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
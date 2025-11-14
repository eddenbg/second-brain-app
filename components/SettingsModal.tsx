import React, { useState } from 'react';
import { XIcon, CheckIcon, CopyIcon } from './Icons';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose, onReset }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(syncId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
         <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Sync Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-lg font-medium text-gray-300 mb-2">Your Sync ID</label>
                        <p className="text-sm text-gray-400 mb-2">Use this ID to sync your data on other devices. Keep it safe!</p>
                        <div className="flex gap-2">
                           <input 
                                type="text"
                                value={syncId}
                                readOnly
                                className="w-full bg-gray-700 text-gray-300 text-sm p-3 rounded-md border border-gray-600"
                            />
                           <button onClick={handleCopy} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                               {copied ? <CheckIcon className="w-5 h-5"/> : <CopyIcon className="w-5 h-5"/>} {copied ? 'Copied!' : 'Copy'}
                           </button>
                        </div>
                    </div>
                    <div>
                         <button onClick={onReset} className="w-full px-4 py-3 bg-red-800 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors">
                            Change Sync ID
                         </button>
                         <p className="text-xs text-gray-500 mt-2">This will disconnect this device. Your local data will remain, but it will no longer sync until you set up a new ID.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;

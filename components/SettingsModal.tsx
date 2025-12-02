
import React, { useState, useRef } from 'react';
import { XIcon, CheckIcon, CopyIcon, UploadIcon, ExternalLinkIcon } from './Icons';
import type { StoredData } from '../hooks/useRecordings';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose, onReset, data, onImport }) => {
    const [copied, setCopied] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleCopy = () => {
        navigator.clipboard.writeText(syncId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleExport = () => {
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `second-brain-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed.memories)) {
                    onImport(parsed);
                    setImportError(null);
                    alert("Backup restored successfully!");
                    onClose();
                } else {
                    setImportError("Invalid backup file format.");
                }
            } catch (err) {
                setImportError("Failed to parse backup file.");
            }
        };
        reader.readAsText(file);
    };

    const handleOpenInNewTab = () => {
        window.open(window.location.href, '_blank');
    };
    
    // Generate a URL that will auto-login the other device
    const connectUrl = `${window.location.origin}/?connect=${syncId}`;
    // Use a free API to generate a QR code for the connect URL
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(connectUrl)}`;

    return (
         <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600 max-h-[90vh] overflow-y-auto">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <div className="p-6 space-y-8">
                    
                    {/* Sync Section with QR */}
                    <div className="border-b border-gray-700 pb-6">
                        <h3 className="text-lg font-bold text-white mb-2">Connect New Device</h3>
                        <p className="text-sm text-gray-400 mb-4">Scan this on your phone to instantly sync.</p>
                        <div className="flex justify-center bg-white p-2 rounded-lg w-fit mx-auto mb-4">
                            <img src={qrCodeUrl} alt="Scan to sync" className="w-32 h-32" />
                        </div>
                        
                        <label className="block text-sm font-medium text-gray-300 mb-1">Or Copy Sync ID:</label>
                        <div className="flex gap-2">
                           <input 
                                type="text"
                                value={syncId}
                                readOnly
                                className="w-full bg-gray-700 text-gray-300 text-sm p-3 rounded-md border border-gray-600"
                            />
                           <button onClick={handleCopy} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                               {copied ? <CheckIcon className="w-5 h-5"/> : <CopyIcon className="w-5 h-5"/>}
                           </button>
                        </div>
                    </div>

                    {/* Data Management Section */}
                    <div>
                        <h3 className="text-lg font-bold text-white mb-3">Backup & Restore</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={handleExport} className="px-4 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 border border-gray-500 transition-colors">
                                Export Data
                            </button>
                            <button onClick={handleImportClick} className="px-4 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 border border-gray-500 transition-colors flex items-center justify-center gap-2">
                                <UploadIcon className="w-5 h-5" /> Import Data
                            </button>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                accept="application/json" 
                                className="hidden" 
                            />
                        </div>
                        {importError && <p className="text-red-400 text-sm mt-2">{importError}</p>}
                    </div>
                    
                    <div className="pt-2">
                         <button onClick={onReset} className="w-full px-4 py-3 bg-red-900 bg-opacity-50 text-red-200 font-semibold rounded-lg hover:bg-red-900 border border-red-800 transition-colors">
                            Disconnect
                         </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;


import React, { useState, useEffect, useRef } from 'react';
import { XIcon, LogOutIcon, QrCodeIcon } from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth, getCurrentConfig } from '../utils/firebase';
import { signOut } from 'firebase/auth';
import QRCode from 'qrcode';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ syncId, onClose }) => {
    const [showQR, setShowQR] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

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

    useEffect(() => {
        if (showQR && canvasRef.current) {
            const config = getCurrentConfig();
            if (config) {
                // We stringify the config to transfer it via QR
                QRCode.toCanvas(canvasRef.current, JSON.stringify(config), { width: 256, margin: 2 }, (error) => {
                    if (error) console.error(error);
                });
            }
        }
    }, [showQR]);

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

                    {!showQR ? (
                        <button 
                            onClick={() => setShowQR(true)}
                            className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <QrCodeIcon className="w-5 h-5"/> Share Config (QR)
                        </button>
                    ) : (
                        <div className="flex flex-col items-center space-y-4 bg-white p-4 rounded-lg">
                            <h3 className="text-black font-bold">Scan with your Phone</h3>
                            <canvas ref={canvasRef} className="w-64 h-64" />
                            <p className="text-xs text-gray-600 text-center">Open this app on your phone and tap "Scan Sync QR"</p>
                            <button 
                                onClick={() => setShowQR(false)}
                                className="text-sm text-blue-600 underline"
                            >
                                Close QR
                            </button>
                        </div>
                    )}
                    
                    <div className="pt-4 border-t border-gray-700">
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

import React, { useEffect, useState, useCallback } from 'react';
import { 
    XIcon, LogOutIcon, CheckIcon, CalendarIcon, GraduationCapIcon, 
    LinkIcon, Loader2Icon, BrainCircuitIcon, Volume2Icon, UserIcon, GlobeIcon, ArrowLeftIcon, PlusCircleIcon
} from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth } from '../utils/firebase';
import { signOut } from 'firebase/auth';

interface SettingsModalProps {
    syncId: string;
    onClose: () => void;
    onReset: () => void;
    data: StoredData;
    onImport: (data: StoredData) => void;
    moodleToken: string | null;
    onSaveMoodleToken: (token: string) => void;
    isGoogleConnected: boolean;
    onConnectGoogle: () => void;
    onDisconnectGoogle: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, moodleToken, onSaveMoodleToken, isGoogleConnected, onConnectGoogle, onDisconnectGoogle }) => {
    const [isConnecting, setIsConnecting] = useState(false);

    const handleMoodleConnect = () => {
        setIsConnecting(true);
        const passport = Math.random().toString(36).substring(7);
        const urlscheme = 'secondbrainapp';
        const launchUrl = `https://online.dyellin.ac.il/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${urlscheme}`;
        window.location.href = launchUrl;
    };

    const handleSignOut = async () => {
        if(window.confirm("Sign out?")) {
            await signOut(auth);
            window.location.reload();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/95 z-[200] flex flex-col p-4 animate-fade-in" style={{ paddingTop: 'var(--sat)' }}>
            <div className="bg-gray-800 w-full max-w-2xl mx-auto my-auto rounded-[3rem] border-4 border-gray-700 flex flex-col max-h-[90vh] overflow-hidden shadow-2xl">
                <header className="p-8 border-b-4 border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <div className="flex items-center gap-4">
                        <BrainCircuitIcon className="w-10 h-10 text-blue-500" />
                        <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Settings</h2>
                    </div>
                    <button onClick={onClose} className="p-4 bg-gray-700 rounded-2xl active:scale-90 transition-transform"><XIcon className="w-8 h-8 text-white"/></button>
                </header>

                <div className="flex-grow overflow-y-auto p-8 space-y-8">
                    <div className="bg-gray-900 p-6 rounded-[2rem] border-2 border-gray-700 flex items-center gap-5">
                        <div className="bg-blue-600 p-4 rounded-2xl"><UserIcon className="w-8 h-8 text-white" /></div>
                        <div>
                            <p className="text-gray-400 font-black text-[10px] uppercase tracking-widest">Connected User</p>
                            <p className="text-xl font-bold text-white truncate max-w-[200px]">{auth.currentUser?.email}</p>
                        </div>
                        <button onClick={handleSignOut} className="ml-auto p-4 bg-red-900/20 text-red-500 rounded-2xl"><LogOutIcon className="w-6 h-6" /></button>
                    </div>

                    <div className="space-y-6">
                        <h3 className="text-blue-400 font-black text-sm uppercase tracking-widest px-2">External Connections</h3>
                        
                        <div className={`p-6 rounded-[2rem] border-2 transition-all ${moodleToken ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-4 mb-4">
                                <GlobeIcon className={`w-8 h-8 ${moodleToken ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-lg font-black text-white uppercase">Moodle (Dyellin)</p>
                                {moodleToken && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-5 leading-relaxed">Connect to import course materials and sync your college schedule automatically.</p>
                            <button 
                                onClick={moodleToken ? () => onSaveMoodleToken('') : handleMoodleConnect}
                                disabled={isConnecting}
                                className={`w-full py-4 rounded-2xl font-black text-base uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${moodleToken ? 'bg-gray-700 text-white' : 'bg-blue-600 text-white'}`}
                            >
                                {isConnecting ? <Loader2Icon className="w-6 h-6 animate-spin" /> : moodleToken ? 'Disconnect' : 'Connect Now'}
                            </button>
                        </div>

                        <div className={`p-6 rounded-[2rem] border-2 transition-all ${isGoogleConnected ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                             <div className="flex items-center gap-4 mb-4">
                                <CalendarIcon className={`w-8 h-8 ${isGoogleConnected ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-lg font-black text-white uppercase">Google Calendar</p>
                                {isGoogleConnected && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-5 leading-relaxed">Sync your Google Calendar to see all your personal and academic events in one place.</p>
                            <button 
                                onClick={isGoogleConnected ? onDisconnectGoogle : onConnectGoogle}
                                className={`w-full py-4 rounded-2xl font-black text-base uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 ${isGoogleConnected ? 'bg-gray-700 text-white' : 'bg-blue-600 text-white'}`}
                            >
                                {isGoogleConnected ? 'Disconnect' : 'Connect Now'}
                            </button>
                        </div>
                    </div>
                </div>
                
                <footer className="p-6 bg-gray-900/50 border-t-4 border-gray-700 text-center">
                    <p className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">Second Brain v2.0 - Secure Sync</p>
                </footer>
            </div>
        </div>
    );
};

export default SettingsModal;
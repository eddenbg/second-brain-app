import React, { useEffect, useState, useCallback } from 'react';
import { 
    XIcon, LogOutIcon, CheckIcon, CalendarIcon, GraduationCapIcon, 
    LinkIcon, Loader2Icon, BrainCircuitIcon, Volume2Icon, UserIcon, GlobeIcon, ArrowLeftIcon, PlusCircleIcon
} from './Icons';
import type { StoredData } from '../hooks/useRecordings';
import { auth } from '../utils/firebase';
import { signOut } from 'firebase/auth';

import { testMoodleConnection } from '../services/moodleService';

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
    const [manualToken, setManualToken] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

    const checkClipboard = useCallback(() => {
        navigator.clipboard.readText().then(text => {
            if (text && text.length === 32 && /^[a-f0-9]{32}$/.test(text)) {
                setManualToken(text);
            }
        }).catch(err => {
            console.warn('Could not read clipboard:', err);
        });
    }, []);

    useEffect(() => {
        if (!moodleToken) {
            checkClipboard(); // on mount
            window.addEventListener('focus', checkClipboard);
            return () => window.removeEventListener('focus', checkClipboard);
        }
    }, [moodleToken, checkClipboard]);

    const handleSaveManualToken = async () => {
        const token = manualToken.trim();
        if (token.length === 32) {
            setIsTesting(true);
            setTestResult(null);
            const isValid = await testMoodleConnection(token);
            setIsTesting(false);
            if (isValid) {
                onSaveMoodleToken(token);
                setManualToken('');
                setTestResult('success');
                setTimeout(() => setTestResult(null), 3000);
            } else {
                setTestResult('error');
                alert("Moodle rejected this key. Please make sure you copied the 'Moodle Mobile additional features service' key from the Security Keys page.");
            }
        } else {
            alert("Please enter a valid 32-character Moodle security key.");
        }
    };

    const handleSignOut = async () => {
        if(window.confirm("Sign out?")) {
            await signOut(auth);
            window.location.reload();
        }
    };

    const openMoodleInNewTab = () => {
        window.open('https://online.dyellin.ac.il/user/preferences.php', '_blank', 'noopener,noreferrer');
    }

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
                            
                            {moodleToken ? (
                                <button 
                                    onClick={() => onSaveMoodleToken('')}
                                    className="w-full py-4 rounded-2xl font-black text-base uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect
                                </button>
                            ) : (
                                <div className="space-y-4 mt-4 bg-gray-900/50 p-4 rounded-xl border border-gray-700 animate-fade-in">
                                    <div className="space-y-3 text-sm text-gray-300 font-medium">
                                        <p className="font-black text-gray-400 text-xs uppercase tracking-widest">איך מתחברים:</p>
                                        <ol dir="rtl" className="list-decimal list-inside space-y-2.5 bg-gray-800 p-4 rounded-lg border border-gray-600 text-xs leading-relaxed text-right">
                                            <li>לחץ/י על השם שלך (בצד שמאל למעלה במודל), ואז לחץ/י על <strong className="text-white">"העדפות"</strong>.</li>
                                            <li>בדף ההעדפות, לחץ/י על הקישור שנקרא <strong className="text-white">"מפתחות אבטחה"</strong>.</li>
                                            <li>גלול/י לתחתית העמוד הבא. תראה/י מפתח שכבר קיים.</li>
                                            <li>העתק/י את המפתח שנמצא תחת השירות שנקרא <strong className="text-white">"Moodle Mobile additional features service"</strong>. הוא עשוי להיות ליד תווית "RSS". <strong>אל תיצור/י מפתח חדש</strong>.</li>
                                            <li>חזור/י לכאן. ננסה להדביק אותו אוטומטית, אבל אפשר גם להדביק אותו ידנית למטה.</li>
                                        </ol>
                                    </div>

                                    <button onClick={openMoodleInNewTab} className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 text-sm uppercase">
                                        <LinkIcon className="w-4 h-4" /> Open Moodle
                                    </button>
                                    
                                    <input
                                        type="text"
                                        value={manualToken}
                                        onChange={(e) => setManualToken(e.target.value)}
                                        placeholder="הדבק/י את המפתח באורך 32 תווים כאן"
                                        className="w-full bg-gray-700 p-3 rounded-lg border border-gray-600 text-white font-mono text-center"
                                        aria-label="Moodle Security Key"
                                    />
                                    <button 
                                        onClick={handleSaveManualToken} 
                                        disabled={isTesting}
                                        className={`w-full py-3 rounded-lg font-bold text-sm uppercase flex items-center justify-center gap-2 ${isTesting ? 'bg-gray-600' : 'bg-green-600'} text-white`}
                                    >
                                        {isTesting ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                                        {isTesting ? 'Testing...' : 'Save Security Key'}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className={`p-6 rounded-[2rem] border-2 transition-all ${isGoogleConnected ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                             <div className="flex items-center gap-4 mb-4">
                                <CalendarIcon className={`w-8 h-8 ${isGoogleConnected ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-lg font-black text-white uppercase">Google Calendar</p>
                                {isGoogleConnected && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-5 leading-relaxed">Sync your Google Calendar to see all your personal and academic events in one place.</p>
                            
                            {!isGoogleConnected && (
                                <div className="mb-4 bg-gray-900/50 p-4 rounded-xl border border-gray-700 text-xs text-gray-300 font-medium space-y-2">
                                    <p className="font-black text-yellow-400 text-xs uppercase tracking-widest">Important Note:</p>
                                    <p>When connecting, Google will show a warning screen because this is a personal app.</p>
                                    <ol className="list-decimal list-inside space-y-1 pl-2">
                                        <li>On the warning screen, click <strong className="text-white">"Advanced"</strong>.</li>
                                        <li>Then click <strong className="text-white">"Go to My Second Brain (unsafe)"</strong> to proceed.</li>
                                    </ol>
                                    <p className="text-gray-500 italic">This is safe. Your data remains private.</p>
                                </div>
                            )}

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
import React, { useEffect, useState, useCallback } from 'react';
import {
    XIcon, LinkIcon, Loader2Icon, BrainCircuitIcon, GlobeIcon, PlusCircleIcon
} from './Icons';
import { Calendar } from 'lucide-react';
import { testMoodleConnection } from '../services/moodleService';
import {
    connectGoogleCalendar,
    disconnectGoogleCalendar,
    getStoredToken,
    saveGoogleClientId,
    getStoredGoogleClientId
} from '../services/googleCalendarService';
import { auth } from '../utils/firebase';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

declare const __BUILD_DATE__: string;

interface SettingsModalProps {
    onClose: () => void;
    moodleToken: string | null;
    onSaveMoodleToken: (token: string) => void;
    onGoogleConnected?: () => void;
}

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    return (
        <button
            onClick={handleCopy}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex-shrink-0"
            style={{ minHeight: 'unset' }}
        >
            {copied ? '✅ Copied!' : label}
        </button>
    );
};

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, moodleToken, onSaveMoodleToken, onGoogleConnected }) => {
    const { isInstallable, installApp } = useInstallPrompt();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;

    const [manualToken, setManualToken] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
    const [isGoogleConnected, setIsGoogleConnected] = useState(!!getStoredToken());
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
    const [googleClientId, setGoogleClientId] = useState(getStoredGoogleClientId());
    const [clientIdInput, setClientIdInput] = useState('');
    const [firebaseUID, setFirebaseUID] = useState<string>('');
    const [refreshToken, setRefreshToken] = useState<string>('');
    const [showMCPSetup, setShowMCPSetup] = useState(false);

    useEffect(() => {
        if (auth?.currentUser) {
            setFirebaseUID(auth.currentUser.uid);
            const rt = (auth.currentUser as any).stsTokenManager?.refreshToken ?? '';
            setRefreshToken(rt);
        }
        const unsubscribe = auth?.onAuthStateChanged?.((user) => {
            if (user) {
                setFirebaseUID(user.uid);
                const rt = (user as any).stsTokenManager?.refreshToken ?? '';
                setRefreshToken(rt);
            }
        });
        return () => unsubscribe?.();
    }, []);

    const checkClipboard = useCallback(() => {
        navigator.clipboard.readText().then(text => {
            if (text && text.length === 32 && /^[a-f0-9]{32}$/.test(text)) {
                setManualToken(text);
            }
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!moodleToken) {
            checkClipboard();
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

    const handleConnectGoogle = async () => {
        setIsConnectingGoogle(true);
        try {
            await connectGoogleCalendar();
            setIsGoogleConnected(true);
            onGoogleConnected?.();
        } catch (e) {
            console.error('Google auth failed', e);
            alert('Could not connect to Google Calendar. Please try again.');
        } finally {
            setIsConnectingGoogle(false);
        }
    };

    const handleDisconnectGoogle = () => {
        disconnectGoogleCalendar();
        setIsGoogleConnected(false);
    };

    const openMoodleInNewTab = () => {
        window.open('https://online.dyellin.ac.il/user/preferences.php', '_blank', 'noopener,noreferrer');
    };

    const mcpConfigSnippet = `{
  "mcpServers": {
    "second-brain": {
      "url": "https://eddenbg-second-brain.netlify.app/.netlify/functions/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}`;

    return (
        <div className="fixed inset-0 bg-black/95 z-[200] flex flex-col p-3 sm:p-4 animate-fade-in"
             style={{ paddingTop: 'max(var(--sat), 12px)' }}>
            <div className="bg-gray-800 w-full max-w-2xl mx-auto my-auto rounded-[2rem] sm:rounded-[3rem] border-4 border-gray-700 flex flex-col max-h-[92vh] overflow-hidden shadow-2xl">
                <header className="p-5 sm:p-8 border-b-4 border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <BrainCircuitIcon className="w-8 h-8 sm:w-10 sm:h-10 text-blue-500" />
                        <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tighter">Settings</h2>
                    </div>
                    <button onClick={onClose} className="p-3 sm:p-4 bg-gray-700 rounded-xl sm:rounded-2xl active:scale-90 transition-transform">
                        <XIcon className="w-6 h-6 sm:w-8 sm:h-8 text-white"/>
                    </button>
                </header>

                <div className="flex-grow overflow-y-auto p-5 sm:p-8 space-y-6 sm:space-y-8">

                    {/* Install / Fullscreen — always visible */}
                    <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 ${isStandalone ? 'bg-green-900/20 border-green-700' : 'bg-blue-900/30 border-blue-600'}`}>
                        <div className="flex items-center gap-3 mb-3">
                            <PlusCircleIcon className={`w-7 h-7 sm:w-8 sm:h-8 ${isStandalone ? 'text-green-400' : 'text-blue-400'}`} />
                            <p className="text-base sm:text-lg font-black text-white uppercase">Install App</p>
                            {isStandalone && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Installed ✓</div>}
                        </div>
                        {isStandalone ? (
                            <>
                                <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                    App is installed. Tap below to go fullscreen (hides the status bar).
                                </p>
                                <button
                                    onClick={() => {
                                        document.documentElement.requestFullscreen?.().catch(() => {});
                                        onClose();
                                    }}
                                    className="w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 bg-green-700 text-white"
                                >
                                    Enter Fullscreen
                                </button>
                                <p className="text-gray-500 font-bold text-[10px] mt-3 leading-relaxed text-center">
                                    Not in the share menu? Remove the app from your home screen, open in Chrome, and tap Install below to get a proper PWA install.
                                </p>
                            </>
                        ) : isInstallable ? (
                            <>
                                <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                    Install for fullscreen, share target (save links from Chrome), and offline use.
                                </p>
                                <button
                                    onClick={installApp}
                                    className="w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 bg-blue-600 text-white"
                                >
                                    <PlusCircleIcon className="w-6 h-6" />
                                    Install App
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-400 font-bold text-xs mb-3 leading-relaxed">
                                    Install for fullscreen, share target (save links from Chrome), and offline use.
                                </p>
                                <div className="bg-gray-800 rounded-xl p-4 border border-gray-600">
                                    <p className="text-yellow-400 font-black text-xs uppercase tracking-widest mb-2">How to install</p>
                                    <p className="text-gray-300 text-xs leading-relaxed">
                                        Tap Chrome's menu <strong className="text-white">⋮</strong> → <strong className="text-white">"Add to Home Screen"</strong> → Install. Then reopen the app from your home screen.
                                    </p>
                                    <p className="text-gray-500 text-[10px] mt-2 leading-relaxed">
                                        Already added but don't see it in the share menu? Remove it and reinstall — the share target only works with a proper PWA install.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="space-y-4 sm:space-y-6">
                        <h3 className="text-blue-400 font-black text-xs uppercase tracking-widest px-2">External Connections</h3>

                        {/* Google Calendar */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${isGoogleConnected ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <Calendar className={`w-7 h-7 sm:w-8 sm:h-8 ${isGoogleConnected ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-base sm:text-lg font-black text-white uppercase">Google Calendar</p>
                                {isGoogleConnected && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">Connect to see your Google Calendar events in the monthly view.</p>

                            {!isGoogleConnected && !googleClientId && (
                                <div className="space-y-3 mb-4 bg-gray-800 p-4 rounded-2xl border border-gray-600">
                                    <p className="text-yellow-400 font-black text-xs uppercase tracking-widest">One-time setup</p>
                                    <ol className="text-gray-400 text-xs space-y-1.5 list-decimal list-inside leading-relaxed">
                                        <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">console.cloud.google.com</a></li>
                                        <li>Create a project &rarr; Enable <strong className="text-white">Google Calendar API</strong></li>
                                        <li>APIs &amp; Services &rarr; Credentials &rarr; Create &rarr; OAuth 2.0 Client ID (Web app)</li>
                                        <li>Copy the Client ID and paste it below</li>
                                    </ol>
                                    <input
                                        type="text"
                                        value={clientIdInput}
                                        onChange={e => setClientIdInput(e.target.value)}
                                        placeholder="123456789.apps.googleusercontent.com"
                                        className="w-full bg-gray-900 p-3 rounded-xl border border-gray-600 text-white font-mono text-xs"
                                        aria-label="Google OAuth Client ID"
                                    />
                                    <button
                                        onClick={() => {
                                            saveGoogleClientId(clientIdInput);
                                            setGoogleClientId(clientIdInput.trim());
                                            setClientIdInput('');
                                        }}
                                        disabled={!clientIdInput.includes('googleusercontent.com')}
                                        className="w-full py-3 rounded-xl font-black text-xs uppercase bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-500 active:scale-95 transition-all"
                                    >
                                        Save Client ID
                                    </button>
                                </div>
                            )}

                            {!isGoogleConnected && googleClientId && (
                                <p className="text-green-400 text-xs font-bold mb-3">Client ID configured. Ready to connect.</p>
                            )}

                            {isGoogleConnected ? (
                                <button
                                    onClick={handleDisconnectGoogle}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect
                                </button>
                            ) : (
                                <button
                                    onClick={googleClientId ? handleConnectGoogle : undefined}
                                    disabled={isConnectingGoogle || !googleClientId}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-500"
                                >
                                    {isConnectingGoogle ? <Loader2Icon className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
                                    {isConnectingGoogle ? 'Connecting…' : 'Connect Google Calendar'}
                                </button>
                            )}
                        </div>

                        {/* Moodle */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${moodleToken ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <GlobeIcon className={`w-7 h-7 sm:w-8 sm:h-8 ${moodleToken ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-base sm:text-lg font-black text-white uppercase">Moodle (Dyellin)</p>
                                {moodleToken && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">Connect to import course materials and sync your college schedule automatically.</p>

                            {moodleToken ? (
                                <button
                                    onClick={() => onSaveMoodleToken('')}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect
                                </button>
                            ) : (
                                <div className="space-y-3 mt-3 bg-gray-900/50 p-4 rounded-xl border border-gray-700 animate-fade-in">
                                    <div className="space-y-3 text-sm text-gray-300 font-medium">
                                        <p className="font-black text-gray-400 text-xs uppercase tracking-widest">איך מתחברים:</p>
                                        <ol dir="rtl" className="list-decimal list-inside space-y-2 bg-gray-800 p-3 rounded-lg border border-gray-600 text-xs leading-relaxed text-right">
                                            <li>לחץ/י על השם שלך (בצד שמאל למעלה במודל), ואז לחץ/י על <strong className="text-white">"העדפות"</strong>.</li>
                                            <li>בדף ההעדפות, לחץ/י על <strong className="text-white">"מפתחות אבטחה"</strong>.</li>
                                            <li>גלול/י לתחתיתה. העתק/י את המפתח תחת <strong className="text-white">"Moodle Mobile additional features service"</strong>.</li>
                                            <li>חזור/י לכאן והדבק/י למטה.</li>
                                        </ol>
                                    </div>
                                    <button onClick={openMoodleInNewTab} className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 text-xs uppercase">
                                        <LinkIcon className="w-4 h-4" /> Open Moodle
                                    </button>
                                    <input
                                        type="text"
                                        value={manualToken}
                                        onChange={(e) => setManualToken(e.target.value)}
                                        placeholder="הדבק/י את המפתח באורך 32 תווים כאן"
                                        className="w-full bg-gray-700 p-3 rounded-lg border border-gray-600 text-white font-mono text-center text-sm"
                                        aria-label="Moodle Security Key"
                                    />
                                    <button
                                        onClick={handleSaveManualToken}
                                        disabled={isTesting}
                                        className={`w-full py-3 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 ${isTesting ? 'bg-gray-600' : 'bg-green-600'} text-white`}
                                    >
                                        {isTesting ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                                        {isTesting ? 'Testing...' : 'Save Security Key'}
                                    </button>
                                    {testResult === 'success' && <p className="text-green-400 text-center font-bold text-sm">Connected!</p>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* MCP / Claude Integration Section */}
                    <div className="space-y-4">
                        <h3 className="text-purple-400 font-black text-xs uppercase tracking-widest px-2">Claude AI Integration (MCP)</h3>

                        <div className="bg-gray-900 border-2 border-purple-800 rounded-[1.5rem] sm:rounded-[2rem] p-5 sm:p-6 space-y-4">
                            <p className="text-gray-300 text-xs font-bold leading-relaxed">
                                Connect your Second Brain to Claude Desktop so you can ask Claude questions about your notes and thoughts directly.
                            </p>

                            <button
                                onClick={() => setShowMCPSetup(!showMCPSetup)}
                                className="w-full py-3 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
                            >
                                {showMCPSetup ? 'Hide Setup' : 'Show MCP Setup'}
                            </button>

                            {showMCPSetup && (
                                <div className="space-y-4 animate-fade-in">
                                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-2">
                                        <p className="text-purple-300 font-black text-xs uppercase tracking-widest">Step 1 — Your Firebase User ID</p>
                                        <p className="text-gray-400 text-xs">Add this as <code className="text-yellow-300">FIREBASE_USER_ID</code> in Netlify env vars.</p>
                                        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-3 border border-gray-600">
                                            <code className="text-yellow-300 text-xs flex-1 truncate font-mono">
                                                {firebaseUID || 'Loading... (open this after signing in)'}
                                            </code>
                                            {firebaseUID && <CopyButton text={firebaseUID} label="Copy" />}
                                        </div>
                                    </div>

                                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-2">
                                        <p className="text-purple-300 font-black text-xs uppercase tracking-widest">Step 2 — Firebase Refresh Token</p>
                                        <p className="text-gray-400 text-xs">Add this as <code className="text-yellow-300">FIREBASE_REFRESH_TOKEN</code> in Netlify env vars. Keep it secret!</p>
                                        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-3 border border-gray-600">
                                            <code className="text-yellow-300 text-xs flex-1 font-mono" style={{ wordBreak: 'break-all' }}>
                                                {refreshToken
                                                    ? `${refreshToken.slice(0, 40)}...`
                                                    : 'Not available (sign in first)'}
                                            </code>
                                            {refreshToken && <CopyButton text={refreshToken} label="Copy" />}
                                        </div>
                                    </div>

                                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-2">
                                        <p className="text-purple-300 font-black text-xs uppercase tracking-widest">Step 3 — Set MCP API Key</p>
                                        <p className="text-gray-400 text-xs">In Netlify → Site Settings → Environment Variables, add <code className="text-yellow-300">MCP_API_KEY</code> with any long random string you choose.</p>
                                    </div>

                                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-2">
                                        <p className="text-purple-300 font-black text-xs uppercase tracking-widest">Step 4 — Claude Desktop Config</p>
                                        <p className="text-gray-400 text-xs">Add this to your <code className="text-yellow-300">claude_desktop_config.json</code> (replace YOUR_MCP_API_KEY):</p>
                                        <div className="relative">
                                            <pre className="bg-gray-900 rounded-lg p-3 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap">
                                                {mcpConfigSnippet}
                                            </pre>
                                            <div className="mt-2">
                                                <CopyButton text={mcpConfigSnippet} label="Copy Config" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-3">
                                        <p className="text-blue-300 text-xs font-bold">
                                            Once connected, you can ask Claude: "What did I record last week?" or "What are my pending tasks?" or "Search my notes about algorithm complexity."
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                <footer className="p-4 sm:p-6 bg-gray-900/50 border-t-4 border-gray-700 text-center">
                    <p className="text-[10px] font-black text-gray-600 uppercase tracking-[0.2em]">
                        My Second Brain v2.2 · deployed {typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '—'}
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default SettingsModal;

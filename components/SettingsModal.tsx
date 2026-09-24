import React, { useEffect, useState, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
    XIcon, LinkIcon, Loader2Icon, BrainCircuitIcon, GlobeIcon
} from './Icons';
import { Calendar } from 'lucide-react';
import { testMoodleConnection, loginWithCredentials } from '../services/moodleService';
import {
    disconnectGoogleCalendar,
    getStoredToken,
} from '../services/googleCalendarService';
import {
    disconnectGoogleDrive,
    getStoredDriveToken
} from '../services/googleDriveService';
import { auth } from '../utils/firebase';
import { refreshGoogleToken, GOOGLE_TOKEN_REFRESHED_EVENT } from '../services/googleAuthService';

declare const __BUILD_DATE__: string;

interface SettingsModalProps {
    onClose: () => void;
    moodleToken: string | null;
    onSaveMoodleToken: (token: string) => void;
    onGoogleConnected?: () => void;
    user?: User | null;
    onSignIn?: () => Promise<void>;
    onSignOut?: () => Promise<void>;
    isDarkMode?: boolean;
    onToggleDarkMode?: () => void;
    isHighContrast?: boolean;
    onToggleHighContrast?: () => void;
    fontSize?: 'normal' | 'large' | 'xlarge';
    onCycleFontSize?: () => void;
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

const DRIVE_LOGO = (
    <svg viewBox="0 0 87.3 78" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.6C.4 50 0 51.55 0 53.1h27.5z" fill="#00AC47"/>
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.9 11.9z" fill="#EA4335"/>
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.4-4.45 1.2z" fill="#00832D"/>
        <path d="M59.85 53.1H27.5L13.75 76.9c1.35.8 2.9 1.1 4.45 1.1h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#2684FC"/>
        <path d="M73.4 26.85l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.2 28.1H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
    </svg>
);

const GOOGLE_LOGO = (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
);

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, moodleToken, onSaveMoodleToken, onGoogleConnected, user, onSignIn, onSignOut, isDarkMode = false, onToggleDarkMode, isHighContrast = false, onToggleHighContrast, fontSize = 'normal', onCycleFontSize }) => {

    const [isSigningIn, setIsSigningIn] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState<string | null>(null);
    const [signInError, setSignInError] = useState<string | null>(null);
    const [moodleUsername, setMoodleUsername] = useState('');
    const [moodlePassword, setMoodlePassword] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [moodleLoginError, setMoodleLoginError] = useState<string | null>(null);
    const [isGoogleConnected, setIsGoogleConnected] = useState(!!getStoredToken());
    const [isDriveConnected, setIsDriveConnected] = useState(!!getStoredDriveToken());
    const [isRefreshing, setIsRefreshing] = useState<'calendar' | 'drive' | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [firebaseUID, setFirebaseUID] = useState<string>('');
    const [refreshToken, setRefreshToken] = useState<string>('');
    const [showMCPSetup, setShowMCPSetup] = useState(false);

    useEffect(() => {
        if (auth?.currentUser) {
            setFirebaseUID(auth.currentUser.uid);
            const rt = (auth.currentUser as any).stsTokenManager?.refreshToken ?? '';
            setRefreshToken(rt);
        }
        const unsubscribe = auth?.onAuthStateChanged?.((u: User | null) => {
            if (u) {
                setFirebaseUID(u.uid);
                const rt = (u as any).stsTokenManager?.refreshToken ?? '';
                setRefreshToken(rt);
            }
        });
        const onRefreshed = () => {
            setIsGoogleConnected(!!getStoredToken());
            setIsDriveConnected(!!getStoredDriveToken());
        };
        window.addEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);
        return () => {
            unsubscribe?.();
            window.removeEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);
        };
    }, []);

    const handleMoodleLogin = async () => {
        const u = moodleUsername.trim();
        const p = moodlePassword; // not trimmed — spaces can be part of a password
        if (!u || !p.trim()) { setMoodleLoginError('Enter your Moodle username and password.'); return; }
        setIsLoggingIn(true);
        setMoodleLoginError(null);
        try {
            const token = await loginWithCredentials(u, p);
            onSaveMoodleToken(token);
            setMoodleUsername('');
            setMoodlePassword('');
        } catch (e: any) {
            setMoodleLoginError(e.message || 'שגיאת חיבור — בדוק שם משתמש וסיסמה / Connection failed — check your username and password');
        } finally {
            setIsLoggingIn(false);
        }
    };

    const handleDisconnectGoogle = () => {
        disconnectGoogleCalendar();
        setIsGoogleConnected(false);
    };

    const handleDisconnectDrive = () => {
        disconnectGoogleDrive();
        setIsDriveConnected(false);
    };

    const handleSignOut = async () => {
        if (!onSignOut || isSigningOut) return;
        setIsSigningOut(true);
        setSignOutError(null);
        try {
            await onSignOut();
        } catch (e: any) {
            setSignOutError(e?.message || 'Sign-out failed. Please try again.');
        } finally {
            setIsSigningOut(false);
        }
    };

    const handleSignIn = async () => {
        if (!onSignIn) return;
        setIsSigningIn(true);
        setSignInError(null);
        try {
            await onSignIn();
            setIsGoogleConnected(!!getStoredToken());
            setIsDriveConnected(!!getStoredDriveToken());
        } catch (e: any) {
            if (e.code === 'auth/unauthorized-domain') {
                setSignInError('Domain not authorized. Go to Firebase Console → Authentication → Settings → Authorized domains and add eddenbg-second-brain.netlify.app');
            } else {
                setSignInError(e.message || 'Sign-in failed. Please try again.');
            }
            console.error('Google sign-in error', e.code, e.message);
        } finally {
            setIsSigningIn(false);
        }
    };

    // Refresh the Google access token for the signed-in account (no sign-out needed)
    const handleRefreshGoogle = async (which: 'calendar' | 'drive') => {
        setIsRefreshing(which);
        setRefreshError(null);
        try {
            await refreshGoogleToken(true);
        } catch (e: any) {
            if (e?.code !== 'auth/popup-closed-by-user') {
                setRefreshError(e?.message || 'Could not refresh the Google connection. Please try again.');
            }
        } finally {
            setIsGoogleConnected(!!getStoredToken());
            setIsDriveConnected(!!getStoredDriveToken());
            setIsRefreshing(null);
        }
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

                    {/* Dark Mode Toggle */}
                    <div className="p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 border-gray-700 bg-gray-900">
                        <div className="flex items-center gap-3 sm:gap-4 justify-between">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-gray-700 to-black rounded-full flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-lg">◐</span>
                                </div>
                                <div>
                                    <p className="text-base sm:text-lg font-black text-white uppercase">Freak Mode</p>
                                    <p className="text-gray-400 font-bold text-xs">{isDarkMode ? 'Dark theme activated' : 'Light theme active'}</p>
                                </div>
                            </div>
                            <button
                                onClick={onToggleDarkMode}
                                className={`relative w-14 h-8 rounded-full transition-all ${isDarkMode ? 'bg-purple-600' : 'bg-gray-600'}`}
                                aria-label="Toggle dark mode"
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${isDarkMode ? 'translate-x-7' : 'translate-x-1'}`}></div>
                            </button>
                        </div>
                    </div>

                    {/* High Contrast Mode */}
                    <div className="p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 border-gray-700 bg-gray-900">
                        <div className="flex items-center gap-3 sm:gap-4 justify-between">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center shrink-0">
                                    <span className="text-black font-black text-lg">◆</span>
                                </div>
                                <div>
                                    <p className="text-base sm:text-lg font-black text-white uppercase">High Contrast</p>
                                    <p className="text-gray-400 font-bold text-xs">{isHighContrast ? 'Maximum contrast enabled' : 'Standard contrast'}</p>
                                </div>
                            </div>
                            <button
                                onClick={onToggleHighContrast}
                                className={`relative w-14 h-8 rounded-full transition-all ${isHighContrast ? 'bg-yellow-500' : 'bg-gray-600'}`}
                                aria-label="Toggle high contrast"
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${isHighContrast ? 'translate-x-7' : 'translate-x-1'}`}></div>
                            </button>
                        </div>
                    </div>

                    {/* Font Size Adjustment */}
                    <div className="p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 border-gray-700 bg-gray-900">
                        <div className="flex items-center gap-3 sm:gap-4 justify-between">
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-xl">A</span>
                                </div>
                                <div>
                                    <p className="text-base sm:text-lg font-black text-white uppercase">Text Size</p>
                                    <p className="text-gray-400 font-bold text-xs">
                                        {fontSize === 'normal' && 'Standard'}
                                        {fontSize === 'large' && 'Large (120%)'}
                                        {fontSize === 'xlarge' && 'Extra Large (150%)'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onCycleFontSize}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all active:scale-95"
                                style={{ minHeight: 'unset' }}
                            >
                                {fontSize === 'normal' && 'A'}
                                {fontSize === 'large' && 'A+'}
                                {fontSize === 'xlarge' && 'A++'}
                            </button>
                        </div>
                    </div>

                    {/* Account & Sync */}
                    <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${user?.isAnonymous === false ? 'bg-blue-900/20 border-blue-600' : 'bg-gray-900 border-gray-700'}`}>
                        <div className="flex items-center gap-3 sm:gap-4 mb-3">
                            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shrink-0">
                                {GOOGLE_LOGO}
                            </div>
                            <p className="text-base sm:text-lg font-black text-white uppercase">Account &amp; Sync</p>
                            {user?.isAnonymous === false && <div className="ml-auto bg-blue-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Syncing ✓</div>}
                        </div>
                        {user?.isAnonymous === false ? (
                            <>
                                <p className="text-white font-black text-sm mb-1">{user.email}</p>
                                <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                    Your data syncs automatically across all signed-in devices.
                                </p>
                                <button
                                    onClick={handleSignOut}
                                    disabled={isSigningOut}
                                    aria-busy={isSigningOut}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white disabled:opacity-50"
                                >
                                    {isSigningOut && <Loader2Icon className="w-5 h-5 animate-spin" />}
                                    {isSigningOut ? 'Signing out…' : 'Sign Out'}
                                </button>
                                {signOutError && <p className="text-red-400 text-xs font-bold mt-2 text-center">{signOutError}</p>}
                            </>
                        ) : (
                            <>
                                <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                    Sign in with Google to sync your notes, recordings, and tasks in real time across all your devices.
                                </p>
                                <button
                                    onClick={handleSignIn}
                                    disabled={isSigningIn}
                                    className="w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 bg-white text-gray-800 disabled:opacity-60"
                                >
                                    {isSigningIn ? <Loader2Icon className="w-5 h-5 animate-spin text-gray-600" /> : GOOGLE_LOGO}
                                    {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
                                </button>
                                {signInError && <p className="text-red-400 text-xs font-bold mt-2 text-center">{signInError}</p>}
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
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">Connects automatically when you sign in with Google. Your calendar events appear in the monthly view.</p>
                            {isGoogleConnected ? (
                                <button
                                    onClick={handleDisconnectGoogle}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect
                                </button>
                            ) : user?.isAnonymous === false ? (
                                <>
                                    <p className="text-yellow-400 font-bold text-xs mb-3">Connection expired. Tap below to refresh it — no need to sign out.</p>
                                    <button
                                        onClick={() => handleRefreshGoogle('calendar')}
                                        disabled={isRefreshing !== null}
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-blue-600 text-white disabled:opacity-60"
                                    >
                                        {isRefreshing === 'calendar' ? <Loader2Icon className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
                                        {isRefreshing === 'calendar' ? 'Refreshing…' : 'Refresh Calendar'}
                                    </button>
                                    {refreshError && <p className="text-red-400 text-xs font-bold mt-2 text-center">{refreshError}</p>}
                                </>
                            ) : (
                                <p className="text-gray-500 font-bold text-xs">Sign in with Google above to connect Calendar automatically.</p>
                            )}
                        </div>

                        {/* Google Drive */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${isDriveConnected ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                {DRIVE_LOGO}
                                <p className="text-base sm:text-lg font-black text-white uppercase">Google Drive</p>
                                {isDriveConnected && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">Connects automatically when you sign in with Google. Browse and import files from Drive into the Files Vault.</p>
                            {isDriveConnected ? (
                                <button
                                    onClick={handleDisconnectDrive}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect Drive
                                </button>
                            ) : user?.isAnonymous === false ? (
                                <>
                                    <p className="text-yellow-400 font-bold text-xs mb-3">Connection expired. Tap below to refresh it — no need to sign out.</p>
                                    <button
                                        onClick={() => handleRefreshGoogle('drive')}
                                        disabled={isRefreshing !== null}
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-blue-600 text-white disabled:opacity-60"
                                    >
                                        {isRefreshing === 'drive' ? <Loader2Icon className="w-5 h-5 animate-spin" /> : null}
                                        {isRefreshing === 'drive' ? 'Refreshing…' : 'Refresh Drive'}
                                    </button>
                                    {refreshError && <p className="text-red-400 text-xs font-bold mt-2 text-center">{refreshError}</p>}
                                </>
                            ) : (
                                <p className="text-gray-500 font-bold text-xs">Sign in with Google above to connect Drive automatically.</p>
                            )}
                        </div>

                        {/* Moodle */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${moodleToken ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <GlobeIcon className={`w-7 h-7 sm:w-8 sm:h-8 ${moodleToken ? 'text-green-400' : 'text-gray-500'}`} />
                                <p className="text-base sm:text-lg font-black text-white uppercase">Moodle (Dyellin)</p>
                                {moodleToken && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Connected</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">Connect to import course materials and sync your college schedule automatically.</p>

                            {moodleToken ? (
                                <>
                                <p className="text-green-400 font-black text-sm mb-3">מחובר / Connected ✓</p>
                                <button
                                    onClick={() => onSaveMoodleToken('')}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect
                                </button>
                                </>
                            ) : (
                                <div className="space-y-3 mt-3">
                                    <label htmlFor="moodle-username" className="block text-white font-black text-xs uppercase tracking-widest">
                                        שם משתמש / Username
                                    </label>
                                    <input
                                        id="moodle-username"
                                        type="text"
                                        value={moodleUsername}
                                        onChange={e => setMoodleUsername(e.target.value)}
                                        placeholder="שם משתמש / Username"
                                        autoComplete="username"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        className="w-full bg-gray-700 p-3 rounded-lg border border-gray-600 text-white text-sm"
                                        aria-describedby="moodle-username-help"
                                    />
                                    <p id="moodle-username-help" className="text-gray-400 text-xs font-bold leading-relaxed" dir="auto">
                                        נסה קודם את מספר הסטודנט / ת.ז., ואם זה לא עובד — את כתובת האימייל.
                                        <br />
                                        Try your student ID number first; if that fails, try your email address.
                                    </p>
                                    <input
                                        type="password"
                                        value={moodlePassword}
                                        onChange={e => setMoodlePassword(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleMoodleLogin()}
                                        placeholder="סיסמה"
                                        autoComplete="current-password"
                                        className="w-full bg-gray-700 p-3 rounded-lg border border-gray-600 text-white text-sm"
                                        aria-label="Moodle password"
                                    />
                                    {moodleLoginError && <p className="text-red-400 text-xs text-center font-bold">{moodleLoginError}</p>}
                                    <button
                                        onClick={handleMoodleLogin}
                                        disabled={isLoggingIn}
                                        className={`w-full py-3 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2 ${isLoggingIn ? 'bg-gray-600' : 'bg-green-600'} text-white`}
                                    >
                                        {isLoggingIn && <Loader2Icon className="w-4 h-4 animate-spin" />}
                                        {isLoggingIn ? 'Connecting...' : 'Connect with Moodle Login'}
                                    </button>
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
                        My Second Brain v2.5 · deployed {typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '—'}
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default SettingsModal;

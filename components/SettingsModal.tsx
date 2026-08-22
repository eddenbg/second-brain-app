import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { User } from 'firebase/auth';
import {
    XIcon, LinkIcon, Loader2Icon, BrainCircuitIcon, GlobeIcon, PlusCircleIcon
} from './Icons';
import { Calendar } from 'lucide-react';
import { testMoodleConnection, loginWithCredentials } from '../services/moodleService';
import {
    disconnectGoogleCalendar,
    getStoredToken,
    GOOGLE_TOKEN_CHANGE_EVENT,
} from '../services/googleCalendarService';
import {
    disconnectGoogleDrive,
    getStoredDriveToken
} from '../services/googleDriveService';
import {
    getStoredNotionToken, saveNotionToken, clearNotionToken, buildNotionAuthUrl,
    getStoredNotionClientId, saveNotionClientId,
    getStoredNotionClientSecret, saveNotionClientSecret,
} from '../services/notionService';
import { auth } from '../utils/firebase';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

declare const __BUILD_DATE__: string;

interface SettingsModalProps {
    onClose: () => void;
    moodleToken: string | null;
    onSaveMoodleToken: (token: string) => void;
    anthropicApiKey?: string | null;
    onSaveAnthropicApiKey?: (key: string | null) => void;
    onNotionTokenChanged?: (token: string | null) => void;
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

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, moodleToken, onSaveMoodleToken, anthropicApiKey, onSaveAnthropicApiKey, onNotionTokenChanged, onGoogleConnected, user, onSignIn, onSignOut, isDarkMode = false, onToggleDarkMode, isHighContrast = false, onToggleHighContrast, fontSize = 'normal', onCycleFontSize }) => {
    const { isInstallable, installApp } = useInstallPrompt();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;

    const [isSigningIn, setIsSigningIn] = useState(false);
    const [lastAuthError, setLastAuthError] = useState<string | null>(
        () => localStorage.getItem('last_auth_error')
    );

    // Sign-in leaves for Google in a Custom Tab, so this component keeps running
    // underneath. If the user backs out instead of completing it, nothing ever
    // resolved the promise and the button sat on "Signing in…" forever. Reset it
    // whenever we come back to the foreground, and surface any error recorded
    // while we were away.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            setIsSigningIn(false);
            setLastAuthError(localStorage.getItem('last_auth_error'));
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);
    const [signInError, setSignInError] = useState<string | null>(null);
    const [moodleUsername, setMoodleUsername] = useState('');
    const [moodlePassword, setMoodlePassword] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [moodleLoginError, setMoodleLoginError] = useState<string | null>(null);
    const [isGoogleConnected, setIsGoogleConnected] = useState(!!getStoredToken());
    const [isDriveConnected, setIsDriveConnected] = useState(!!getStoredDriveToken());
    const [notionToken, setNotionToken] = useState(getStoredNotionToken() || '');
    const [isWaitingForNotion, setIsWaitingForNotion] = useState(false);
    const [notionError, setNotionError] = useState<string | null>(null);
    const [showManualNotion, setShowManualNotion] = useState(false);
    const [notionInput, setNotionInput] = useState('');
    const [showNotionSetup, setShowNotionSetup] = useState(false);
    const [notionClientIdInput, setNotionClientIdInput] = useState(() => getStoredNotionClientId());
    const [notionClientSecretInput, setNotionClientSecretInput] = useState(() => getStoredNotionClientSecret());
    const [notionCredsSaved, setNotionCredsSaved] = useState(0);
    const [anthropicKeyInput, setAnthropicKeyInput] = useState('');
    // Synced via Firestore under the signed-in Google account (see useRecordings'
    // saveAnthropicApiKey) so connecting on one device connects every device on
    // that account. Falls back to this device's localStorage if the prop isn't
    // wired up by a parent (defensive only — App.tsx always passes it).
    const anthropicKeySaved = !!(anthropicApiKey ?? localStorage.getItem('anthropic_api_key'));

    const handleSaveAnthropicKey = () => {
        const trimmed = anthropicKeyInput.trim();
        if (!trimmed) return;
        if (onSaveAnthropicApiKey) onSaveAnthropicApiKey(trimmed);
        else localStorage.setItem('anthropic_api_key', trimmed);
        setAnthropicKeyInput('');
    };

    const handleClearAnthropicKey = () => {
        if (onSaveAnthropicApiKey) onSaveAnthropicApiKey(null);
        else localStorage.removeItem('anthropic_api_key');
    };

    // The Google access token Firebase hands back lasts about an hour and there is
    // no refresh token, so a modal left open drifts into claiming a connection that
    // has already lapsed — and the Notion token can be written by the OAuth
    // callback in another window. Re-read all three from storage periodically and
    // whenever the app returns to the foreground, so the copy below stays true.
    // Also re-read immediately on GOOGLE_TOKEN_CHANGE_EVENT (fired by
    // googleCalendarService on every token write/clear, including the Schedule
    // view's fetch discovering a 401) so a lapsed connection is reflected the
    // moment it's discovered, not up to 30s later.
    useEffect(() => {
        const syncFromStorage = () => {
            setIsGoogleConnected(!!getStoredToken());
            setIsDriveConnected(!!getStoredDriveToken());
            setNotionToken(getStoredNotionToken() || '');
        };
        const interval = window.setInterval(syncFromStorage, 30000);
        document.addEventListener('visibilitychange', syncFromStorage);
        window.addEventListener(GOOGLE_TOKEN_CHANGE_EVENT, syncFromStorage);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', syncFromStorage);
            window.removeEventListener(GOOGLE_TOKEN_CHANGE_EVENT, syncFromStorage);
        };
    }, []);

    // Was Google already connected when this modal opened? Only a connection that
    // happens *while* it is open means a sign-in just completed.
    const wasConnectedOnOpen = React.useRef(!!getStoredToken());

    // Auto-close after a sign-in completes.
    //
    // This used to close whenever a token existed at all. Since isGoogleConnected
    // is seeded from the stored token, that meant every subsequent open of
    // Settings scheduled its own dismissal 300ms later — once signed in, the
    // modal became impossible to keep on screen. Close only on the transition
    // into connected.
    useEffect(() => {
        if (isSigningIn) return;
        if (wasConnectedOnOpen.current) return;
        if (!isGoogleConnected || !getStoredToken()) return;

        const timer = setTimeout(() => onClose(), 300);
        return () => clearTimeout(timer);
    }, [isGoogleConnected, isSigningIn, onClose]);

    const handleMoodleLogin = async () => {
        const u = moodleUsername.trim();
        const p = moodlePassword.trim();
        if (!u || !p) { setMoodleLoginError('Enter your Moodle username and password.'); return; }
        setIsLoggingIn(true);
        setMoodleLoginError(null);
        try {
            const token = await loginWithCredentials(u, p);
            onSaveMoodleToken(token);
            setMoodleUsername('');
            setMoodlePassword('');
        } catch (e: any) {
            setMoodleLoginError(e.message || 'Login failed. Check your username and password.');
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

    const handleSaveNotionToken = () => {
        const t = notionInput.trim();
        if (!t) return;
        saveNotionToken(t);
        setNotionToken(t);
        onNotionTokenChanged?.(t);
        setNotionInput('');
        setShowManualNotion(false);
    };

    const handleSaveNotionCredentials = () => {
        const id = notionClientIdInput.trim();
        const secret = notionClientSecretInput.trim();
        if (!id || !secret) return;
        saveNotionClientId(id);
        saveNotionClientSecret(secret);
        setShowNotionSetup(false);
        // effectiveNotionClientId reads straight from localStorage, so nudge a
        // re-render to swap the setup form for the "Sign in with Notion" button.
        setNotionCredsSaved(n => n + 1);
    };

    const handleClearNotionToken = () => {
        clearNotionToken();
        setNotionToken('');
        onNotionTokenChanged?.(null);
        setNotionInput('');
        setNotionError(null);
    };

    const handleSignIn = async () => {
        if (!onSignIn) return;
        setIsSigningIn(true);
        setSignInError(null);
        try {
            await onSignIn();
            // For redirect-based flows, the modal will auto-close when user returns
            // For popup flows, check if tokens are present immediately
            if (getStoredToken()) {
                setIsGoogleConnected(true);
                setIsDriveConnected(!!getStoredDriveToken());
                // Close modal only if popup flow succeeded (token already stored)
                setTimeout(() => onClose(), 300);
            }
            // If no token yet, stay open - user is in redirect flow
        } catch (e: any) {
            if (e.code === 'auth/unauthorized-domain') {
                setSignInError('Domain not authorized. Go to Firebase Console → Authentication → Settings → Authorized domains and add eddenbg-second-brain.netlify.app');
            } else if (e.code !== 'auth/popup-blocked' && e.code !== 'auth/popup-cancelled') {
                // Don't show error for popup/redirect flows - they're expected
                setSignInError(e.message || 'Sign-in failed. Please try again.');
            }
            console.error('Google sign-in error', e.code, e.message);
        } finally {
            setIsSigningIn(false);
        }
    };

    // Signing in with Google also grants the Calendar/Drive access token, but that
    // token expires about an hour later while the account itself stays signed in
    // (Firebase gives us no refresh token). Collapsing both facts into one value
    // per service keeps the sections below from claiming the account is signed out
    // when all that lapsed is the Calendar or Drive permission.
    type GoogleServiceState = 'connected' | 'needs-refresh' | 'signed-out';
    const isSignedIn = user?.isAnonymous === false;
    const calendarState: GoogleServiceState =
        isGoogleConnected ? 'connected' : isSignedIn ? 'needs-refresh' : 'signed-out';
    const driveState: GoogleServiceState =
        isDriveConnected ? 'connected' : isSignedIn ? 'needs-refresh' : 'signed-out';

    // Recomputed when credentials are saved (notionCredsSaved), since the stored
    // value lives in localStorage and would not otherwise trigger a re-render.
    const effectiveNotionClientId = useMemo(
        () => getStoredNotionClientId() || process.env.NOTION_CLIENT_ID || '',
        [notionCredsSaved]
    );

    // Torn down when the popup finishes, gives up, or this modal unmounts.
    const notionWatchCleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => notionWatchCleanup.current?.(), []);

    const finishNotionSignIn = useCallback((token: string) => {
        saveNotionToken(token);
        setNotionToken(token);
        onNotionTokenChanged?.(token);
        setIsWaitingForNotion(false);
        setNotionError(null);
    }, [onNotionTokenChanged]);

    const watchNotionPopup = (popup: Window) => {
        notionWatchCleanup.current?.();

        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'NOTION_TOKEN') return;
            const token = event.data.token as string;
            if (token) {
                cleanup();
                finishNotionSignIn(token);
            }
        };

        // The callback stores the token before it tries to post it back, and in
        // some browsers — an installed app above all — the window it opened has no
        // handle on this one, so that message never arrives and the sign-in looks
        // like it did nothing. Reading storage covers those cases; watching for a
        // closed window covers a sign-in the user abandoned.
        const poll = window.setInterval(() => {
            const stored = getStoredNotionToken();
            if (stored) {
                cleanup();
                finishNotionSignIn(stored);
                return;
            }
            if (popup.closed) {
                cleanup();
                setIsWaitingForNotion(false);
                setNotionError('The Notion window closed before it finished. Tap "Sign in with Notion" to try again, or use "Connect with API token instead" below.');
            }
        }, 500);

        const timeout = window.setTimeout(() => {
            cleanup();
            setIsWaitingForNotion(false);
            setNotionError(`Notion did not send anything back. Check that your integration's redirect URI is exactly ${window.location.origin}/ and try again.`);
        }, 3 * 60 * 1000);

        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            window.clearInterval(poll);
            window.clearTimeout(timeout);
            notionWatchCleanup.current = null;
        };

        window.addEventListener('message', onMessage);
        notionWatchCleanup.current = cleanup;
    };

    const handleSignInWithNotion = () => {
        if (!effectiveNotionClientId) {
            setNotionError('No Notion client ID is saved on this device. Use "Set up Notion sign-in" to add your client ID and secret first.');
            return;
        }
        setNotionError(null);

        const url = buildNotionAuthUrl(effectiveNotionClientId);

        // In an installed app, a popup lands in a separate browser window with no
        // opener to hand the token back to, so the tap appears to do nothing.
        // Navigate this window instead: Notion returns to ?code=…&state=notion_oauth
        // and App.tsx completes the exchange right here.
        if (isStandalone) {
            window.location.assign(url);
            return;
        }

        let popup: Window | null = null;
        try {
            popup = window.open(url, 'notion-oauth', 'width=520,height=700,scrollbars=yes,resizable=yes');
        } catch {
            popup = null;
        }

        // A blocked popup is either null or a window that is already closed.
        if (!popup || popup.closed) {
            window.location.assign(url);
            return;
        }

        setIsWaitingForNotion(true);
        watchNotionPopup(popup);
    };

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
                                    onClick={() => onSignOut?.()}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Sign Out
                                </button>
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

                                {/* Whatever went wrong on the way back from Google.
                                    Recorded during startup, so it survives the redirect. */}
                                {lastAuthError && (
                                    <div className="mt-4 bg-red-900/30 border-2 border-red-700 rounded-2xl p-4 flex flex-col gap-3">
                                        <p className="text-red-300 font-black text-xs uppercase tracking-widest">
                                            Last sign-in attempt failed
                                        </p>
                                        <p className="text-red-200 text-xs font-bold leading-relaxed break-words">
                                            {lastAuthError}
                                        </p>
                                        {/* An installed PWA shares its storage with the
                                            browser for this same origin, so completing
                                            sign-in in a normal tab carries the session
                                            back here. Useful when the in-app handoff to
                                            Google keeps failing. */}
                                        {isStandalone && (
                                            <a
                                                href={window.location.origin}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="w-full py-3 bg-white text-gray-800 rounded-xl font-black text-xs uppercase text-center block"
                                            >
                                                Sign in using the browser instead
                                            </a>
                                        )}
                                        {isStandalone && (
                                            <p className="text-red-200/70 text-[11px] font-bold leading-relaxed">
                                                Opens this app in a normal browser tab. Sign in with Google there,
                                                then come back here and reopen the app — you should be signed in.
                                            </p>
                                        )}
                                        <button
                                            onClick={() => {
                                                localStorage.removeItem('last_auth_error');
                                                setLastAuthError(null);
                                            }}
                                            className="w-full py-2 bg-white/10 text-white rounded-xl font-black text-xs uppercase"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Install / Fullscreen */}
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
                                <div className="bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-3">
                                    <p className="text-yellow-400 font-black text-xs uppercase tracking-widest">Install button not showing?</p>
                                    <p className="text-gray-300 text-xs leading-relaxed">
                                        Chrome hides the install button once you've added this site to your home screen. To reset:
                                    </p>
                                    <ol className="text-gray-300 text-xs space-y-1.5 list-decimal list-inside leading-relaxed">
                                        <li>Long-press "Second Brain" on your home screen → <strong className="text-white">Remove</strong></li>
                                        <li>In Chrome tap <strong className="text-white">⋮</strong> → Settings → Site settings → find this site → <strong className="text-white">Clear &amp; reset</strong></li>
                                        <li>Reload this page — the blue Install button will appear here</li>
                                    </ol>
                                    <p className="text-gray-500 text-[10px] leading-relaxed">
                                        Only a proper install (not "Add to Home Screen") registers the app in Android's share menu.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Android App (APK) */}
                    <div className="p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 bg-green-900/20 border-green-700">
                        <div className="flex items-center gap-3 sm:gap-4 mb-3">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shrink-0">
                                <span className="text-white font-black text-lg">📱</span>
                            </div>
                            <p className="text-base sm:text-lg font-black text-white uppercase">Android App (APK)</p>
                            <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Available</div>
                        </div>
                        <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                            Native Android app. Needed only for features Android won't allow on the web, like importing call recordings.
                            <br /><br />
                            <strong className="text-white">This does not update itself.</strong> Each new version means downloading and
                            installing the APK again. The web app you added to your home screen updates on its own — so for everyday use
                            and for testing new features, stay on that.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            {/* releases/latest/download always resolves to the newest
                                release asset, so this URL survives future builds.
                                The repo is public, so no GitHub sign-in is needed. */}
                            <a
                                href="https://github.com/eddenbg/second-brain-app/releases/latest/download/app-debug.apk"
                                download="SecondBrain.apk"
                                rel="noopener"
                                className="flex-1 py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 bg-green-600 text-white hover:bg-green-500"
                            >
                                📥 Download & Install APK
                            </a>
                        </div>
                        <div className="mt-4 bg-gray-800 rounded-xl p-4 border border-gray-600 space-y-3">
                            <p className="text-yellow-400 font-black text-xs uppercase tracking-widest">Installation Steps</p>
                            <ol className="text-gray-300 text-xs space-y-2 list-decimal list-inside leading-relaxed">
                                <li>Tap <strong className="text-white">Download APK</strong> above</li>
                                <li>Open file manager and find <strong className="text-white">SecondBrain.apk</strong></li>
                                <li>Tap to open and select <strong className="text-white">Install</strong></li>
                                <li>If prompted, enable <strong className="text-white">"Install from unknown sources"</strong> in Settings</li>
                                <li>App will install to your home screen</li>
                            </ol>
                        </div>
                    </div>

                    <div className="space-y-4 sm:space-y-6">
                        <h3 className="text-blue-400 font-black text-xs uppercase tracking-widest px-2">External Connections</h3>

                        {/* Google Calendar */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${calendarState === 'connected' ? 'bg-green-900/20 border-green-700' : calendarState === 'needs-refresh' ? 'bg-yellow-900/20 border-yellow-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <Calendar className={`w-7 h-7 sm:w-8 sm:h-8 ${calendarState === 'connected' ? 'text-green-400' : calendarState === 'needs-refresh' ? 'text-yellow-400' : 'text-gray-500'}`} />
                                <p className="text-base sm:text-lg font-black text-white uppercase">Google Calendar</p>
                                {calendarState === 'connected' && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Connected</div>}
                                {calendarState === 'needs-refresh' && <div className="ml-auto bg-yellow-600 text-black px-3 py-1 rounded-full text-[9px] font-black uppercase">Needs refresh</div>}
                            </div>
                            {calendarState === 'connected' ? (
                                <>
                                    <p className="text-gray-300 font-bold text-xs mb-4 leading-relaxed">
                                        Connected. Your calendar events appear in the monthly view.
                                    </p>
                                    <button
                                        onClick={handleDisconnectGoogle}
                                        aria-label="Disconnect Google Calendar. Your Google account stays signed in."
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                    >
                                        Disconnect Calendar
                                    </button>
                                </>
                            ) : calendarState === 'needs-refresh' ? (
                                <>
                                    <p className="text-gray-300 font-bold text-xs mb-4 leading-relaxed">
                                        You are still signed in{user?.email ? ` as ${user.email}` : ''}. Only the Calendar permission has run out — it lasts about an hour. Refreshing it does not sign you out.
                                    </p>
                                    <button
                                        onClick={handleSignIn}
                                        disabled={isSigningIn}
                                        aria-label="Refresh Google Calendar access. You stay signed in."
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-blue-600 text-white disabled:opacity-60"
                                    >
                                        {isSigningIn ? <Loader2Icon className="w-5 h-5 animate-spin" /> : <Calendar className="w-5 h-5" />}
                                        {isSigningIn ? 'Refreshing Calendar access…' : 'Refresh Calendar access'}
                                    </button>
                                </>
                            ) : (
                                <p className="text-gray-400 font-bold text-xs leading-relaxed">
                                    Not connected, because you are not signed in. Use "Sign in with Google" in the Account and Sync section near the top of this page — Calendar connects at the same time.
                                </p>
                            )}
                        </div>

                        {/* Google Drive */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${driveState === 'connected' ? 'bg-green-900/20 border-green-700' : driveState === 'needs-refresh' ? 'bg-yellow-900/20 border-yellow-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                {DRIVE_LOGO}
                                <p className="text-base sm:text-lg font-black text-white uppercase">Google Drive</p>
                                {driveState === 'connected' && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Connected</div>}
                                {driveState === 'needs-refresh' && <div className="ml-auto bg-yellow-600 text-black px-3 py-1 rounded-full text-[9px] font-black uppercase">Needs refresh</div>}
                            </div>
                            {driveState === 'connected' ? (
                                <>
                                    <p className="text-gray-300 font-bold text-xs mb-4 leading-relaxed">
                                        Connected. You can browse and import files from Drive into the Files Vault.
                                    </p>
                                    <button
                                        onClick={handleDisconnectDrive}
                                        aria-label="Disconnect Google Drive. Your Google account stays signed in."
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                    >
                                        Disconnect Drive
                                    </button>
                                </>
                            ) : driveState === 'needs-refresh' ? (
                                <>
                                    <p className="text-gray-300 font-bold text-xs mb-4 leading-relaxed">
                                        You are still signed in{user?.email ? ` as ${user.email}` : ''}. Only the Drive permission has run out — it lasts about an hour. Refreshing it does not sign you out.
                                    </p>
                                    <button
                                        onClick={handleSignIn}
                                        disabled={isSigningIn}
                                        aria-label="Refresh Google Drive access. You stay signed in."
                                        className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-blue-600 text-white disabled:opacity-60"
                                    >
                                        {isSigningIn ? <Loader2Icon className="w-5 h-5 animate-spin" /> : null}
                                        {isSigningIn ? 'Refreshing Drive access…' : 'Refresh Drive access'}
                                    </button>
                                </>
                            ) : (
                                <p className="text-gray-400 font-bold text-xs leading-relaxed">
                                    Not connected, because you are not signed in. Use "Sign in with Google" in the Account and Sync section near the top of this page — Drive connects at the same time.
                                </p>
                            )}
                        </div>

                        {/* Notion */}
                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${notionToken ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-gray-700'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center shrink-0">
                                    <span className="text-white font-black text-base">N</span>
                                </div>
                                <p className="text-base sm:text-lg font-black text-white uppercase">Notion</p>
                                {notionToken && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                Connect your Notion workspace to import pages directly into Web Clips.
                            </p>
                            {notionToken ? (
                                <button
                                    onClick={handleClearNotionToken}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect Notion
                                </button>
                            ) : effectiveNotionClientId ? (
                                <>
                                    <button
                                        onClick={handleSignInWithNotion}
                                        disabled={isWaitingForNotion}
                                        aria-label="Sign in with Notion to connect your workspace"
                                        className="w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-black text-white border-2 border-white/20 disabled:opacity-60"
                                    >
                                        {isWaitingForNotion ? (
                                            <Loader2Icon className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <div className="w-5 h-5 bg-white rounded flex items-center justify-center shrink-0">
                                                <span className="text-black font-black text-sm leading-none">N</span>
                                            </div>
                                        )}
                                        {isWaitingForNotion ? 'Waiting for Notion…' : 'Sign in with Notion'}
                                    </button>
                                    {isWaitingForNotion && (
                                        <p className="text-gray-300 font-bold text-xs mt-3 leading-relaxed" role="status">
                                            A Notion window has opened. Finish signing in there, then come back here — this page updates on its own.
                                        </p>
                                    )}
                                    {notionError && (
                                        <p className="text-red-300 font-bold text-xs mt-3 leading-relaxed" role="alert">
                                            {notionError}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Set up the OAuth app here rather than only through
                                        build-time env vars. The callback already forwards
                                        these to the Netlify function, which prefers them
                                        over its own env — so filling these in enables
                                        "Sign in with Notion" without a redeploy. */}
                                    {!showNotionSetup ? (
                                        <button
                                            onClick={() => setShowNotionSetup(true)}
                                            className="w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 flex items-center justify-center gap-3 bg-black text-white border-2 border-white/20 mb-3"
                                        >
                                            <div className="w-5 h-5 bg-white rounded flex items-center justify-center shrink-0">
                                                <span className="text-black font-black text-sm leading-none">N</span>
                                            </div>
                                            Set up Notion sign-in
                                        </button>
                                    ) : (
                                        <div className="bg-gray-800 rounded-2xl p-4 mb-3 flex flex-col gap-3 border border-gray-600">
                                            <p className="text-gray-300 text-[11px] font-bold leading-relaxed">
                                                From your Notion integration at notion.so/profile/integrations.
                                                Set its redirect URI to <span className="text-white font-mono break-all">{window.location.origin}/</span>
                                            </p>
                                            <input
                                                type="text"
                                                value={notionClientIdInput}
                                                onChange={e => setNotionClientIdInput(e.target.value)}
                                                placeholder="OAuth client ID"
                                                aria-label="Notion OAuth client ID"
                                                className="w-full bg-gray-700 rounded-xl text-xs text-white font-mono placeholder:text-gray-500"
                                                style={{ border: '1px solid #4B5563', padding: '10px 12px' }}
                                            />
                                            <input
                                                type="password"
                                                value={notionClientSecretInput}
                                                onChange={e => setNotionClientSecretInput(e.target.value)}
                                                placeholder="OAuth client secret"
                                                aria-label="Notion OAuth client secret"
                                                className="w-full bg-gray-700 rounded-xl text-xs text-white font-mono placeholder:text-gray-500"
                                                style={{ border: '1px solid #4B5563', padding: '10px 12px' }}
                                            />
                                            <button
                                                onClick={handleSaveNotionCredentials}
                                                disabled={!notionClientIdInput.trim() || !notionClientSecretInput.trim()}
                                                className="w-full py-3 bg-purple-600 text-white rounded-xl font-black text-xs uppercase disabled:opacity-40 active:scale-95"
                                                style={{ minHeight: 'unset' }}
                                            >
                                                Save and enable Notion sign-in
                                            </button>
                                            <p className="text-gray-500 text-[10px] font-bold leading-relaxed">
                                                Stored on this device only.
                                            </p>
                                        </div>
                                    )}

                                    {!showManualNotion ? (
                                        <button
                                            onClick={() => setShowManualNotion(true)}
                                            className="w-full py-3 rounded-2xl font-black text-xs uppercase text-gray-400 border-2 border-gray-700 active:scale-95"
                                        >
                                            Connect with API token instead
                                        </button>
                                    ) : (
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={notionInput}
                                                onChange={e => setNotionInput(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleSaveNotionToken()}
                                                placeholder="Paste Notion token (secret_...)"
                                                className="flex-grow bg-gray-700 rounded-xl text-xs text-white font-mono placeholder:text-gray-500"
                                                style={{ border: '1px solid #4B5563', padding: '10px 12px' }}
                                                aria-label="Notion integration token"
                                                autoFocus
                                            />
                                            <button
                                                onClick={handleSaveNotionToken}
                                                disabled={!notionInput.trim()}
                                                className="px-5 py-3 bg-purple-600 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-40 active:scale-95 whitespace-nowrap"
                                                style={{ minHeight: 'unset' }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    )}
                                </>
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
                                <div className="space-y-3 mt-3">
                                    <input
                                        type="text"
                                        value={moodleUsername}
                                        onChange={e => setMoodleUsername(e.target.value)}
                                        placeholder="שם משתמש במודל"
                                        autoComplete="username"
                                        className="w-full bg-gray-700 p-3 rounded-lg border border-gray-600 text-white text-sm"
                                        aria-label="Moodle username"
                                    />
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


                    {/* Claude AI Research Section */}
                    <div className="space-y-4">
                        <h3 className="text-purple-400 font-black text-xs uppercase tracking-widest px-2">Claude AI Research</h3>

                        <div className={`p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border-2 transition-all ${anthropicKeySaved ? 'bg-green-900/20 border-green-700' : 'bg-gray-900 border-purple-800'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 mb-3">
                                <div className="w-8 h-8 bg-purple-700 rounded-xl flex items-center justify-center shrink-0">
                                    <BrainCircuitIcon className="w-5 h-5 text-white" />
                                </div>
                                <p className="text-base sm:text-lg font-black text-white uppercase">Claude</p>
                                {anthropicKeySaved && <div className="ml-auto bg-green-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Active</div>}
                            </div>
                            <p className="text-gray-400 font-bold text-xs mb-4 leading-relaxed">
                                Powers "Research with Claude" in Browse by Topic. Claude doesn't offer a one-tap sign-in like Google — connecting takes a free API key instead.
                            </p>

                            {anthropicKeySaved ? (
                                <button
                                    onClick={handleClearAnthropicKey}
                                    className="w-full py-3 rounded-2xl font-black text-sm uppercase shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3 bg-gray-700 text-white"
                                >
                                    Disconnect Claude
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <input
                                        type="password"
                                        value={anthropicKeyInput}
                                        onChange={e => setAnthropicKeyInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSaveAnthropicKey()}
                                        placeholder="Paste your Claude API key"
                                        autoComplete="off"
                                        aria-label="Anthropic API key"
                                        className="w-full bg-gray-700 rounded-xl text-xs text-white font-mono placeholder:text-gray-500"
                                        style={{ border: '1px solid #4B5563', padding: '10px 12px' }}
                                    />
                                    <button
                                        onClick={handleSaveAnthropicKey}
                                        disabled={!anthropicKeyInput.trim()}
                                        className="w-full py-3 bg-purple-700 hover:bg-purple-600 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
                                    >
                                        Connect Claude
                                    </button>
                                    <p className="text-gray-500 text-[10px] font-bold leading-relaxed">
                                        Get a free key at console.anthropic.com (Settings → API Keys). Stored on this device only.
                                    </p>
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

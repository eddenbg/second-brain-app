import { onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { saveGoogleToken, getStoredToken } from './googleCalendarService';
import { saveDriveToken, getStoredDriveToken } from './googleDriveService';
import { GOOGLE_AUTH_EXPIRED_EVENT, GOOGLE_TOKEN_REFRESHED_EVENT, notifyGoogleAuthExpired } from './googleAuthEvents';

// Google OAuth access tokens (Calendar/Drive) live ~1 hour and Firebase can't
// refresh them silently. These helpers detect expiry and re-run the Google
// popup for the already signed-in account, so the user never has to sign out
// and back in.

export { GOOGLE_AUTH_EXPIRED_EVENT, GOOGLE_TOKEN_REFRESHED_EVENT, notifyGoogleAuthExpired };

export const hasValidGoogleToken = (): boolean => !!getStoredToken() || !!getStoredDriveToken();

const isGoogleUser = (user: User | null | undefined): user is User =>
    !!user && !user.isAnonymous && user.providerData.some(p => p.providerId === 'google.com');

const isStandalonePwa = (): boolean =>
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
     (window.navigator as any).standalone === true);

const buildProvider = (email?: string | null): GoogleAuthProvider => {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    // Pre-select the signed-in account so the popup is a single tap (or none)
    if (email) provider.setCustomParameters({ login_hint: email });
    return provider;
};

let inflight: Promise<boolean> | null = null;

/**
 * Get a fresh Google access token for the current account.
 * `interactive` = triggered by a user tap; allows the redirect fallback when
 * popups are blocked (installed PWA). Automatic attempts never redirect.
 * Resolves true when a new token was stored.
 */
export const refreshGoogleToken = (interactive = false): Promise<boolean> => {
    if (inflight) return inflight;
    inflight = (async () => {
        const user = auth?.currentUser;
        if (!auth || !isGoogleUser(user)) return false;
        const provider = buildProvider(user.email);

        if (interactive && isStandalonePwa()) {
            // Popups are unreliable in standalone mode — the redirect result is
            // picked up on reload by useRecordings.
            await signInWithRedirect(auth, provider);
            return false;
        }

        try {
            const result = await signInWithPopup(auth, provider);
            const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
            if (!token) return false;
            saveGoogleToken(token);
            saveDriveToken(token);
            window.dispatchEvent(new Event(GOOGLE_TOKEN_REFRESHED_EVENT));
            return true;
        } catch (e: any) {
            if (interactive && (e?.code === 'auth/popup-blocked' || e?.code === 'auth/cancelled-popup-request')) {
                await signInWithRedirect(auth, provider);
                return false;
            }
            throw e;
        }
    })().finally(() => { inflight = null; });
    return inflight;
};

/**
 * Watch the signed-in Google account's API token. Calls `onChange(expired)`
 * on auth state changes, when the tab becomes visible, every minute, and
 * whenever an API call reports a 401.
 */
export const watchGoogleTokenExpiry = (onChange: (expired: boolean) => void): (() => void) => {
    if (!auth || (auth as any).type === 'mock') return () => {};

    let currentUser: User | null = auth.currentUser;
    const check = () => onChange(isGoogleUser(currentUser) && !hasValidGoogleToken());

    const unsubscribe = onAuthStateChanged(auth, (u) => {
        currentUser = u;
        check();
    });
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onExpired = () => { if (isGoogleUser(currentUser)) onChange(true); };
    const onRefreshed = () => onChange(false);
    const interval = setInterval(check, 60_000);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(GOOGLE_AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);

    return () => {
        unsubscribe();
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener(GOOGLE_AUTH_EXPIRED_EVENT, onExpired);
        window.removeEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);
    };
};

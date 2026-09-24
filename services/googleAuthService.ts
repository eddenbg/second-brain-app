import { onAuthStateChanged, signInWithRedirect, GoogleAuthProvider, User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { getStoredToken } from './googleCalendarService';
import { getStoredDriveToken } from './googleDriveService';
import { GOOGLE_AUTH_EXPIRED_EVENT, GOOGLE_TOKEN_REFRESHED_EVENT, notifyGoogleAuthExpired } from './googleAuthEvents';

// Google OAuth access tokens (Calendar/Drive) live ~1 hour and Firebase can't
// refresh them silently. These helpers detect expiry and re-run the Google
// sign-in (as a full-page redirect — popups are blocked in installed PWAs) for
// the already signed-in account, so the user never has to sign out and back in.

export { GOOGLE_AUTH_EXPIRED_EVENT, GOOGLE_TOKEN_REFRESHED_EVENT, notifyGoogleAuthExpired };

export const hasValidGoogleToken = (): boolean => !!getStoredToken() || !!getStoredDriveToken();

const isGoogleUser = (user: User | null | undefined): user is User =>
    !!user && !user.isAnonymous && user.providerData.some(p => p.providerId === 'google.com');

const buildProvider = (email?: string | null): GoogleAuthProvider => {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    // Pre-select the signed-in account so Google's page is a single tap (or none)
    if (email) provider.setCustomParameters({ login_hint: email });
    return provider;
};

let inflight: Promise<boolean> | null = null;

/**
 * Reconnect Google for the current account via a full-page redirect.
 * `interactive` = triggered by a user tap. Automatic (non-interactive) calls
 * do nothing — navigating away without a tap would interrupt the user — so
 * the "Google connection expired" banner's Reconnect button handles it.
 * The page leaves for Google; the new token is stored by getRedirectResult
 * (useRecordings) when the app loads again, which also dismisses the banner.
 * Resolves false (no token is available synchronously with a redirect).
 */
export const refreshGoogleToken = (interactive = false): Promise<boolean> => {
    if (inflight) return inflight;
    inflight = (async () => {
        const user = auth?.currentUser;
        if (!interactive || !auth || !isGoogleUser(user)) return false;
        await signInWithRedirect(auth, buildProvider(user.email));
        return false;
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

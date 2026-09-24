// Events shared between the Google API wrappers and the token-refresh logic.
// Kept in their own module so the API wrappers don't import the auth code.

export const GOOGLE_AUTH_EXPIRED_EVENT = 'second-brain:google-auth-expired';
export const GOOGLE_TOKEN_REFRESHED_EVENT = 'second-brain:google-token-refreshed';

/** Called by Google API wrappers when a request comes back 401. */
export const notifyGoogleAuthExpired = (): void => {
    try {
        window.dispatchEvent(new Event(GOOGLE_AUTH_EXPIRED_EVENT));
    } catch {
        // non-browser environment
    }
};



import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, CACHE_SIZE_UNLIMITED, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * AUTOMATIC SYNC SETUP:
 * Your Firebase configuration is now hardcoded below.
 */
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyBh7OGWLhzLIxQfawEs3oCHMPWwGu1khoo",
  authDomain: "my-second-brain-app-10dfe.firebaseapp.com",
  projectId: "my-second-brain-app-10dfe",
  storageBucket: "my-second-brain-app-10dfe.firebasestorage.app",
  messagingSenderId: "845654285559",
  appId: "1:845654285559:web:163b8d9bd10da97f7a47f2"
};

const LOCAL_STORAGE_CONFIG_KEY = 'second_brain_firebase_config';

const getEnv = (key: string) => {
  try {
    // @ts-ignore
    return (import.meta.env && import.meta.env[key]) || (typeof process !== 'undefined' ? process.env?.[key] : undefined) || '';
  } catch (e) {
    return '';
  }
};

const getStoredConfig = () => {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        return null;
    }
};

export const saveFirebaseConfig = (config: any) => {
    localStorage.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify(config));
    window.location.reload();
};

export const clearFirebaseConfig = () => {
    localStorage.removeItem(LOCAL_STORAGE_CONFIG_KEY);
    window.location.reload();
};

/**
 * authDomain stays on the Firebase-hosted handler.
 *
 * It was briefly switched to the app's own hostname to dodge cross-origin
 * storage partitioning on signInWithRedirect. That made Firebase send Google a
 * redirect_uri of https://<our-host>/__/auth/handler, which is not registered on
 * the OAuth client — Google rejected every attempt with Error 400
 * redirect_uri_mismatch. Only the firebaseapp.com handler is registered, so
 * pointing anywhere else needs a Google Cloud Console change first.
 *
 * The partitioning theory was also the wrong diagnosis: the real cause was the
 * service worker answering /__/auth/ navigations (including Firebase's hidden
 * iframe) with a cached index.html. That is fixed in public/sw.js, and the guard
 * there matches on pathname, so it covers this cross-origin handler too.
 */
const firebaseConfig = (DEFAULT_CONFIG.apiKey)
    ? DEFAULT_CONFIG
    : (getEnv('VITE_FIREBASE_API_KEY') ? {
        apiKey: getEnv('VITE_FIREBASE_API_KEY'),
        authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
        projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
        storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
        messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
        appId: getEnv('VITE_FIREBASE_APP_ID')
      } : (getStoredConfig() || {}));

let app;
let authExport;
let dbExport;
let isMock = false;

try {
    if (!firebaseConfig.apiKey) {
        throw new Error("Missing Config");
    }
    app = initializeApp(firebaseConfig);
    authExport = getAuth(app);
    
    setPersistence(authExport, browserLocalPersistence).catch((error) => {
        console.warn("Firebase persistence could not be set:", error);
    });

    dbExport = initializeFirestore(app, {
        cacheSizeBytes: CACHE_SIZE_UNLIMITED
    });

    if (typeof window !== 'undefined') {
        enableMultiTabIndexedDbPersistence(dbExport).catch((err) => {
            console.warn('Persistence failed:', err.code);
        });
    }

} catch (e) {
    isMock = true;
    authExport = { type: 'mock', onAuthStateChanged: (cb: any) => cb(null) } as any;
    dbExport = { type: 'mock' } as any;
}

export const auth = authExport;
export const db = dbExport;
// Recordings are far too large for Firestore's 1MB document limit, so the audio
// itself lives in Storage and the document only keeps a URL.
export const storage = (() => {
    try { return app ? getStorage(app) : null; } catch { return null; }
})();
export const isConfigured = !isMock;
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/calendar.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

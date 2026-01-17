

import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, CACHE_SIZE_UNLIMITED, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

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
export const isConfigured = !isMock;
export const googleProvider = new GoogleAuthProvider();

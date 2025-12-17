
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableMultiTabIndexedDbPersistence, initializeFirestore, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';

const LOCAL_STORAGE_CONFIG_KEY = 'second_brain_firebase_config';

// Helper to safely get env vars (handles Vite import.meta.env and legacy process.env)
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
    window.location.reload(); // Reload to initialize with new config
};

export const clearFirebaseConfig = () => {
    localStorage.removeItem(LOCAL_STORAGE_CONFIG_KEY);
    window.location.reload();
};

const envConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID')
};

// Determine which config to use: Env Vars > Local Storage > Missing
const storedConfig = getStoredConfig();
const firebaseConfig = envConfig.apiKey ? envConfig : (storedConfig || {});

// Safety check: Don't crash if config is missing (e.g. in Preview)
let app;
let authExport;
let dbExport;
let isMock = false;

// Simple Mock Auth System for Demo/Offline Mode
class MockAuth {
    type = 'mock';
    currentUser: any = null;
    listeners: Set<any> = new Set();

    onAuthStateChanged(cb: any) {
        this.listeners.add(cb);
        cb(this.currentUser);
        return () => this.listeners.delete(cb);
    }

    async signInWithEmailAndPassword(auth: any, email: string, password: string) {
        if (email === 'demo@example.com' || email === 'offline@device.local') {
            this.currentUser = { 
                uid: 'offline-user', 
                email: email, 
                displayName: 'Offline User',
                isAnonymous: true 
            };
            this.notify();
            return { user: this.currentUser };
        }
        throw new Error("For Offline Mode, please use the green button.");
    }

    async createUserWithEmailAndPassword() {
        throw new Error("Cloud Sign Up is disabled in Offline Mode. Please configure Firebase.");
    }

    async signOut() {
        this.currentUser = null;
        this.notify();
    }

    notify() {
        this.listeners.forEach(cb => cb(this.currentUser));
    }
}

try {
    if (!firebaseConfig.apiKey) {
        console.warn("Firebase Config missing. App is running in Demo/Offline mode.");
        throw new Error("Missing Config");
    }
    app = initializeApp(firebaseConfig);
    authExport = getAuth(app);
    dbExport = initializeFirestore(app, {
        cacheSizeBytes: CACHE_SIZE_UNLIMITED
    });

    // Enable offline persistence if in browser
    if (typeof window !== 'undefined') {
        enableMultiTabIndexedDbPersistence(dbExport).catch((err) => {
            if (err.code == 'failed-precondition') {
                console.warn('Persistence failed: Multiple tabs open.');
            } else if (err.code == 'unimplemented') {
                console.warn('Persistence not supported by browser.');
            }
        });
    }

} catch (e) {
    // Mock objects for Preview environment so app renders UI without crashing
    console.log("Initializing Mock Firebase for Preview/Offline");
    isMock = true;
    authExport = new MockAuth() as any;
    dbExport = { type: 'mock' } as any;
}

export const auth = authExport;
export const db = dbExport;
export const isConfigured = !isMock;

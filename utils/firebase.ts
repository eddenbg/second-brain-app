import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, Firestore, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

let firebaseApp: FirebaseApp;
let auth: Auth;
let db: Firestore;
let initialized = false;

export const provider = new GoogleAuthProvider();

export const getFirebase = async () => {
    if (initialized) {
        return { firebaseApp, auth, db };
    }

    const firebaseConfig = {
        apiKey: process.env.VITE_FIREBASE_API_KEY,
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.VITE_FIREBASE_APP_ID,
    };

    if (!firebaseConfig.apiKey) {
        console.error('Firebase config is missing API key.');
        throw new Error('Could not initialize Firebase. API Key is missing from environment variables.');
    }
    
    try {
        firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);

        // This enables offline data persistence and sync across tabs.
        await enableMultiTabIndexedDbPersistence(db);

        initialized = true;
        return { firebaseApp, auth, db };
    } catch (error) {
        console.error("Firebase initialization error:", error);
        throw error;
    }
};
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

    try {
        // FIX: The application was previously trying to read configuration with a 'VITE_' prefix,
        // which is specific to the Vite build tool. This has been changed to use standard
        // environment variable names to match the deployment environment's conventions.
        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID,
        };

        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            throw new Error('Firebase configuration is missing. Please set the FIREBASE_* environment variables.');
        }
    
        firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);

        // This enables offline data persistence and sync across tabs.
        await enableMultiTabIndexedDbPersistence(db);

        initialized = true;
        return { firebaseApp, auth, db };
    } catch (error) {
        console.error("Firebase initialization error:", error);
        // Re-throw to be caught by the caller in App.tsx
        throw error;
    }
};
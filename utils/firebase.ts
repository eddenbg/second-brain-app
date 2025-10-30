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
        // Use a standard root-relative path to fetch the config from the Netlify function.
        const response = await fetch('/netlify/functions/getFirebaseConfig');

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to fetch or parse Firebase config.' }));
            throw new Error(errorData.error || 'Failed to fetch Firebase config.');
        }
        const firebaseConfig = await response.json();


        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            throw new Error('Firebase configuration is missing. Please set the FIREBASE_* environment variables in your deployment environment.');
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
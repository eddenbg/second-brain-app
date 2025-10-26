import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, Firestore, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

let firebaseApp: FirebaseApp;
let auth: Auth;
let db: Firestore;
let initialized = false;

export const provider = new GoogleAuthProvider();

async function fetchFirebaseConfig() {
    try {
        const response = await fetch('/.netlify/functions/getFirebaseConfig');
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to fetch Firebase config' }));
            throw new Error(errorData.error || `Failed to fetch Firebase config, server returned status ${response.status}.`);
        }
        const config = await response.json();
        if (config.error) {
            throw new Error(config.error);
        }
        return config;
    } catch (error) {
        console.error('Error fetching Firebase config:', error);
        throw new Error(`Could not fetch Firebase configuration. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}


export const getFirebase = async () => {
    if (initialized) {
        return { firebaseApp, auth, db };
    }

    try {
        const firebaseConfig = await fetchFirebaseConfig();

        if (!firebaseConfig.apiKey) {
            throw new Error('API Key is missing from fetched Firebase configuration.');
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

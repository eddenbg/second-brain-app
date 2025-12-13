
import React, { useState, useEffect } from 'react';
import { auth } from '../utils/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2Icon, UserIcon, CheckIcon, ExternalLinkIcon, CopyIcon, SaveIcon, GlobeIcon } from './Icons';

interface SyncSetupProps {
    onSyncIdSet: (id: string) => void;
}

const SyncSetup: React.FC<SyncSetupProps> = () => {
    // @ts-ignore
    const isMock = auth?.type === 'mock';
    
    const [view, setView] = useState<'intro' | 'login' | 'setup' | 'cloudrun'>('intro');
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isMock) {
                setError("Cloud Sync is not configured. Please click 'How to Setup' below.");
                setLoading(false);
                return;
            }

            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err: any) {
            let msg = "Authentication failed.";
            if (err.code === 'auth/invalid-credential') msg = "Incorrect email or password.";
            if (err.code === 'auth/email-already-in-use') msg = "Email already in use.";
            if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleOfflineLogin = async () => {
        setError('');
        setLoading(true);
        try {
            // @ts-ignore
            if (auth.type === 'mock') {
                // @ts-ignore
                await auth.signInWithEmailAndPassword(auth, 'offline@device.local', 'offline');
            } else {
                 setError("Firebase is configured. Please sign in to Cloud Sync.");
            }
        } catch (err: any) {
             setError(err.message || "Offline login failed");
        } finally {
            setLoading(false);
        }
    };

    const renderCloudRunGuide = () => (
        <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-lg border border-gray-700 text-left space-y-6 animate-fade-in-up overflow-y-auto max-h-[80vh]">
            <header className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2">Hosting on Google Cloud Run</h2>
                    <p className="text-gray-400">How to deploy this app to the cloud.</p>
                </div>
                <button onClick={() => setView('intro')} className="text-gray-400 hover:text-white">Close</button>
            </header>

            <div className="bg-blue-900 bg-opacity-20 border border-blue-700 p-4 rounded-lg">
                <h3 className="font-bold text-blue-300 mb-2">How it works</h3>
                <p className="text-sm text-gray-300">
                    <strong>Cloud Run</strong> hosts the website (the frontend).<br/>
                    <strong>Firebase</strong> stores the data and handles logins (the backend).<br/>
                    You need <em>both</em> for the app to work on multiple devices.
                </p>
            </div>

            <div className="space-y-6">
                <div>
                    <h3 className="text-lg font-semibold text-white mb-2">1. Configure Firebase</h3>
                    <p className="text-gray-400 text-sm mb-2">Follow the "Setup Firebase" guide (button on main menu) to get your API keys. Create a file named <code className="bg-black px-1 rounded text-green-400">.env</code> in your project folder and paste the keys there:</p>
                    <div className="bg-black p-3 rounded text-xs font-mono text-gray-400 overflow-x-auto">
                        VITE_FIREBASE_API_KEY=your_key<br/>
                        VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com<br/>
                        ... (and so on)
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-white mb-2">2. Deploy with gcloud</h3>
                    <p className="text-gray-400 text-sm mb-2">Open your terminal (or Cloud Shell) and run:</p>
                    <div className="bg-black p-3 rounded text-xs font-mono text-green-400 select-all">
                        gcloud run deploy second-brain --source .
                    </div>
                    <p className="text-gray-400 text-sm mt-2">When asked, choose a region (e.g., us-central1) and allow unauthenticated invocations (so you can access the website).</p>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-white mb-2">3. Add Environment Variables</h3>
                    <p className="text-gray-400 text-sm">
                        Cloud Run needs your Firebase keys to build the app correctly. 
                        The easiest way is to ensure your <code className="bg-black px-1 rounded text-green-400">.env</code> file is included when you deploy. 
                        Alternatively, you can set them in the Google Cloud Console under the "Variables" tab for your Cloud Run service.
                    </p>
                </div>
            </div>
             <button onClick={() => setView('intro')} className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-semibold">Back to Menu</button>
        </div>
    );

    const renderSetupGuide = () => (
        <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-lg border border-gray-700 text-left space-y-6 animate-fade-in-up overflow-y-auto max-h-[80vh]">
            <header className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2">Setup Firebase (Database)</h2>
                    <p className="text-gray-400">Required for syncing data across devices.</p>
                </div>
                <button onClick={() => setView('intro')} className="text-gray-400 hover:text-white">Close</button>
            </header>

            <div className="space-y-4">
                <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-900 text-blue-200 rounded-full flex items-center justify-center font-bold">1</div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Create Firebase Project</h3>
                        <p className="text-gray-300 text-sm mt-1">Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline inline-flex items-center gap-1">Firebase Console <ExternalLinkIcon className="w-3 h-3"/></a> and create a new project.</p>
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-900 text-blue-200 rounded-full flex items-center justify-center font-bold">2</div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Enable Services</h3>
                        <ul className="text-gray-300 text-sm mt-1 list-disc list-inside space-y-1">
                            <li><strong>Authentication:</strong> Enable "Email/Password".</li>
                            <li><strong>Firestore Database:</strong> Create database (Production mode).</li>
                        </ul>
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-900 text-blue-200 rounded-full flex items-center justify-center font-bold">3</div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Get Config</h3>
                        <p className="text-gray-300 text-sm mt-1">Go to Project Settings → General → "Your apps" → Add Web App (`&lt;/&gt;`). Copy the config keys.</p>
                    </div>
                </div>

                 <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-900 text-blue-200 rounded-full flex items-center justify-center font-bold">4</div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Set Environment Variables</h3>
                        <p className="text-gray-300 text-sm mt-1">Create a <code>.env</code> file in your project folder:</p>
                        <div className="bg-black p-3 rounded mt-2 text-xs font-mono text-green-400 overflow-x-auto">
                            VITE_FIREBASE_API_KEY=...<br/>
                            VITE_FIREBASE_AUTH_DOMAIN=...<br/>
                            VITE_FIREBASE_PROJECT_ID=...<br/>
                            VITE_FIREBASE_STORAGE_BUCKET=...<br/>
                            VITE_FIREBASE_MESSAGING_SENDER_ID=...<br/>
                            VITE_FIREBASE_APP_ID=...
                        </div>
                    </div>
                </div>
            </div>
             <button onClick={() => setView('intro')} className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-semibold">Back to Menu</button>
        </div>
    );

    const renderLoginForm = () => (
         <div className="w-full max-w-sm animate-fade-in-up">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">{isLogin ? "Sign In to Cloud" : "Create Cloud Account"}</h2>
             <form onSubmit={handleAuth} className="space-y-4">
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    className="w-full bg-gray-800 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                />
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full bg-gray-800 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                />
                
                {error && (
                    <div className="text-red-400 bg-red-900 bg-opacity-20 p-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:bg-blue-800"
                >
                    {loading ? <Loader2Icon className="animate-spin w-6 h-6"/> : (isLogin ? "Sign In" : "Create Account")}
                </button>
            </form>
             <div className="mt-6 text-center">
                <button 
                    onClick={() => setIsLogin(!isLogin)} 
                    className="text-blue-400 hover:text-blue-300 underline text-sm"
                >
                    {isLogin ? "Need an account? Sign Up" : "Have an account? Sign In"}
                </button>
            </div>
            <button onClick={() => setView('intro')} className="w-full mt-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
         </div>
    );

    const renderIntro = () => (
        <div className="w-full max-w-sm space-y-6 animate-fade-in-up">
            <button
                onClick={handleOfflineLogin}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-green-700 text-white font-bold rounded-xl shadow-lg hover:bg-green-600 transition-all transform hover:scale-105 border border-green-500"
            >
                <UserIcon className="w-6 h-6" />
                <div className="text-left">
                    <div className="text-lg">Offline Mode</div>
                    <div className="text-xs font-normal opacity-90 text-green-100">Single Device Only</div>
                </div>
            </button>

             <div className="flex items-center justify-between gap-4">
                <div className="h-px bg-gray-700 flex-grow"></div>
                <span className="text-gray-500 text-sm uppercase tracking-widest">Cloud Sync</span>
                <div className="h-px bg-gray-700 flex-grow"></div>
            </div>

            {isMock ? (
                <div className="bg-gray-800 p-4 rounded-lg border border-yellow-700/50 space-y-3">
                     <p className="text-gray-300 text-sm text-center">Cloud Sync requires setup.</p>
                     
                     <button 
                        onClick={() => setView('setup')}
                        className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg flex items-center justify-center gap-2"
                     >
                         <ExternalLinkIcon className="w-4 h-4"/> Setup Firebase (DB)
                     </button>

                     <button 
                        onClick={() => setView('cloudrun')}
                        className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg flex items-center justify-center gap-2"
                     >
                         <GlobeIcon className="w-4 h-4"/> Cloud Run Guide
                     </button>
                </div>
            ) : (
                <button
                    onClick={() => setView('login')}
                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-700 text-white font-bold rounded-xl shadow-lg hover:bg-blue-600 transition-all border border-blue-500"
                >
                    <GlobeIcon className="w-6 h-6" />
                    <div className="text-left">
                        <div className="text-lg">Sign In / Sign Up</div>
                        <div className="text-xs font-normal opacity-90 text-blue-100">Sync across devices</div>
                    </div>
                </button>
            )}
        </div>
    );

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center overflow-y-auto">
             <div className="mb-8">
                <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">My Second Brain</h1>
             </div>
            
            {view === 'intro' && renderIntro()}
            {view === 'login' && renderLoginForm()}
            {view === 'setup' && renderSetupGuide()}
            {view === 'cloudrun' && renderCloudRunGuide()}
            
            {error && view === 'intro' && (
                 <div className="mt-4 text-red-400 bg-red-900 bg-opacity-20 p-3 rounded-lg text-sm max-w-sm">
                    {error}
                </div>
            )}
        </div>
    );
};

export default SyncSetup;

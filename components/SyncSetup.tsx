
import React, { useState } from 'react';
import { auth, isConfigured } from '../utils/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2Icon, UserIcon, SettingsIcon } from './Icons';
import FirebaseConfigModal from './FirebaseConfigModal';

interface SyncSetupProps {
    onSyncIdSet: (id: string) => void;
}

const SyncSetup: React.FC<SyncSetupProps> = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showConfig, setShowConfig] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // @ts-ignore
            if (auth.type === 'mock') {
                if (isLogin) {
                     // @ts-ignore
                    await auth.signInWithEmailAndPassword(auth, email, password);
                } else {
                     // @ts-ignore
                    await auth.createUserWithEmailAndPassword(auth, email, password);
                }
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
            if (err.message && err.message.includes("Offline Mode")) {
                msg = err.message;
            }
            if (!isConfigured && !err.message.includes("Offline Mode")) {
                 msg = "Cloud is not configured. Please click 'Configure Cloud Database' below.";
            }
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
                // Force mock auth behavior even if firebase is initialized, but usually offline mode implies 
                // we want to use local storage. In this app, Offline Mode is tied to Mock Auth.
                setError("To use Offline Mode, please clear the Cloud Configuration in settings.");
            }
        } catch (err: any) {
             setError(err.message || "Offline login failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center overflow-y-auto">
            {showConfig && <FirebaseConfigModal onClose={() => setShowConfig(false)} />}
            
            <h1 className="text-4xl font-bold mb-4">My Second Brain</h1>
            
            {!isConfigured && (
                 <div className="w-full max-w-sm space-y-4 mb-8">
                     <button
                        onClick={handleOfflineLogin}
                        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-green-700 text-white font-bold rounded-xl shadow-lg hover:bg-green-600 transition-all transform hover:scale-105 border border-green-500"
                    >
                        <UserIcon className="w-6 h-6" />
                        <div>
                            <div className="text-lg">Enter Offline Mode</div>
                            <div className="text-xs font-normal opacity-90 text-green-100">No account needed • Saves to device</div>
                        </div>
                    </button>
                </div>
            )}

            <div className="w-full max-w-sm flex items-center justify-between gap-4 mb-8">
                <div className="h-px bg-gray-700 flex-grow"></div>
                <span className="text-gray-500 text-sm uppercase tracking-widest">{isConfigured ? 'Cloud Sync Ready' : 'Or Setup Cloud'}</span>
                <div className="h-px bg-gray-700 flex-grow"></div>
            </div>

            {isConfigured ? (
                 <>
                    <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">
                        {isLogin ? "Sign in to sync your memories." : "Create an account to backup data."}
                    </p>
                    <form onSubmit={handleAuth} className="w-full max-w-sm space-y-4">
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
                    <div className="mt-6 flex flex-col gap-4">
                        <button 
                            onClick={() => setIsLogin(!isLogin)} 
                            className="text-blue-400 hover:text-blue-300 underline text-sm"
                        >
                            {isLogin ? "Need an account? Sign Up" : "Have an account? Sign In"}
                        </button>
                         <button 
                            onClick={() => setShowConfig(true)} 
                            className="text-gray-500 hover:text-gray-300 text-xs flex items-center justify-center gap-1"
                        >
                            <SettingsIcon className="w-3 h-3"/> Re-configure Database
                        </button

import React, { useState } from 'react';
import { auth, isConfigured, saveFirebaseConfig } from '../utils/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2Icon, SettingsIcon, CheckIcon, BrainCircuitIcon } from './Icons';
import FirebaseConfigModal from './FirebaseConfigModal';

interface SyncSetupProps {
    onSyncIdSet: (id: string) => void;
}

const SyncSetup: React.FC<SyncSetupProps> = () => {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showConfig, setShowConfig] = useState(false);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        
        if (!isConfigured) {
            setError("Database not connected. Please click 'Connect Database' first.");
            return;
        }

        setLoading(true);

        try {
            // @ts-ignore
            if (auth.type === 'mock') {
                if (mode === 'signin') {
                     // @ts-ignore
                    await auth.signInWithEmailAndPassword(auth, email, password);
                } else {
                     // @ts-ignore
                    await auth.createUserWithEmailAndPassword(auth, email, password);
                }
                return;
            }

            if (mode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err: any) {
            let msg = "Authentication failed.";
            if (err.code === 'auth/invalid-credential') msg = "Incorrect email or password.";
            if (err.code === 'auth/email-already-in-use') msg = "Email already in use. Please sign in.";
            if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";
            if (err.code === 'auth/operation-not-allowed') msg = "Email/Password sign-in is not enabled in Firebase Console.";
            
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center overflow-y-auto">
            {showConfig && <FirebaseConfigModal onClose={() => setShowConfig(false)} />}
            
            <div className="mb-8">
                <BrainCircuitIcon className="w-20 h-20 text-blue-500 mx-auto mb-4" />
                <h1 className="text-4xl font-bold mb-2">My Second Brain</h1>
                <p className="text-gray-400 text-sm">Your Personal AI Memory Assistant</p>
            </div>
            
            <div className="w-full max-w-sm bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
                {!isConfigured ? (
                    <div className="p-8 space-y-6">
                        <div className="text-yellow-400 bg-yellow-900 bg-opacity-20 p-4 rounded-lg border border-yellow-700 text-sm text-left">
                            <strong>Setup Required:</strong> The app is not connected to your database yet.
                        </div>
                        <p className="text-gray-400 text-sm">
                            Please paste your Firebase Configuration to start syncing your thoughts and to-dos.
                        </p>
                        <button 
                            onClick={() => setShowConfig(true)}
                            className="w-full py-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg transition-all"
                        >
                            <SettingsIcon className="w-5 h-5" /> Connect Database
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Tabs */}
                        <div className="flex border-b border-gray-700">
                            <button 
                                onClick={() => setMode('signin')}
                                className={`flex-1 py-4 font-semibold text-sm transition-colors ${mode === 'signin' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
                            >
                                Sign In
                            </button>
                            <button 
                                onClick={() => setMode('signup')}
                                className={`flex-1 py-4 font-semibold text-sm transition-colors ${mode === 'signup' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
                            >
                                Create Account
                            </button>
                        </div>

                        <div className="p-6">
                            <form onSubmit={handleAuth} className="space-y-4">
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Email"
                                    required
                                    className="w-full bg-gray-900 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                                />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Password"
                                    required
                                    className="w-full bg-gray-900 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                                />
                                
                                {error && (
                                    <div className="text-red-400 bg-red-900 bg-opacity-20 p-3 rounded-lg text-sm text-left">
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:bg-blue-800"
                                >
                                    {loading ? <Loader2Icon className="animate-spin w-6 h-6"/> : (mode === 'signin' ? "Sign In" : "Create Account")}
                                </button>
                            </form>
                        </div>
                        
                        <div className="bg-gray-900 p-3 border-t border-gray-700 flex flex-col gap-2">
                             <div className="text-green-400 text-xs flex items-center justify-center gap-1">
                                <CheckIcon className="w-3 h-3"/> Database Connected
                            </div>
                            <button 
                                onClick={() => setShowConfig(true)} 
                                className="text-gray-500 hover:text-gray-300 text-xs flex items-center justify-center gap-1 w-full"
                            >
                                <SettingsIcon className="w-3 h-3"/> Config Settings
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SyncSetup;

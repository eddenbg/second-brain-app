import React, { useState } from 'react';
import { auth } from '../utils/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2Icon } from './Icons';

interface SyncSetupProps {
    onSyncIdSet: (id: string) => void;
}

const SyncSetup: React.FC<SyncSetupProps> = () => {
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

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center">
            <h1 className="text-4xl font-bold mb-4">My Second Brain</h1>
            <p className="text-lg text-gray-400 mb-8 max-w-lg">
                {isLogin ? "Sign in to access your memories." : "Create an account to start syncing across devices."}
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

            <div className="mt-6">
                <button 
                    onClick={() => setIsLogin(!isLogin)} 
                    className="text-blue-400 hover:text-blue-300 underline text-sm"
                >
                    {isLogin ? "Need an account? Sign Up" : "Already have an account? Sign In"}
                </button>
            </div>
        </div>
    );
};

export default SyncSetup;
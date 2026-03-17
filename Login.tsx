import React, { useState, useCallback } from 'react';
import { auth, isConfigured } from '../utils/firebase';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
} from 'firebase/auth';
import { Loader2Icon, BrainCircuitIcon, MicIcon } from './Icons';
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

    const playTone = useCallback((type: 'success' | 'error') => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            if (type === 'success') {
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.2);
            } else {
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.3);
            }
            
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) { console.error(e); }
    }, []);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!isConfigured) {
            setError("Database not connected.");
            return;
        }
        setLoading(true);
        try {
            if (mode === 'signin') {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
            playTone('success');
        } catch (err: any) {
            setError("Invalid email or password.");
            playTone('error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 overflow-y-auto bg-[#0b0f1a] text-white scroll-smooth">
            <div className="min-h-full flex flex-col items-center px-6 py-12">
                {showConfig && <FirebaseConfigModal onClose={() => setShowConfig(false)} />}
                
                <div className="mb-12 text-center flex-shrink-0">
                    <div className="relative inline-block mb-4">
                        <div className="bg-blue-600 p-6 rounded-[2rem] shadow-[0_0_40px_rgba(37,99,235,0.4)]">
                            <BrainCircuitIcon className="w-16 h-16 text-white" />
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-white rounded-2xl p-2 border-4 border-[#0b0f1a] shadow-xl">
                            <MicIcon className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                    <h1 className="text-4xl font-black mb-1 tracking-tighter uppercase">My Second Brain</h1>
                    <p className="text-blue-400 text-xl font-black uppercase tracking-widest opacity-80">Memory Assistant</p>
                </div>
                
                <div className="w-full max-w-md space-y-8">
                    <div className="bg-[#111827] rounded-[3rem] border-4 border-gray-800 p-10 space-y-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-blue-600"></div>
                        
                        <h2 className="text-3xl font-black text-center uppercase tracking-tighter">
                            {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
                        </h2>
                        
                        <form onSubmit={handleAuth} className="space-y-5 text-left">
                            <div>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Email Address"
                                    className="w-full bg-[#0b0f1a] text-white text-xl p-5 rounded-2xl border-4 border-gray-800 focus:border-blue-600 outline-none transition-all shadow-inner"
                                    aria-label="Email Address"
                                />
                            </div>
                            <div>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Password"
                                    className="w-full bg-[#0b0f1a] text-white text-xl p-5 rounded-2xl border-4 border-gray-800 focus:border-blue-600 outline-none transition-all shadow-inner"
                                    aria-label="Password"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-6 bg-blue-600 text-white font-black text-2xl rounded-2xl border-b-8 border-blue-800 active:border-b-0 active:translate-y-2 transition-all shadow-xl uppercase tracking-tighter"
                            >
                                {loading ? <Loader2Icon className="w-10 h-10 animate-spin mx-auto"/> : (mode === 'signin' ? 'Sign In' : 'Sign Up')}
                            </button>
                        </form>
                        
                        <button 
                            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} 
                            className="text-gray-500 font-black text-lg underline uppercase tracking-widest w-full hover:text-white transition-colors py-2"
                        >
                            {mode === 'signin' ? "Need an account? Sign Up" : 'Have an account? Log In'}
                        </button>
                    </div>
                    
                    {error && (
                        <div className="bg-red-900/30 border-4 border-red-600 p-6 rounded-[2rem] text-red-200 font-black text-lg text-center animate-shake flex flex-col items-center gap-4 shadow-xl">
                            <div className="flex flex-col items-center gap-2">
                                <span className="text-3xl">⚠️</span>
                                <p>{error}</p>
                            </div>
                        </div>
                    )}

                    <p className="text-gray-500 font-bold text-sm px-10 text-center leading-relaxed pb-20 uppercase tracking-tighter">
                        Protected by Firebase Cloud Sync. Your data is encrypted and private.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SyncSetup;

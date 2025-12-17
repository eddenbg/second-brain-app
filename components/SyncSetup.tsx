
import React, { useState, useRef, useEffect } from 'react';
import { auth, isConfigured, saveFirebaseConfig } from '../utils/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2Icon, UserIcon, SettingsIcon, QrCodeIcon, XIcon, CheckIcon, BrainCircuitIcon } from './Icons';
import FirebaseConfigModal from './FirebaseConfigModal';
import jsQR from 'jsqr';

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
    
    // Scanner State
    const [isScanning, setIsScanning] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const stopScanner = () => {
        setIsScanning(false);
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
    };

    const startScanner = async () => {
        setIsScanning(true);
        setError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            streamRef.current = stream;
            
            // Wait for video to be ready
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
                requestAnimationFrame(tick);
            }
        } catch (err) {
            console.error(err);
            setError("Could not access camera for scanning.");
            setIsScanning(false);
        }
    };

    const tick = () => {
        if (!streamRef.current || !videoRef.current || !canvasRef.current) return;
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
            canvas.height = video.videoHeight;
            canvas.width = video.videoWidth;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                try {
                    const config = JSON.parse(code.data);
                    if (config.apiKey && config.projectId) {
                        stopScanner();
                        saveFirebaseConfig(config);
                        return;
                    }
                } catch (e) {
                    // Not valid JSON or config, keep scanning
                }
            }
        }
        if (streamRef.current) requestAnimationFrame(tick);
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        
        if (!isConfigured) {
            setError("Database not connected. Please Scan QR Code or Configure manually.");
            return;
        }

        setLoading(true);

        try {
            // @ts-ignore
            if (auth.type === 'mock') {
                 // This should generally not be reached if !isConfigured check works,
                 // but kept as safety for preview environments.
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

    // Scanner UI Overlay
    if (isScanning) {
        return (
            <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center">
                <h2 className="text-white text-xl font-bold mb-4">Scan QR from Laptop</h2>
                <div className="relative w-full max-w-sm aspect-square bg-gray-900 border-2 border-blue-500 rounded-lg overflow-hidden">
                    <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute inset-0 border-2 border-transparent pointer-events-none flex items-center justify-center">
                        <div className="w-64 h-64 border-2 border-blue-400 opacity-50 rounded-lg"></div>
                    </div>
                </div>
                <button 
                    onClick={stopScanner}
                    className="mt-8 px-6 py-3 bg-red-600 text-white font-bold rounded-full flex items-center gap-2"
                >
                    <XIcon className="w-6 h-6" /> Cancel Scan
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center overflow-y-auto">
            {showConfig && <FirebaseConfigModal onClose={() => setShowConfig(false)} />}
            
            <h1 className="text-4xl font-bold mb-2">My Second Brain</h1>
            <p className="text-gray-400 mb-8 text-sm">Your Personal AI Memory Assistant</p>
            
            <div className="w-full max-w-sm bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
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
                
                <div className="bg-gray-900 p-4 border-t border-gray-700 flex flex-col gap-3">
                    {!isConfigured ? (
                        <>
                             <div className="text-left text-xs text-gray-400 mb-2 border-l-2 border-blue-500 pl-3">
                                <strong>One-time Setup:</strong> Use the QR code to connect this app to your private database on your laptop.
                            </div>
                            <button 
                                onClick={startScanner}
                                className="w-full py-3 bg-gray-700 text-white font-semibold rounded hover:bg-gray-600 flex items-center justify-center gap-2 border border-gray-600"
                            >
                                <QrCodeIcon className="w-5 h-5" /> Connect via QR Code
                            </button>
                        </>
                    ) : (
                        <div className="text-green-400 text-sm flex items-center justify-center gap-2 p-2 bg-green-900 bg-opacity-20 rounded border border-green-900">
                            <CheckIcon className="w-4 h-4"/> Database Connected
                        </div>
                    )}

                    <button 
                        onClick={() => setShowConfig(true)} 
                        className="text-gray-500 hover:text-gray-300 text-xs flex items-center justify-center gap-1 w-full mt-1"
                    >
                        <SettingsIcon className="w-3 h-3"/> {isConfigured ? "Database Settings" : "Manual Configuration"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SyncSetup;

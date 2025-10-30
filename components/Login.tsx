import React from 'react';
import { getFirebase, provider } from '../utils/firebase';
import { signInWithPopup } from 'firebase/auth';

const GoogleIcon = () => (
    <svg className="w-6 h-6 mr-3" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 9.92C34.553 6.184 29.654 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"></path>
        <path fill="#FF3D00" d="M6.306 14.691c2.14-3.558 5.613-6.084 9.694-7.401l-5.45-5.45C4.093 6.574 1.346 11.534 0 17.379l6.306-2.688z"></path>
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238c-2.008 1.521-4.504 2.43-7.219 2.43c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"></path>
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.16-4.087 5.571l6.19 5.238c3.897-3.626 6.19-8.983 6.19-14.809c0-1.341-.138-2.65-.389-3.917z"></path>
    </svg>
);

interface LoginProps {
  error?: string | null;
}

const Login: React.FC<LoginProps> = ({ error }) => {
    
    const handleSignIn = async () => {
        try {
            const { auth } = await getFirebase();
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Sign in failed", error);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center">
            <h1 className="text-4xl font-bold mb-4">My Second Brain</h1>
            <p className="text-lg text-gray-400 mb-12">Sign in to sync your memories across all devices.</p>
            <button
                onClick={handleSignIn}
                disabled={!!error}
                className="flex items-center justify-center px-6 py-3 bg-white text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-200 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                <GoogleIcon />
                Sign in with Google
            </button>
            {error && (
                <div className="mt-8 text-red-400 bg-red-900 bg-opacity-50 p-4 rounded-lg max-w-sm">
                    <p className="font-bold text-lg mb-2">Configuration Error</p>
                    <p className="text-left">{error}</p>
                </div>
            )}
        </div>
    );
};

export default Login;
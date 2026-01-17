
import React, { useState } from 'react';
import { XIcon, CheckIcon, SaveIcon, GlobeIcon } from './Icons';

interface FirebaseDomainHelpProps {
    onClose: () => void;
}

const FirebaseDomainHelp: React.FC<FirebaseDomainHelpProps> = ({ onClose }) => {
    const [copied, setCopied] = useState(false);
    const currentDomain = window.location.hostname;

    const handleCopy = () => {
        navigator.clipboard.writeText(currentDomain);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[100] p-4 animate-fade-in overflow-y-auto">
            <div className="bg-gray-800 rounded-[3rem] shadow-2xl w-full max-w-xl border-4 border-blue-500 flex flex-col my-auto relative">
                <header className="flex justify-between items-start p-8 border-b-4 border-gray-700 bg-blue-900/20 rounded-t-[2.8rem]">
                    <div>
                        <h2 className="text-3xl font-black text-white flex items-center gap-3 uppercase tracking-tighter">
                            <GlobeIcon className="w-10 h-10 text-blue-400" />
                            Fix Login Error
                        </h2>
                        <p className="text-blue-300 text-lg font-bold mt-2">
                            You need to tell Firebase that this website is safe.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-4 rounded-2xl hover:bg-gray-700 transition-colors" aria-label="Close help">
                        <XIcon className="w-12 h-12 text-gray-400"/>
                    </button>
                </header>
                
                <div className="p-8 space-y-8">
                    <div className="space-y-4">
                        <p className="text-xl text-white font-black uppercase tracking-tight">Step 1: Copy your app URL</p>
                        <div className="flex gap-3">
                            <div className="flex-grow bg-black p-5 rounded-2xl border-4 border-gray-700 font-mono text-xl text-blue-400 truncate shadow-inner">
                                {currentDomain}
                            </div>
                            <button 
                                onClick={handleCopy}
                                className={`flex-shrink-0 px-8 py-5 rounded-2xl font-black text-xl transition-all shadow-xl flex items-center gap-3 ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white border-b-8 border-blue-800 active:border-b-0 active:translate-y-2'}`}
                            >
                                {copied ? <CheckIcon className="w-8 h-8"/> : <SaveIcon className="w-8 h-8"/>}
                                {copied ? "COPIED" : "COPY"}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <p className="text-xl text-white font-black uppercase tracking-tight">Step 2: Update Firebase Settings</p>
                        <ol className="space-y-4 text-gray-300 text-lg font-bold">
                            <li className="flex gap-4">
                                <span className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shrink-0">1</span>
                                <span>Go to your <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">Firebase Console</a>.</span>
                            </li>
                            <li className="flex gap-4">
                                <span className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shrink-0">2</span>
                                <span>Click <strong className="text-white">Authentication</strong> &gt; <strong className="text-white">Settings</strong> tab.</span>
                            </li>
                            <li className="flex gap-4">
                                <span className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shrink-0">3</span>
                                <span>Look for <strong className="text-white">Authorized domains</strong>.</span>
                            </li>
                            <li className="flex gap-4">
                                <span className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shrink-0">4</span>
                                <span>Click <strong className="text-blue-400">Add domain</strong> and paste the URL you copied above.</span>
                            </li>
                        </ol>
                    </div>

                    <div className="bg-gray-900 p-6 rounded-[2rem] border-4 border-gray-700">
                        <p className="text-gray-400 text-base font-bold leading-snug">
                            <strong>Note:</strong> If you are on Android, please use <strong className="text-white">Google Chrome</strong> for the best experience. The Share Menu might not work in other browsers.
                        </p>
                    </div>
                </div>

                <div className="p-8 border-t-4 border-gray-700 bg-gray-800 rounded-b-[2.8rem]">
                    <button onClick={onClose} className="w-full py-6 bg-blue-600 text-white font-black text-2xl rounded-2xl border-b-8 border-blue-800 active:border-b-0 active:translate-y-2 transition-all shadow-xl">
                        I'VE ADDED THE DOMAIN
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FirebaseDomainHelp;

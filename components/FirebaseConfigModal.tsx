
import React, { useState } from 'react';
import { saveFirebaseConfig } from '../utils/firebase';
import { XIcon, SaveIcon, BrainCircuitIcon } from './Icons';

interface FirebaseConfigModalProps {
    onClose: () => void;
}

const FirebaseConfigModal: React.FC<FirebaseConfigModalProps> = ({ onClose }) => {
    const [config, setConfig] = useState({
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setConfig(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        // Attempt to parse JSON from paste if the user copies the whole object
        try {
            const pastedText = e.clipboardData.getData('text');
            // Look for JSON-like structure
            if (pastedText.includes('{')) {
                const match = pastedText.match(/apiKey:\s*['"]([^'"]+)['"]/);
                if (match) {
                    e.preventDefault();
                    // This is a rough heuristic to extract from code snippets
                    const extract = (key: string) => {
                        const regex = new RegExp(`${key}:\\s*['"]([^'"]+)['"]`);
                        const m = pastedText.match(regex);
                        return m ? m[1] : '';
                    };
                    setConfig({
                        apiKey: extract('apiKey'),
                        authDomain: extract('authDomain'),
                        projectId: extract('projectId'),
                        storageBucket: extract('storageBucket'),
                        messagingSenderId: extract('messagingSenderId'),
                        appId: extract('appId')
                    });
                }
            }
        } catch (err) {
            // ignore
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        saveFirebaseConfig(config);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg border border-gray-600 flex flex-col max-h-[90vh]">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <BrainCircuitIcon className="w-6 h-6 text-blue-400"/> 
                        Connect Personal Database
                    </h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                
                <div className="p-6 overflow-y-auto">
                    <p className="text-gray-300 mb-4 text-sm leading-relaxed">
                        To store your private data securely in the cloud (so you can see it on both your phone and laptop), you need to connect to a free <strong>Google Firebase</strong> project.
                    </p>
                    <ol className="list-decimal list-inside text-gray-400 text-sm mb-6 space-y-2">
                         <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">console.firebase.google.com</a>.</li>
                         <li>Create a new project (it's free).</li>
                         <li>Add a "Web App" to the project.</li>
                         <li>Copy the configuration values and paste them below.</li>
                    </ol>
                    
                    <form onSubmit={handleSubmit} className="space-y-4" onPaste={handlePaste}>
                        {Object.keys(config).map((key) => (
                            <div key={key}>
                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{key}</label>
                                <input
                                    type="text"
                                    name={key}
                                    value={(config as any)[key]}
                                    onChange={handleChange}
                                    className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 font-mono text-sm"
                                    placeholder={`Paste ${key}`}
                                    required
                                />
                            </div>
                        ))}
                        
                        <div className="pt-4 flex gap-3">
                            <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-700 text-white rounded hover:bg-gray-600">Cancel</button>
                            <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 flex items-center justify-center gap-2">
                                <SaveIcon className="w-5 h-5"/> Connect Database
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default FirebaseConfigModal;

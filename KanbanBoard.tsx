
import React, { useState } from 'react';
import { XIcon, CheckIcon, SaveIcon } from './Icons';

const RULES_CODE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

interface FirebaseRulesHelpProps {
    onClose: () => void;
}

const FirebaseRulesHelp: React.FC<FirebaseRulesHelpProps> = ({ onClose }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(RULES_CODE);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg border-2 border-red-500 flex flex-col max-h-[90vh]">
                <header className="flex justify-between items-start p-4 border-b border-gray-700 bg-red-900 bg-opacity-20">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            ⚠️ Database Locked
                        </h2>
                        <p className="text-red-200 text-sm mt-1">
                            Your app cannot save data because Firestore Security Rules are blocking it.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700" aria-label="Close help">
                        <XIcon className="w-6 h-6 text-gray-300"/>
                    </button>
                </header>
                
                <div className="p-6 overflow-y-auto space-y-6">
                    <ol className="list-decimal list-inside text-gray-300 space-y-4 text-base">
                        <li>
                            Go to the <strong className="text-white">Firebase Console</strong>.
                        </li>
                        <li>
                            Click on <strong className="text-white">Firestore Database</strong> in the left menu.
                        </li>
                        <li>
                            <span className="bg-blue-900 text-blue-100 px-2 py-1 rounded text-sm font-bold border border-blue-500">Crucial Step</span> Click the <strong className="text-white">Rules</strong> tab (next to the Data tab).
                        </li>
                        <li>
                            Delete all code in the editor and paste this:
                        </li>
                    </ol>

                    <div className="relative">
                        <pre className="bg-black p-4 rounded-md border border-gray-600 text-green-400 font-mono text-xs sm:text-sm overflow-x-auto">
                            {RULES_CODE}
                        </pre>
                        <button 
                            onClick={handleCopy}
                            className="absolute top-2 right-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded border border-gray-500 flex items-center gap-1"
                        >
                            {copied ? <CheckIcon className="w-4 h-4 text-green-400"/> : <SaveIcon className="w-4 h-4"/>}
                            {copied ? "Copied!" : "Copy Code"}
                        </button>
                    </div>

                    <p className="text-gray-400 text-sm">
                        5. Click the <strong className="text-white">Publish</strong> button in the top right of the editor.
                    </p>
                    
                    <div className="bg-gray-700 p-3 rounded text-sm text-gray-300">
                        <strong>Why?</strong> By default, Firebase blocks all data entry. This rule allows your logged-in user to save their memories.
                    </div>
                </div>

                <div className="p-4 border-t border-gray-700 bg-gray-800 rounded-b-lg">
                    <button onClick={onClose} className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">
                        I have updated the Rules
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FirebaseRulesHelp;

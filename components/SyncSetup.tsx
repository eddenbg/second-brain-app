import React, { useState } from 'react';

interface SyncSetupProps {
    onSyncIdSet: (syncId: string) => void;
}

const SyncSetup: React.FC<SyncSetupProps> = ({ onSyncIdSet }) => {
    const [syncIdInput, setSyncIdInput] = useState('');
    const [error, setError] = useState('');

    const generateNewId = () => {
        const newId = crypto.randomUUID();
        onSyncIdSet(newId);
    };

    const handleUseExisting = () => {
        if (syncIdInput.trim()) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(syncIdInput.trim())) {
                onSyncIdSet(syncIdInput.trim());
            } else {
                setError('Invalid Sync ID format. It should look like a UUID.');
            }
        } else {
            setError('Please enter a Sync ID.');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-white p-8 text-center">
            <h1 className="text-4xl font-bold mb-4">My Second Brain</h1>
            <p className="text-lg text-gray-400 mb-12 max-w-lg">
                To sync your memories across devices, create a new Sync ID or enter an existing one.
                <br />
                <strong className="text-amber-400">Keep this ID safe, as it's the key to your data.</strong>
            </p>
            
            <div className="w-full max-w-sm space-y-6">
                <button
                    onClick={generateNewId}
                    className="w-full flex items-center justify-center px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors"
                >
                    Create a New Sync ID
                </button>

                <div className="text-center text-gray-500">OR</div>

                <div className="space-y-2">
                     <p className="text-md text-gray-400">Use an ID from another device:</p>
                    <input
                        type="text"
                        value={syncIdInput}
                        onChange={(e) => {
                            setSyncIdInput(e.target.value);
                            setError('');
                        }}
                        onKeyPress={(e) => e.key === 'Enter' && handleUseExisting()}
                        placeholder="Enter existing Sync ID..."
                        className="w-full bg-gray-800 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                     <button
                        onClick={handleUseExisting}
                        className="w-full flex items-center justify-center px-6 py-3 bg-gray-700 text-white font-semibold rounded-lg shadow-md hover:bg-gray-600 transition-colors"
                    >
                        Use Existing ID
                    </button>
                </div>
            </div>

            {error && (
                <div className="mt-6 text-red-400 bg-red-900 bg-opacity-50 p-3 rounded-lg">
                    <p>{error}</p>
                </div>
            )}
        </div>
    );
};

export default SyncSetup;

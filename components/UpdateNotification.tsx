import React from 'react';
import { UploadIcon } from './Icons';

interface UpdateNotificationProps {
    onUpdate: () => void;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onUpdate }) => {
    return (
        <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white py-3 px-6 rounded-lg shadow-lg flex items-center gap-4 animate-fade-in-up">
            <p className="font-semibold">A new version is available!</p>
            <button
                onClick={onUpdate}
                className="flex items-center gap-2 bg-white text-blue-700 font-bold py-2 px-4 rounded-md hover:bg-blue-100 transition-colors"
            >
                <UploadIcon className="w-5 h-5" />
                Update Now
            </button>
        </div>
    );
};

export default UpdateNotification;

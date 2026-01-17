
import React from 'react';
import { UploadIcon } from './Icons';

interface UpdateNotificationProps {
    onUpdate: () => void;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onUpdate }) => {
    return (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[200] bg-blue-600 text-white py-4 px-6 rounded-2xl shadow-2xl flex items-center gap-5 border-2 border-blue-400 animate-slide-up w-[90%] max-w-sm">
            <div className="flex-grow">
                <p className="font-black uppercase text-sm tracking-tight">App Update</p>
                <p className="text-xs font-bold text-blue-100 mt-0.5">New features are ready!</p>
            </div>
            <button
                onClick={onUpdate}
                className="flex items-center gap-2 bg-white text-blue-700 font-black py-2.5 px-4 rounded-xl shadow-lg active:scale-90 transition-transform text-xs uppercase"
            >
                <UploadIcon className="w-4 h-4" />
                Update
            </button>
        </div>
    );
};

export default UpdateNotification;

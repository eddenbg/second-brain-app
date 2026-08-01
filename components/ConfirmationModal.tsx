import React from 'react';
import { XIcon } from './Icons';

interface ConfirmationModalProps {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDangerous = false,
    onConfirm,
    onCancel,
}) => {
    return (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full border-2 border-gray-700 overflow-hidden">
                <div className="p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <h2 className="text-lg font-black text-white uppercase">{title}</h2>
                        <button
                            onClick={onCancel}
                            className="text-gray-400 hover:text-white transition-colors"
                            aria-label="Close"
                        >
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-gray-300 text-sm">{message}</p>
                </div>
                <div className="flex gap-3 p-6 bg-gray-900/50 border-t border-gray-700">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold text-sm uppercase transition-all active:scale-95"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold text-sm uppercase transition-all active:scale-95 text-white ${
                            isDangerous
                                ? 'bg-red-600 hover:bg-red-500'
                                : 'bg-blue-600 hover:bg-blue-500'
                        }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;

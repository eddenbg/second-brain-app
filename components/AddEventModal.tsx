
import React, { useState } from 'react';
import type { CalendarEvent } from '../types';
import { XIcon, SaveIcon } from './Icons';

interface AddEventModalProps {
    date: Date;
    onClose: () => void;
    onSave: (event: Omit<CalendarEvent, 'id'>) => void;
}

const AddEventModal: React.FC<AddEventModalProps> = ({ date, onClose, onSave }) => {
    const [title, setTitle] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('10:00');
    const [category, setCategory] = useState<'college' | 'personal'>('college');
    const [description, setDescription] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);
        
        const startDate = new Date(date);
        startDate.setHours(startHour, startMinute, 0, 0);

        const endDate = new Date(date);
        endDate.setHours(endHour, endMinute, 0, 0);

        onSave({
            title,
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
            category,
            description,
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[110] p-4">
            <form onSubmit={handleSubmit} className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border-2 border-gray-600">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold text-white">Add Event for {date.toLocaleDateString()}</h2>
                    <button type="button" onClick={onClose}><XIcon className="w-6 h-6 text-gray-400" /></button>
                </header>
                <main className="p-6 space-y-4">
                    <div>
                        <label className="block text-gray-300 font-bold mb-2">Title</label>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-gray-700 p-3 rounded border border-gray-600 focus:border-blue-500" autoFocus required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-300 font-bold mb-2">Start Time</label>
                            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full bg-gray-700 p-3 rounded border border-gray-600" required />
                        </div>
                        <div>
                            <label className="block text-gray-300 font-bold mb-2">End Time</label>
                            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full bg-gray-700 p-3 rounded border border-gray-600" required />
                        </div>
                    </div>
                     <div>
                        <label className="block text-gray-300 font-bold mb-2">Category</label>
                        <select value={category} onChange={e => setCategory(e.target.value as any)} className="w-full bg-gray-700 p-3 rounded border border-gray-600">
                            <option value="college">College</option>
                            <option value="personal">Personal</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-gray-300 font-bold mb-2">Description (optional)</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full bg-gray-700 p-3 rounded border border-gray-600"></textarea>
                    </div>
                </main>
                <footer className="p-4 flex justify-end gap-3 bg-gray-900/50 rounded-b-xl">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-600 rounded text-white font-bold">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 rounded text-white font-bold flex items-center gap-2"><SaveIcon className="w-5 h-5"/> Save Event</button>
                </footer>
            </form>
        </div>
    );
};

export default AddEventModal;

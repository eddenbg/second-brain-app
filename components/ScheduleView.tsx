
import React, { useState, useMemo } from 'react';
import type { CalendarEvent } from '../types';
import { CalendarIcon, XIcon, ArrowLeftIcon, ChevronDownIcon, PlusCircleIcon } from './Icons';
import AddEventModal from './AddEventModal';

interface ScheduleViewProps {
    events: CalendarEvent[];
    onClose: () => void;
    onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
    onDeleteEvent: (id: string) => void;
}

const ScheduleView: React.FC<ScheduleViewProps> = ({ events, onClose, onAddEvent, onDeleteEvent }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    const handleAddClick = (day: Date) => {
        setSelectedDate(day);
        setShowAddModal(true);
    };

    const handleSaveEvent = (event: Omit<CalendarEvent, 'id'>) => {
        onAddEvent(event);
        setShowAddModal(false);
    };

    const daysInMonth = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const days = [];
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push(new Date(year, month, i));
        }
        // Pad start
        for (let i = 0; i < firstDay.getDay(); i++) {
            days.unshift(new Date(year, month, 0 - i));
        }
        // Pad end
        const gridsize = 42; // 6 weeks for consistency
        while(days.length < gridsize) {
            const last = days[days.length - 1];
            days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
        }
        return days;
    }, [currentDate]);

    const changeMonth = (amount: number) => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + amount, 1));
    };

    // Mobile view (Daily list)
    const mobileDailyView = () => (
        <div className="flex-grow overflow-y-auto space-y-3 pr-1 pb-20">
            {Array.from({ length: 16 }, (_, i) => i + 7).map(hour => {
                const event = events.find(e => new Date(e.startTime).getHours() === hour);
                const isCollege = event?.category === 'college';
                const isMoodle = event?.source === 'moodle';
                
                let style = 'bg-purple-900/40 border-purple-500'; // Personal
                if (isCollege) style = 'bg-blue-900/40 border-blue-500';
                if (isMoodle) style = 'bg-green-900/40 border-green-500';

                return (
                    <div key={hour} className="flex gap-3 items-stretch min-h-[5rem]">
                        <div className="w-16 py-3 flex flex-col items-center justify-center bg-gray-800 rounded-xl border border-gray-700 shrink-0"><span className="text-lg font-black text-white">{hour}:00</span></div>
                        {event ? (
                            <div className={`flex-grow p-4 rounded-2xl border-2 shadow-lg ${style}`}><h3 className="text-lg font-black uppercase leading-tight">{event.title}</h3></div>
                        ) : (
                            <div className="flex-grow p-4 rounded-2xl bg-gray-800/20 border-2 border-dashed border-gray-700 flex items-center"><span className="text-gray-600 text-sm font-black uppercase">Available</span></div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // Desktop view (Monthly grid)
    const desktopMonthView = () => (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="grid grid-cols-7 text-center font-black text-gray-400 uppercase text-sm mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day}>{day}</div>)}
            </div>
            <div className="grid grid-cols-7 grid-rows-6 flex-grow gap-2">
                {daysInMonth.map((day, i) => {
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = day.toDateString() === new Date().toDateString();
                    const dayEvents = events.filter(e => new Date(e.startTime).toDateString() === day.toDateString());
                    return (
                        <div key={i} className={`bg-gray-800 rounded-lg p-2 flex flex-col overflow-hidden transition-colors ${isCurrentMonth ? 'border border-gray-700' : 'opacity-40'}`}>
                            <div className="flex justify-between items-center mb-1">
                                <span className={`font-black text-sm ${isToday ? 'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-gray-300'}`}>{day.getDate()}</span>
                                {isCurrentMonth && <button onClick={() => handleAddClick(day)} className="text-blue-400 hover:text-white"><PlusCircleIcon className="w-5 h-5"/></button>}
                            </div>
                            <div className="flex-grow overflow-y-auto text-xs space-y-1">
                                {dayEvents.map(event => {
                                    let style = 'bg-purple-900/70'; // Personal
                                    if (event.category === 'college') style = 'bg-blue-900/70';
                                    if (event.source === 'moodle') style = 'bg-green-900/70';
                                    
                                    return (
                                        <div key={event.id} className={`p-1 rounded flex justify-between items-start text-white font-bold ${style}`}>
                                            <span className="leading-tight">{event.title}</span>
                                            {event.source !== 'moodle' && <button onClick={() => onDeleteEvent(event.id)} className="text-red-300 hover:text-red-100 opacity-50 hover:opacity-100"><XIcon className="w-3 h-3"/></button>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-gray-900 z-[100] flex flex-col p-4 sm:p-6 overflow-hidden" style={{ paddingTop: 'calc(var(--sat) + 1rem)' }}>
            {showAddModal && selectedDate && <AddEventModal date={selectedDate} onClose={() => setShowAddModal(false)} onSave={handleSaveEvent} />}
            
            <header className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="p-3 bg-gray-800 rounded-xl active:scale-95"><ArrowLeftIcon className="w-8 h-8"/></button>
                    <div className="hidden md:flex items-center gap-2">
                        <button onClick={() => changeMonth(-1)} className="p-2 bg-gray-800 rounded-md"><ChevronDownIcon className="w-6 h-6 rotate-90"/></button>
                        <h2 className="text-2xl font-black text-white w-48 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                        <button onClick={() => changeMonth(1)} className="p-2 bg-gray-800 rounded-md"><ChevronDownIcon className="w-6 h-6 -rotate-90"/></button>
                        <button onClick={() => setCurrentDate(new Date())} className="ml-2 px-3 py-2 bg-blue-600 text-white font-bold text-sm rounded-md">Today</button>
                    </div>
                     <h2 className="text-2xl sm:text-3xl font-black text-white md:hidden">Daily Planner</h2>
                </div>
                <CalendarIcon className="w-10 h-10 text-blue-500" />
            </header>
            
            <div className="md:hidden flex-grow overflow-hidden">{mobileDailyView()}</div>
            <div className="hidden md:flex flex-grow overflow-hidden">{desktopMonthView()}</div>

        </div>
    );
};

export default ScheduleView;
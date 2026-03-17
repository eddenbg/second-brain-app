
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
            const last: Date = days[days.length - 1];
            days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
        }
        return days;
    }, [currentDate]);

    const changeMonth = (amount: number) => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + amount, 1));
    };

    // Mobile view (Daily list)
    const mobileDailyView = () => (
        <div className="flex-grow overflow-y-auto space-y-4 pr-1 pb-24 scrollbar-hide">
            {Array.from({ length: 16 }, (_, i) => i + 7).map(hour => {
                const event = events.find(e => new Date(e.startTime).getHours() === hour);
                const isCollege = event?.category === 'college';
                const isMoodle = event?.source === 'moodle';
                
                let style = 'bg-white/5 border-white/20 text-white'; // Personal
                if (isCollege) style = 'bg-yellow-500/10 border-yellow-500 text-yellow-500';
                if (isMoodle) style = 'bg-white/10 border-white/40 text-white';

                return (
                    <div key={hour} className="flex gap-4 items-stretch min-h-[6rem]">
                        <div className="w-20 py-4 flex flex-col items-center justify-center bg-white/5 rounded-[1.5rem] border-2 border-white/10 shrink-0 shadow-xl">
                            <span className="text-xl font-black text-white">{hour}:00</span>
                        </div>
                        {event ? (
                            <div className={`flex-grow p-5 rounded-[2rem] border-4 shadow-2xl ${style} flex flex-col justify-center`}>
                                <h3 className="text-xl font-black uppercase leading-tight tracking-tighter">{event.title}</h3>
                                {event.description && <p className="text-xs font-bold opacity-70 mt-1 line-clamp-1">{event.description}</p>}
                            </div>
                        ) : (
                            <button 
                                onClick={() => handleAddClick(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour))}
                                aria-label={`Add event at ${hour}:00`}
                                className="flex-grow p-5 rounded-[2rem] bg-black/20 border-4 border-dashed border-white/10 flex items-center hover:bg-white/5 transition-colors group"
                            >
                                <span className="text-white/20 group-hover:text-white/40 text-sm font-black uppercase tracking-widest">Available</span>
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // Desktop view (Monthly grid)
    const desktopMonthView = () => (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="grid grid-cols-7 text-center font-black text-yellow-500 uppercase text-xs tracking-widest mb-4">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day}>{day}</div>)}
            </div>
            <div className="grid grid-cols-7 grid-rows-6 flex-grow gap-4">
                {daysInMonth.map((day, i) => {
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = day.toDateString() === new Date().toDateString();
                    const dayEvents = events.filter(e => new Date(e.startTime).toDateString() === day.toDateString());
                    return (
                        <div key={i} className={`bg-white/5 rounded-[2rem] p-4 flex flex-col overflow-hidden transition-all border-4 ${isCurrentMonth ? 'border-white/5' : 'opacity-20 border-transparent'} ${isToday ? 'ring-4 ring-yellow-500 ring-offset-4 ring-offset-[#001f3f]' : ''}`}>
                            <div className="flex justify-between items-center mb-3">
                                <span className={`font-black text-lg ${isToday ? 'text-yellow-500' : 'text-white'}`}>{day.getDate()}</span>
                                {isCurrentMonth && (
                                    <button 
                                        onClick={() => handleAddClick(day)} 
                                        aria-label={`Add event on ${day.toDateString()}`}
                                        className="text-white/20 hover:text-yellow-500 transition-colors"
                                    >
                                        <PlusCircleIcon className="w-6 h-6"/>
                                    </button>
                                )}
                            </div>
                            <div className="flex-grow overflow-y-auto text-[10px] space-y-2 scrollbar-hide">
                                {dayEvents.map(event => {
                                    let style = 'bg-white/10 text-white border-white/10'; // Personal
                                    if (event.category === 'college') style = 'bg-yellow-500 text-[#001f3f] border-yellow-600';
                                    if (event.source === 'moodle') style = 'bg-white/20 text-white border-white/20';
                                    
                                    return (
                                        <div key={event.id} className={`p-2 rounded-xl flex justify-between items-start font-black uppercase tracking-tight border-2 shadow-sm ${style}`}>
                                            <span className="leading-none truncate mr-1">{event.title}</span>
                                            {event.source !== 'moodle' && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onDeleteEvent(event.id); }} 
                                                    aria-label={`Delete event ${event.title}`}
                                                    className="hover:scale-125 transition-transform shrink-0"
                                                >
                                                    <XIcon className="w-3 h-3"/>
                                                </button>
                                            )}
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
        <div className="fixed inset-0 bg-[#001f3f] z-[100] flex flex-col p-6 sm:p-10 overflow-hidden animate-fade-in" style={{ paddingTop: 'calc(var(--sat) + 1.5rem)' }}>
            {showAddModal && selectedDate && <AddEventModal date={selectedDate} onClose={() => setShowAddModal(false)} onSave={handleSaveEvent} />}
            
            <header className="flex items-center justify-between mb-10 shrink-0">
                <div className="flex items-center gap-6">
                    <button onClick={onClose} aria-label="Back to main view" className="p-4 bg-white/10 rounded-2xl active:scale-90 transition-all hover:bg-white/20 shadow-xl"><ArrowLeftIcon className="w-10 h-10 text-white"/></button>
                    <div className="hidden md:flex items-center gap-4">
                        <button onClick={() => changeMonth(-1)} aria-label="Previous month" className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"><ChevronDownIcon className="w-8 h-8 rotate-90 text-white"/></button>
                        <h2 className="text-4xl font-black text-white w-72 text-center uppercase tracking-tighter">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                        <button onClick={() => changeMonth(1)} aria-label="Next month" className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"><ChevronDownIcon className="w-8 h-8 -rotate-90 text-white"/></button>
                        <button onClick={() => setCurrentDate(new Date())} className="ml-4 px-6 py-3 bg-yellow-500 text-[#001f3f] font-black uppercase tracking-widest text-sm rounded-xl hover:bg-yellow-600 transition-all shadow-xl">Today</button>
                    </div>
                     <h2 className="text-4xl font-black text-white md:hidden uppercase tracking-tighter">Planner</h2>
                </div>
                <div className="bg-yellow-500 p-4 rounded-[1.5rem] shadow-2xl shadow-yellow-900/40">
                    <CalendarIcon className="w-12 h-12 text-[#001f3f]" />
                </div>
            </header>
            
            <div className="md:hidden flex-grow overflow-hidden">{mobileDailyView()}</div>
            <div className="hidden md:flex flex-grow overflow-hidden">{desktopMonthView()}</div>

        </div>
    );
};

export default ScheduleView;
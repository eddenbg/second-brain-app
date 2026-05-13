import React, { useState, useMemo } from 'react';
import type { CalendarEvent } from '../types';
import { ArrowLeftIcon, ChevronDownIcon, PlusIcon, XIcon } from './Icons';
import AddEventModal from './AddEventModal';

interface ScheduleViewProps {
    events: CalendarEvent[];
    onClose: () => void;
    onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
    onDeleteEvent: (id: string) => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dotColor = (event: CalendarEvent): string => {
    if (event.source === 'google') return 'bg-blue-400';
    if (event.source === 'moodle') return 'bg-yellow-400';
    if (event.category === 'college') return 'bg-purple-400';
    return 'bg-white/60';
};

const eventBorderColor = (event: CalendarEvent): string => {
    if (event.source === 'google') return 'border-blue-500';
    if (event.source === 'moodle') return 'border-yellow-500';
    if (event.category === 'college') return 'border-purple-500';
    return 'border-white/30';
};

const eventLabelColor = (event: CalendarEvent): string => {
    if (event.source === 'google') return 'text-blue-300';
    if (event.source === 'moodle') return 'text-yellow-300';
    if (event.category === 'college') return 'text-purple-300';
    return 'text-gray-400';
};

const ScheduleView: React.FC<ScheduleViewProps> = ({ events, onClose, onAddEvent, onDeleteEvent }) => {
    const today = useMemo(() => new Date(), []);
    const [currentMonth, setCurrentMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
    const [selectedDay, setSelectedDay] = useState(today);
    const [showAddModal, setShowAddModal] = useState(false);

    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const days: Date[] = [];

        for (let i = firstDay.getDay() - 1; i >= 0; i--) {
            days.push(new Date(year, month, -i));
        }
        for (let d = 1; d <= lastDay.getDate(); d++) {
            days.push(new Date(year, month, d));
        }
        while (days.length < 42) {
            const last = days[days.length - 1];
            days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
        }
        return days;
    }, [currentMonth]);

    const eventsForDay = (day: Date) =>
        events.filter(e => new Date(e.startTime).toDateString() === day.toDateString());

    const selectedDayEvents = useMemo(() =>
        eventsForDay(selectedDay).sort(
            (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        ),
        [events, selectedDay]
    );

    const changeMonth = (dir: number) => {
        setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
    };

    const selectDay = (day: Date) => {
        setSelectedDay(day);
        if (day.getMonth() !== currentMonth.getMonth()) {
            setCurrentMonth(new Date(day.getFullYear(), day.getMonth(), 1));
        }
    };

    const jumpToToday = () => {
        setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        setSelectedDay(today);
    };

    const formatTime = (iso: string) =>
        new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <div
            className="fixed inset-0 bg-[#001f3f] z-[100] flex flex-col overflow-hidden animate-fade-in"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}
        >
            {showAddModal && (
                <AddEventModal
                    date={selectedDay}
                    onClose={() => setShowAddModal(false)}
                    onSave={ev => { onAddEvent(ev); setShowAddModal(false); }}
                />
            )}

            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b-2 border-white/10 shrink-0">
                <button
                    onClick={onClose}
                    aria-label="Close calendar"
                    className="p-3 bg-white/10 rounded-2xl active:scale-90 transition-transform"
                >
                    <ArrowLeftIcon className="w-6 h-6 text-white" />
                </button>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => changeMonth(-1)}
                        aria-label="Previous month"
                        className="p-2.5 bg-white/10 rounded-xl active:scale-90 transition-transform"
                    >
                        <ChevronDownIcon className="w-5 h-5 text-white rotate-90" />
                    </button>
                    <h2 className="text-base font-black text-white uppercase tracking-tighter w-40 text-center">
                        {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h2>
                    <button
                        onClick={() => changeMonth(1)}
                        aria-label="Next month"
                        className="p-2.5 bg-white/10 rounded-xl active:scale-90 transition-transform"
                    >
                        <ChevronDownIcon className="w-5 h-5 text-white -rotate-90" />
                    </button>
                </div>

                <button
                    onClick={jumpToToday}
                    className="px-4 py-2 bg-yellow-500 text-[#001f3f] font-black text-xs uppercase rounded-xl active:scale-90 transition-transform"
                >
                    Today
                </button>
            </header>

            {/* Week day labels */}
            <div className="grid grid-cols-7 shrink-0 border-b border-white/10">
                {DAYS.map(d => (
                    <div key={d} className="text-center py-2 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        {d[0]}
                    </div>
                ))}
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-7 shrink-0 gap-y-0.5 px-1 py-1">
                {calendarDays.map((day, i) => {
                    const inMonth = day.getMonth() === currentMonth.getMonth();
                    const isToday = day.toDateString() === today.toDateString();
                    const isSelected = day.toDateString() === selectedDay.toDateString();
                    const dayEvs = eventsForDay(day);

                    return (
                        <button
                            key={i}
                            onClick={() => selectDay(day)}
                            className="flex flex-col items-center py-1 gap-0.5 rounded-xl active:bg-white/10 transition-colors"
                        >
                            <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-black transition-all
                                ${
                                    isSelected && isToday
                                        ? 'bg-yellow-500 text-[#001f3f]'
                                        : isSelected
                                            ? 'bg-white text-[#001f3f]'
                                            : isToday
                                                ? 'bg-blue-600 text-white'
                                                : inMonth
                                                    ? 'text-white'
                                                    : 'text-white/20'
                                }`}
                            >
                                {day.getDate()}
                            </div>
                            <div className="flex gap-0.5 h-1.5">
                                {dayEvs.slice(0, 3).map((ev, ei) => (
                                    <div
                                        key={ei}
                                        className={`w-1.5 h-1.5 rounded-full ${dotColor(ev)} ${!inMonth ? 'opacity-20' : ''}`}
                                    />
                                ))}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Day events panel */}
            <div className="flex-grow flex flex-col border-t-2 border-white/10 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 shrink-0">
                    <div>
                        <h3 className="font-black text-white text-sm uppercase tracking-tight">
                            {selectedDay.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </h3>
                        {selectedDayEvents.length > 0 && (
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                {selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        aria-label="Add event"
                        className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 text-[#001f3f] font-black text-xs uppercase rounded-xl active:scale-90 transition-transform shadow-lg"
                    >
                        <PlusIcon className="w-4 h-4" /> Add
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto px-4 pb-6 space-y-2 scrollbar-hide">
                    {selectedDayEvents.length === 0 ? (
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="w-full py-10 flex flex-col items-center gap-3 rounded-[2rem] border-4 border-dashed border-white/10 text-gray-600 active:border-white/20 transition-colors"
                        >
                            <PlusIcon className="w-8 h-8" />
                            <span className="font-black text-xs uppercase tracking-widest">No events — tap to add</span>
                        </button>
                    ) : (
                        selectedDayEvents.map(event => {
                            const startIso = event.startTime;
                            const endIso = event.endTime;
                            const isAllDay = !startIso.includes('T');
                            const timeStr = isAllDay
                                ? 'All day'
                                : `${formatTime(startIso)} – ${formatTime(endIso)}`;

                            const canDelete = event.source !== 'moodle' && event.source !== 'google';

                            return (
                                <div
                                    key={event.id}
                                    className={`flex items-start gap-3 p-4 bg-white/5 rounded-2xl border-l-4 ${eventBorderColor(event)}`}
                                >
                                    <div className="shrink-0 pt-0.5">
                                        <p className={`text-[10px] font-black uppercase tracking-wider ${eventLabelColor(event)}`}>
                                            {event.source === 'google' ? 'Google' : event.source === 'moodle' ? 'Moodle' : event.category}
                                        </p>
                                        <p className="text-xs font-bold text-gray-400">{timeStr}</p>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <p className="font-black text-white text-sm">{event.title}</p>
                                        {event.description && (
                                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{event.description}</p>
                                        )}
                                    </div>
                                    {canDelete && (
                                        <button
                                            onClick={() => onDeleteEvent(event.id)}
                                            aria-label={`Delete ${event.title}`}
                                            className="p-2 bg-white/5 rounded-xl shrink-0 active:scale-90 transition-transform"
                                        >
                                            <XIcon className="w-4 h-4 text-gray-500" />
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default ScheduleView;


import React from 'react';
import { MicIcon, BookOpenIcon, BrainCircuitIcon, CameraIcon, GlobeIcon, SettingsIcon, CalendarIcon, FolderIcon } from './Icons';
import type { View } from '../App';

interface SidebarProps {
  view: View;
  setView: (view: View) => void;
  onOpenSettings: () => void;
  onOpenSchedule: () => void;
}

const SidebarItem: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center gap-4 px-6 py-5 rounded-2xl transition-all duration-200 group
            ${isActive 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 translate-x-2' 
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
    >
        <div className={`${isActive ? 'scale-110' : 'group-hover:scale-110'} transition-transform`}>
            {React.cloneElement(icon as React.ReactElement, { 
                className: `w-8 h-8 lg:w-9 lg:h-9` 
            })}
        </div>
        <span className={`text-lg lg:text-xl font-black uppercase tracking-widest ${isActive ? 'opacity-100' : 'opacity-80'}`}>
            {label}
        </span>
    </button>
);

const Sidebar: React.FC<SidebarProps> = ({ view, setView, onOpenSettings, onOpenSchedule }) => {
  return (
    <nav className="w-64 lg:w-80 h-full flex flex-col p-6 space-y-10 bg-[#0b0f1a]">
        <div className="flex items-center gap-4 px-2">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-xl shadow-blue-900/20">
                <BrainCircuitIcon className="w-10 h-10 text-white" />
            </div>
            <div>
                <h2 className="text-xl font-black tracking-tighter leading-none">SECOND</h2>
                <h2 className="text-xl font-black tracking-tighter leading-none text-blue-500">BRAIN</h2>
            </div>
        </div>

        <div className="flex-grow space-y-3">
            <SidebarItem label="College" icon={<BookOpenIcon />} isActive={view === 'college'} onClick={() => setView('college')} />
            <SidebarItem label="Items" icon={<CameraIcon />} isActive={view === 'physical'} onClick={() => setView('physical')} />
            <SidebarItem label="Files" icon={<FolderIcon />} isActive={view === 'files'} onClick={() => setView('files')} />
            <SidebarItem label="Ask AI" icon={<BrainCircuitIcon />} isActive={view === 'askai'} onClick={() => setView('askai')} />
            <SidebarItem label="Web Clips" icon={<GlobeIcon />} isActive={view === 'webclips'} onClick={() => setView('webclips')} />
            <SidebarItem label="Personal" icon={<MicIcon />} isActive={view === 'voicenotes'} onClick={() => setView('voicenotes')} />
        </div>

        <div className="space-y-3 pt-6 border-t border-gray-800">
            <button 
                onClick={onOpenSchedule}
                className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-blue-400 hover:bg-gray-800 transition-all"
            >
                <CalendarIcon className="w-7 h-7" />
                <span className="text-lg font-bold uppercase">Planner</span>
            </button>
            <button 
                onClick={onOpenSettings}
                className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-gray-400 hover:bg-gray-800 transition-all"
            >
                <SettingsIcon className="w-7 h-7" />
                <span className="text-lg font-bold uppercase">Settings</span>
            </button>
        </div>
    </nav>
  );
};

export default Sidebar;

import React from 'react';
import { ListIcon, PlusIcon, BrainCircuitIcon } from './Icons';

type View = 'memories' | 'add' | 'qa';

interface BottomNavBarProps {
  view: View;
  setView: (view: View) => void;
}

const NavButton: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex flex-col items-center justify-center w-full pt-2 pb-1 transition-colors duration-200 ${isActive ? 'text-blue-400' : 'text-gray-400 hover:text-white'}`}
    >
        {icon}
        <span className="text-xs mt-1">{label}</span>
        {isActive && <div className="w-8 h-1 bg-blue-400 rounded-full mt-1"></div>}
    </button>
);


const BottomNavBar: React.FC<BottomNavBarProps> = ({ view, setView }) => {
  return (
    <nav className="absolute bottom-0 left-0 right-0 h-20 bg-gray-900 border-t border-gray-700 flex items-center justify-around z-20">
        <NavButton
            label="Memories"
            icon={<ListIcon className="w-7 h-7" />}
            isActive={view === 'memories'}
            onClick={() => setView('memories')}
        />
        <NavButton
            label="Add"
            icon={<PlusIcon className="w-7 h-7" />}
            isActive={view === 'add'}
            onClick={() => setView('add')}
        />
        <NavButton
            label="Ask AI"
            icon={<BrainCircuitIcon className="w-7 h-7" />}
            isActive={view === 'qa'}
            onClick={() => setView('qa')}
        />
    </nav>
  );
};

export default BottomNavBar;
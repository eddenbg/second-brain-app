
import React from 'react';
import { BookOpen, Brain, User } from 'lucide-react';

type View = 'college' | 'askai' | 'personal';

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
        className={`flex-1 flex flex-col items-center justify-center gap-2 transition-all h-full
            ${isActive 
                ? 'bg-white text-[#001F3F]' 
                : 'text-white hover:bg-white/10'
            }`}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
    >
        {React.cloneElement(icon as React.ReactElement, { 
            className: `w-14 h-14`,
            strokeWidth: 4
        })}
        <span className="text-sm font-black uppercase tracking-widest">
            {label}
        </span>
    </button>
);

const BottomNavBar: React.FC<BottomNavBarProps> = ({ view, setView }) => {
  return (
    <nav 
        className="w-full h-32 grid grid-cols-3 bg-[#001F3F]"
        aria-label="Main Navigation"
    >
        <NavButton
            label="College"
            icon={<BookOpen />}
            isActive={view === 'college'}
            onClick={() => setView('college')}
        />
        <NavButton
            label="Ask AI"
            icon={<Brain />}
            isActive={view === 'askai'}
            onClick={() => setView('askai')}
        />
        <NavButton
            label="Personal"
            icon={<User />}
            isActive={view === 'personal'}
            onClick={() => setView('personal')}
        />
    </nav>
  );
};

export default BottomNavBar;

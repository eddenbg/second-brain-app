
import React from 'react';
import { MicIcon, BookOpenIcon, BrainCircuitIcon, CameraIcon, GlobeIcon, FolderIcon } from './Icons';

type View = 'physical' | 'college' | 'webclips' | 'askai' | 'voicenotes' | 'files';

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
        className={`relative flex flex-col items-center justify-center w-full py-2 transition-all duration-300 
            ${isActive 
                ? 'text-blue-400' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
    >
        <div className={`transition-transform duration-200 ${isActive ? 'scale-110 -translate-y-1' : 'scale-100'}`}>
            {React.cloneElement(icon as React.ReactElement, { 
                className: `w-7 h-7 sm:w-8 sm:h-8` 
            })}
        </div>
        
        <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-widest mt-1
            ${isActive ? 'text-blue-400' : 'text-gray-500'}`}>
            {label}
        </span>

        {isActive && (
            <div className="absolute -top-0.5 left-1/4 right-1/4 h-1 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.8)]"></div>
        )}
    </button>
);


const BottomNavBar: React.FC<BottomNavBarProps> = ({ view, setView }) => {
  return (
    <nav 
        className="w-full bg-gray-900 border-t border-gray-800 grid grid-cols-6 px-1 pb-1 pt-1"
        aria-label="Main Navigation"
    >
        <NavButton
            label="College"
            icon={<BookOpenIcon />}
            isActive={view === 'college'}
            onClick={() => setView('college')}
        />
        <NavButton
            label="Items"
            icon={<CameraIcon />}
            isActive={view === 'physical'}
            onClick={() => setView('physical')}
        />
        <NavButton
            label="Files"
            icon={<FolderIcon />}
            isActive={view === 'files'}
            onClick={() => setView('files')}
        />
        <NavButton
            label="Ask AI"
            icon={<BrainCircuitIcon />}
            isActive={view === 'askai'}
            onClick={() => setView('askai')}
        />
        <NavButton
            label="Clips"
            icon={<GlobeIcon />}
            isActive={view === 'webclips'}
            onClick={() => setView('webclips')}
        />
        <NavButton
            label="Personal"
            icon={<MicIcon />}
            isActive={view === 'voicenotes'}
            onClick={() => setView('voicenotes')}
        />
    </nav>
  );
};

export default BottomNavBar;

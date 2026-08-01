import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
}

const OfflineBanner: React.FC<OfflineBannerProps> = ({ isOnline }) => {
  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-red-900 text-white px-4 py-3 flex items-center justify-center gap-3 border-b-2 border-red-700">
      <WifiOff className="w-5 h-5 flex-shrink-0" strokeWidth={2.5} />
      <div className="flex-grow text-center">
        <p className="font-black uppercase text-sm tracking-widest">
          No Internet Connection
        </p>
        <p className="text-xs opacity-90 mt-1">
          Some features may not work offline
        </p>
      </div>
    </div>
  );
};

export default OfflineBanner;

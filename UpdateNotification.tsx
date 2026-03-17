import React from 'react';

const MobilePreview: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    // On desktop (sm and up), this div centers the frame with a darker background.
    // On mobile, it's a simple container that gets covered by the inner div.
    <div className="w-full min-h-screen bg-gray-800 sm:flex sm:items-center sm:justify-center sm:p-4 md:p-8">
      {/* 
        This div is the main container for the app.
        - On mobile (default): It fills the entire screen.
        - On larger screens (sm+): It becomes a centered frame that scales up
          in width for a better tablet and desktop experience.
      */}
      <div 
        className="w-full h-full min-h-screen bg-gray-900 
                   sm:max-w-md sm:h-[90vh] sm:max-h-[1200px] sm:min-h-0 
                   md:max-w-xl 
                   lg:max-w-3xl
                   xl:max-w-5xl
                   sm:rounded-3xl sm:shadow-2xl sm:overflow-hidden sm:border-4 sm:border-gray-700 sm:relative"
      >
        {/* The actual app content */}
        {children}
      </div>
    </div>
  );
};

export default MobilePreview;
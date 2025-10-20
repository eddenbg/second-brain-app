import React from 'react';

const MobilePreview: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    // The outer container that centers the preview on the page
    <div className="w-full min-h-screen flex items-center justify-center bg-gray-800 p-4 sm:p-8">
      {/* The phone-like frame */}
      <div 
        className="w-full max-w-sm h-[85vh] max-h-[896px] bg-gray-900 rounded-3xl shadow-2xl overflow-hidden border-4 border-gray-700 relative"
      >
        {/* The actual app content, with scrolling enabled */}
        <div className="w-full h-full overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default MobilePreview;

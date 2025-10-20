import React, { useState, useCallback } from 'react';
import { useMemories } from './hooks/useRecordings';
import Recorder from './components/Recorder';
import MemoryList from './components/RecordingList';
import QASession from './components/QASession';
import AddWebMemoryModal from './components/AddWebMemoryModal';
import AddPhysicalItemModal from './components/AddPhysicalItemModal';
import { BrainCircuitIcon, LinkIcon, CameraIcon } from './components/Icons';
import type { AnyMemory } from './types';

function App() {
  const { memories, addMemory, deleteMemory, updateMemoryTitle } = useMemories();
  const [view, setView] = useState<'main' | 'qa'>('main');
  const [isAddWebModalOpen, setIsAddWebModalOpen] = useState(false);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);

  const handleSaveMemory = useCallback((newMemory: AnyMemory) => {
    addMemory(newMemory);
  }, [addMemory]);

  const header = (
    <header className="w-full max-w-4xl mx-auto p-4 sm:p-6 bg-gray-900 sticky top-0 z-10 border-b border-gray-700">
      <div className="flex justify-between items-center gap-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          Personal Memory AI
        </h1>
        <div className="flex items-center gap-2">
          {view === 'main' ? (
             <button
                onClick={() => setView('qa')}
                disabled={memories.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
                aria-label="Ask AI"
              >
                <BrainCircuitIcon className="w-6 h-6" />
                <span className="hidden sm:inline">Ask AI</span>
              </button>
          ) : (
            <button
              onClick={() => setView('main')}
              className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Back to Memories
            </button>
          )}
        </div>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col items-center">
      {isAddWebModalOpen && <AddWebMemoryModal onClose={() => setIsAddWebModalOpen(false)} onSave={handleSaveMemory} />}
      {isAddItemModalOpen && <AddPhysicalItemModal onClose={() => setIsAddItemModalOpen(false)} onSave={handleSaveMemory} />}
      {header}
      <main className="w-full max-w-4xl mx-auto p-4 sm:p-6 flex-grow">
        {view === 'main' ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => setIsAddWebModalOpen(true)} className="flex flex-col items-center justify-center gap-2 p-6 bg-gray-800 rounded-lg hover:bg-gray-700 border-2 border-dashed border-gray-600 hover:border-blue-500 transition-colors">
                    <LinkIcon className="w-10 h-10 text-gray-400"/>
                    <span className="text-xl font-semibold text-white">Add Web Memory</span>
                </button>
                 <button onClick={() => setIsAddItemModalOpen(true)} className="flex flex-col items-center justify-center gap-2 p-6 bg-gray-800 rounded-lg hover:bg-gray-700 border-2 border-dashed border-gray-600 hover:border-purple-500 transition-colors">
                    <CameraIcon className="w-10 h-10 text-gray-400"/>
                    <span className="text-xl font-semibold text-white">Add Physical Item</span>
                </button>
            </div>
            <Recorder onSave={handleSaveMemory} />
            <MemoryList 
              memories={memories} 
              onDelete={deleteMemory} 
              onUpdateTitle={updateMemoryTitle}
              onStartQASession={() => setView('qa')}
            />
          </div>
        ) : (
          <QASession memories={memories} />
        )}
      </main>
      <footer className="w-full text-center p-4 text-gray-500 text-sm">
          <p>Your intelligent second brain.</p>
      </footer>
    </div>
  );
}

export default App;

import React, { useState, useCallback } from 'react';
import { useMemories } from './hooks/useRecordings';
import MemoryList from './components/RecordingList';
import QASession from './components/QASession';
import AddView from './components/AddView';
import BottomNavBar from './components/BottomNavBar';
import type { AnyMemory } from './types';

function App() {
  const { memories, addMemory, deleteMemory, updateMemoryTitle } = useMemories();
  const [view, setView] = useState<'memories' | 'add' | 'qa'>('memories');

  const handleSaveMemory = useCallback((newMemory: AnyMemory) => {
    addMemory(newMemory);
    setView('memories');
  }, [addMemory]);

  const header = (
    <header className="w-full max-w-4xl mx-auto p-4 sm:p-6 bg-gray-900 sticky top-0 z-10 border-b border-gray-700">
      <div className="flex justify-between items-center gap-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">
          My Second Brain
        </h1>
      </div>
    </header>
  );

  return (
    <div className="h-full w-full text-gray-100 font-sans flex flex-col relative">
      {header}
      <main className="w-full max-w-4xl mx-auto p-4 sm:p-6 flex-grow pb-24">
        {view === 'memories' && (
          <MemoryList 
            memories={memories} 
            onDelete={deleteMemory} 
            onUpdateTitle={updateMemoryTitle}
          />
        )}
        {view === 'add' && (
          <AddView onSave={handleSaveMemory} />
        )}
        {view === 'qa' && (
          <QASession memories={memories} />
        )}
      </main>
      <BottomNavBar view={view} setView={setView} />
      <footer className="w-full text-center p-4 text-gray-500 text-sm absolute bottom-0">
          <p>Your intelligent second brain.</p>
      </footer>
    </div>
  );
}

export default App;
import React, { useState, useCallback, useMemo } from 'react';
import { useMemories } from './hooks/useRecordings';
import VoiceNotesView from './components/RecordingList';
import QASession from './components/QASession';
import CollegeView from './components/AddView';
import PhysicalItemsView from './components/VisionView';
import BottomNavBar from './components/BottomNavBar';
import type { AnyMemory } from './types';

function App() {
  const { memories, addMemory, deleteMemory, updateMemoryTitle } = useMemories();
  const [view, setView] = useState<'physical' | 'college' | 'askai' | 'voicenotes'>('voicenotes');

  const handleSaveMemory = useCallback((newMemory: Omit<AnyMemory, 'id' | 'date'>) => {
    const memoryWithMetadata: AnyMemory = {
      ...newMemory,
      id: Date.now().toString(),
      date: new Date().toISOString(),
    } as AnyMemory;
    addMemory(memoryWithMetadata);
  }, [addMemory]);

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const personalVoiceMemos = useMemo(() => memories.filter(m => m.category === 'personal' && m.type === 'voice'), [memories]);
  const physicalItems = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);

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
      <main className="w-full max-w-4xl mx-auto p-4 sm:p-6 flex-grow pb-28 overflow-y-auto">
        {view === 'voicenotes' && (
          <VoiceNotesView 
            memories={personalVoiceMemos} 
            onDelete={deleteMemory} 
            onUpdateTitle={updateMemoryTitle}
            onSave={handleSaveMemory}
          />
        )}
        {view === 'college' && (
           <CollegeView
            lectures={collegeMemories}
            onSave={handleSaveMemory}
            onDelete={deleteMemory}
            onUpdateTitle={updateMemoryTitle}
          />
        )}
        {view === 'askai' && (
          <QASession memories={memories} />
        )}
        {view === 'physical' && (
          <PhysicalItemsView 
            memories={physicalItems}
            onDelete={deleteMemory}
            onUpdateTitle={updateMemoryTitle}
            onSave={handleSaveMemory}
          />
        )}
      </main>
      <BottomNavBar view={view} setView={setView} />
    </div>
  );
}

export default App;
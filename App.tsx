import React, { useState, useMemo } from 'react';
import BottomNavBar from './components/BottomNavBar';
import CollegeView from './components/AddView';
import QASession from './components/QASession';
import VisionView from './components/VisionView';
import WebClipsView from './components/WebClipsView';
import RecordingList from './components/RecordingList';
import UpdateNotification from './components/UpdateNotification';
import { useRecordings } from './hooks/useRecordings';
import { useServiceWorker } from './hooks/useServiceWorker';
import type { AnyMemory, WebMemory } from './types';

type View = 'physical' | 'college' | 'webclips' | 'askai' | 'voicenotes';

const viewTitles: Record<View, string> = {
    physical: 'Physical Items',
    college: 'College',
    webclips: 'Web Clips',
    askai: 'Ask AI',
    voicenotes: 'Voice Notes',
};

function App() {
  const [view, setView] = useState<View>('voicenotes');
  const { memories, addMemory, deleteMemory, updateMemory, syncSharedClips, pendingClipsCount } = useRecordings();
  const { updateAvailable, updateServiceWorker } = useServiceWorker();

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const physicalMemories = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);
  const webClipMemories = useMemo(() => memories.filter(m => m.type === 'web'), [memories]);

  const handleUpdateTitle = (id: string, newTitle: string) => {
    updateMemory(id, { title: newTitle });
  };
  
  const handleUpdateWebClip = (id: string, updates: Partial<WebMemory>) => {
    updateMemory(id, updates);
  }

  const renderView = () => {
    switch (view) {
      case 'physical':
        return <VisionView memories={physicalMemories} onDelete={deleteMemory} onUpdateTitle={handleUpdateTitle} onSave={addMemory} />;
      case 'college':
        return <CollegeView lectures={collegeMemories} onDelete={deleteMemory} onUpdateTitle={handleUpdateTitle} onSave={addMemory} />;
      case 'webclips':
        return <WebClipsView memories={webClipMemories} onDelete={deleteMemory} onUpdate={handleUpdateWebClip} onSave={addMemory} syncSharedClips={syncSharedClips} pendingClipsCount={pendingClipsCount}/>;
      case 'askai':
        return <QASession memories={memories} />;
      case 'voicenotes':
        return <RecordingList onSave={addMemory} />;
      default:
        return <QASession memories={memories} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      <header className="flex-shrink-0 p-4 text-center bg-gray-800 border-b border-gray-700">
        <h1 className="text-2xl font-bold tracking-wider">{viewTitles[view]}</h1>
      </header>
      <main className="flex-grow p-4 sm:p-6 overflow-y-auto">
        {renderView()}
      </main>
      <BottomNavBar view={view} setView={setView} />
      {updateAvailable && <UpdateNotification onUpdate={updateServiceWorker} />}
    </div>
  );
}

export default App;
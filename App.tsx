
import React, { useState, useMemo } from 'react';
import BottomNavBar from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import QASession from './components/QASession';
import VisionView from './components/VisionView';
import WebClipsView from './components/WebClipsView';
import VoiceNotesView from './components/RecordingList';
import UpdateNotification from './components/UpdateNotification';
import SyncSetup from './components/SyncSetup';
import SettingsModal from './components/SettingsModal';
import AddToHomeScreenPrompt from './components/AddToHomeScreenPrompt';
import { useRecordings } from './hooks/useRecordings';
import { useServiceWorker } from './hooks/useServiceWorker';
import type { AnyMemory, WebMemory } from './types';
import { SettingsIcon, RefreshCwIcon, Loader2Icon } from './components/Icons';

type View = 'physical' | 'college' | 'webclips' | 'askai' | 'voicenotes';

const viewTitles: Record<View, string> = {
    physical: 'Physical Items',
    college: 'College',
    webclips: 'Web Clips',
    askai: 'Ask AI',
    voicenotes: 'Voice Notes',
};

function App() {
  const [view, setView] = useState<View>('college');
  const [showSettings, setShowSettings] = useState(false);

  const { 
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask, 
    syncSharedClips, pendingClipsCount, courses, addCourse, isSyncing, user, loading 
  } = useRecordings();
  const { updateAvailable, updateServiceWorker } = useServiceWorker();

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const physicalMemories = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);
  const webClipMemories = useMemo(() => memories.filter(m => m.type === 'web'), [memories]);
  const voiceNoteMemories = useMemo(() => memories.filter(m => m.type === 'voice' && m.category === 'personal'), [memories]);

  const handleUpdateMemory = (id: string, updates: Partial<AnyMemory>) => {
    updateMemory(id, updates);
  };
  
  const handleUpdateWebClip = (id: string, updates: Partial<WebMemory>) => {
    updateMemory(id, updates);
  }

  if (loading) {
      return (
          <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
              <Loader2Icon className="w-12 h-12 animate-spin text-blue-500" />
          </div>
      )
  }

  if (!user) {
    return <SyncSetup onSyncIdSet={() => {}} />;
  }

  const renderView = () => {
    switch (view) {
      case 'physical':
        return <VisionView memories={physicalMemories} onDelete={deleteMemory} onUpdate={handleUpdateMemory} onSave={addMemory} bulkDelete={bulkDeleteMemories} />;
      case 'college':
        return <CollegeView 
          lectures={collegeMemories} 
          onDelete={deleteMemory} 
          onUpdate={handleUpdateMemory} 
          onSave={addMemory} 
          bulkDelete={bulkDeleteMemories} 
          courses={courses} 
          addCourse={addCourse} 
          tasks={tasks}
          addTask={addTask}
          updateTask={updateTask}
          deleteTask={deleteTask}
        />;
      case 'webclips':
        return <WebClipsView memories={webClipMemories} onDelete={deleteMemory} onUpdate={handleUpdateWebClip} onSave={addMemory} syncSharedClips={syncSharedClips} pendingClipsCount={pendingClipsCount} bulkDelete={bulkDeleteMemories}/>;
      case 'askai':
        return <QASession memories={memories} />;
      case 'voicenotes':
        return <VoiceNotesView memories={voiceNoteMemories} onSave={addMemory} onDelete={deleteMemory} onUpdate={handleUpdateMemory} bulkDelete={bulkDeleteMemories} />;
      default:
        return <QASession memories={memories} />;
    }
  };

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full bg-gray-900 text-white">
      {showSettings && (
          <SettingsModal 
            syncId={user.email || 'User'} 
            onClose={() => setShowSettings(false)} 
            onReset={() => {}} 
            data={{ memories, courses, tasks }} 
            onImport={() => {}} 
          />
      )}
      <header className="p-4 text-center bg-gray-800 border-b border-gray-700 flex justify-between items-center">
        <div className="w-10">
          {isSyncing && <RefreshCwIcon className="w-6 h-6 text-gray-400 animate-spin" />}
        </div>
        <h1 className="text-2xl font-bold tracking-wider">{viewTitles[view]}</h1>
        <button onClick={() => setShowSettings(true)} className="p-2 rounded-full hover:bg-gray-700" aria-label="Settings">
            <SettingsIcon className="w-6 h-6 text-gray-400" />
        </button>
      </header>
      <main className="p-4 sm:p-6 overflow-y-auto">
        {renderView()}
      </main>
      <BottomNavBar view={view} setView={setView} />
      {updateAvailable && <UpdateNotification onUpdate={updateServiceWorker} />}
      <AddToHomeScreenPrompt />
    </div>
  );
}

export default App;

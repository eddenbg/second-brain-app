
import React, { useState, useMemo, useEffect } from 'react';
import BottomNavBar from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import QASession from './components/QASession';
import VisionView from './components/VisionView';
import WebClipsView from './components/WebClipsView';
import PersonalView from './components/PersonalView';
import UpdateNotification from './components/UpdateNotification';
import SyncSetup from './components/SyncSetup';
import SettingsModal from './components/SettingsModal';
import AddToHomeScreenPrompt from './components/AddToHomeScreenPrompt';
import FirebaseRulesHelp from './components/FirebaseRulesHelp';
import AddWebMemoryModal from './components/AddWebMemoryModal';
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
    voicenotes: 'Personal',
};

function App() {
  const [view, setView] = useState<View>('college');
  const [showSettings, setShowSettings] = useState(false);
  const [showRulesHelp, setShowRulesHelp] = useState(false);
  
  // State for the auto-open share modal
  const [shareData, setShareData] = useState<{ url: string; title: string } | null>(null);

  const { 
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask, 
    syncSharedClips, pendingClipsCount, courses, addCourse, isSyncing, user, loading, syncError 
  } = useRecordings();
  const { updateAvailable, updateServiceWorker } = useServiceWorker();

  // Detect Share Target Data
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedTitle = urlParams.get('title') || urlParams.get('text') || '';
    const sharedUrl = urlParams.get('url') || '';

    if (sharedUrl || sharedTitle) {
      setShareData({
        url: sharedUrl,
        title: sharedTitle
      });
      setView('webclips');
      // Clean up the URL so it doesn't re-trigger on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const physicalMemories = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);
  const webClipMemories = useMemo(() => memories.filter(m => m.type === 'web'), [memories]);
  const personalMemories = useMemo(() => memories.filter(m => m.category === 'personal' && (m.type === 'voice' || m.type === 'document')), [memories]);

  useEffect(() => {
    if (syncError && syncError.includes('Permission Denied')) {
        setShowRulesHelp(true);
    }
  }, [syncError]);

  const handleUpdateMemory = (id: string, updates: Partial<AnyMemory>) => {
    updateMemory(id, updates);
  };
  
  const handleUpdateWebClip = (id: string, updates: Partial<WebMemory>) => {
    updateMemory(id, updates);
  }

  const handleSaveMemory = async (memory: Omit<AnyMemory, 'id' | 'date'>) => {
      const newMemoryId = await addMemory(memory);
      if (newMemoryId && memory.type === 'voice') {
          const voiceMem = memory as any; 
          if (voiceMem.actionItems && Array.isArray(voiceMem.actionItems)) {
              for (const item of voiceMem.actionItems) {
                  await addTask({
                      title: item.text,
                      status: 'todo',
                      category: memory.category,
                      course: memory.course,
                      description: `Generated from voice note: "${memory.title}"`,
                      linkedMemoryIds: [newMemoryId]
                  });
              }
          }
      }
  };

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
        return <VisionView memories={physicalMemories} onDelete={deleteMemory} onUpdate={handleUpdateMemory} onSave={handleSaveMemory} bulkDelete={bulkDeleteMemories} />;
      case 'college':
        return <CollegeView 
          lectures={collegeMemories} 
          onDelete={deleteMemory} 
          onUpdate={handleUpdateMemory} 
          onSave={handleSaveMemory} 
          bulkDelete={bulkDeleteMemories} 
          courses={courses} 
          addCourse={addCourse} 
          tasks={tasks}
          addTask={addTask}
          updateTask={updateTask}
          deleteTask={deleteTask}
        />;
      case 'webclips':
        return <WebClipsView memories={webClipMemories} onDelete={deleteMemory} onUpdate={handleUpdateWebClip} onSave={handleSaveMemory} syncSharedClips={syncSharedClips} pendingClipsCount={pendingClipsCount} bulkDelete={bulkDeleteMemories}/>;
      case 'askai':
        return <QASession memories={memories} tasks={tasks} />;
      case 'voicenotes':
        return <PersonalView 
          memories={personalMemories} 
          tasks={tasks}
          onSaveMemory={handleSaveMemory} 
          onDeleteMemory={deleteMemory} 
          onUpdateMemory={handleUpdateMemory} 
          bulkDeleteMemories={bulkDeleteMemories} 
          onAddTask={addTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
        />;
      default:
        return <QASession memories={memories} tasks={tasks} />;
    }
  };

  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full bg-gray-900 text-white relative">
      {showRulesHelp && <FirebaseRulesHelp onClose={() => setShowRulesHelp(false)} />}
      
      {/* Auto-open Web Clip modal if share data exists */}
      {shareData && (
          <AddWebMemoryModal 
            onClose={() => setShareData(null)} 
            onSave={(mem) => {
                handleSaveMemory({ ...mem, category: 'personal' });
                setShareData(null);
            }}
            initialUrl={shareData.url}
            initialTitle={shareData.title}
          />
      )}

      {showSettings && (
          <SettingsModal 
            syncId={user.email || 'User'} 
            onClose={() => setShowSettings(false)} 
            onReset={() => {}} 
            data={{ memories, courses, tasks }} 
            onImport={() => {}} 
          />
      )}
      <header className="text-center bg-gray-800 border-b border-gray-700">
        <div className="flex justify-between items-center p-4">
            <div className="w-10">
            {isSyncing && <RefreshCwIcon className="w-6 h-6 text-gray-400 animate-spin" />}
            </div>
            <h1 className="text-2xl font-bold tracking-wider">{viewTitles[view]}</h1>
            <button onClick={() => setShowSettings(true)} className="p-2 rounded-full hover:bg-gray-700" aria-label="Settings">
                <SettingsIcon className="w-6 h-6 text-gray-400" />
            </button>
        </div>
        {syncError && (
            <div 
                className="bg-red-600 text-white text-xs p-2 text-center animate-pulse cursor-pointer hover:bg-red-700"
                onClick={() => setShowRulesHelp(true)}
            >
                {syncError} (Tap for Help)
            </div>
        )}
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


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
import { SettingsIcon, RefreshCwIcon, Loader2Icon, UploadIcon, CheckIcon } from './components/Icons';

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
  
  const [shareData, setShareData] = useState<{ url: string; title: string } | null>(null);

  const { 
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask, 
    courses, addCourse, user, loading,
    isSyncing, hasUnsavedChanges, syncError, performSync, fetchFromCloud
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
        return <WebClipsView memories={webClipMemories} onDelete={deleteMemory} onUpdate={handleUpdateWebClip} onSave={handleSaveMemory} syncSharedClips={async()=>0} pendingClipsCount={0} bulkDelete={bulkDeleteMemories}/>;
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
            hasUnsavedChanges={hasUnsavedChanges}
            onSync={performSync}
            onFetch={fetchFromCloud}
          />
      )}
      
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="flex justify-between items-center p-3 sm:p-4">
            <div className="flex-1">
                {hasUnsavedChanges && (
                    <button 
                        onClick={performSync}
                        disabled={isSyncing}
                        className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-lg animate-pulse focus:ring-4 focus:ring-green-400"
                        aria-label="You have unsaved changes. Tap to sync to cloud."
                    >
                        {isSyncing ? <Loader2Icon className="w-5 h-5 animate-spin" /> : <UploadIcon className="w-5 h-5" />}
                        <span className="hidden sm:inline">Sync Cloud</span>
                    </button>
                )}
                {!hasUnsavedChanges && !isSyncing && (
                    <div className="flex items-center gap-1 text-gray-500 text-xs px-2" role="status">
                        <CheckIcon className="w-4 h-4"/> <span className="hidden sm:inline">Cloud Synced</span>
                    </div>
                )}
                {isSyncing && (
                    <div className="flex items-center gap-2 text-blue-400 text-xs px-2 animate-pulse" aria-live="polite">
                        <Loader2Icon className="w-4 h-4 animate-spin"/> Syncing...
                    </div>
                )}
            </div>
            
            <h1 className="flex-grow text-center text-xl sm:text-2xl font-bold tracking-wider">{viewTitles[view]}</h1>
            
            <div className="flex-1 flex justify-end">
                <button onClick={() => setShowSettings(true)} className="p-2 rounded-full hover:bg-gray-700 focus:ring-4 focus:ring-blue-400" aria-label="Open Settings">
                    <SettingsIcon className="w-7 h-7 text-gray-400" />
                </button>
            </div>
        </div>
        
        {syncError && (
            <div 
                className="bg-red-600 text-white text-xs p-2 text-center animate-pulse cursor-pointer"
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

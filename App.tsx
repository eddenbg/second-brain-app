import React, { useState, useMemo, useEffect, useCallback } from 'react';
import BottomNavBar from './components/BottomNavBar';
import Sidebar from './components/Sidebar';
import CollegeView from './components/CollegeView';
import QASession from './components/QASession';
import VisionView from './components/VisionView';
import WebClipsView from './components/WebClipsView';
import PersonalView from './components/PersonalView';
import ScheduleView from './components/ScheduleView';
import FilesView from './components/FilesView';
import UpdateNotification from './components/UpdateNotification';
import SyncSetup from './components/SyncSetup';
import SettingsModal from './components/SettingsModal';
import AddWebMemoryModal from './components/AddWebMemoryModal';
import TopInstallBanner from './components/TopInstallBanner';
import { useRecordings } from './hooks/useRecordings';
import { useServiceWorker } from './hooks/useServiceWorker';
import { fetchMoodleEvents, fetchMoodleCourses, fetchCourseContents } from './services/moodleService';
import { fetchGoogleCalendarEvents } from './services/googleService';
import { processSharedUrl } from './services/geminiService';
import type { AnyMemory, WebMemory, CalendarEvent, Task, FileMemory } from './types';
import { SettingsIcon, Loader2Icon, BrainCircuitIcon, CalendarIcon } from './components/Icons';

export type View = 'physical' | 'college' | 'webclips' | 'askai' | 'voicenotes' | 'files';

const viewTitles: Record<View, string> = {
    physical: 'Items',
    college: 'College',
    webclips: 'Web Clips',
    askai: 'Ask AI',
    voicenotes: 'Personal',
    files: 'Files',
};

function App() {
  const [view, setView] = useState<View>('college');
  const [showSettings, setShowSettings] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [moodleEvents, setMoodleEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [sharedContent, setSharedContent] = useState<{ url: string; title: string } | null>(null);
  const [isProcessingShare, setIsProcessingShare] = useState(false);
  const [isSyncingMoodle, setIsSyncingMoodle] = useState(false);

  const { 
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask, 
    courses, addCourse, user, loading,
    moodleToken, saveMoodleToken,
    isGoogleConnected, connectGoogleCalendar, disconnectGoogleCalendar
  } = useRecordings();
  
  const { updateAvailable, updateServiceWorker } = useServiceWorker();

  // --- MOODLE BACKGROUND TOKEN CAPTURE ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let moodleTokenParam = params.get('token') || params.get('moodle_token');
    
    if (moodleTokenParam && moodleTokenParam.startsWith('secondbrainapp:')) {
      try {
        const urlString = moodleTokenParam.replace('secondbrainapp://', 'http://dummy-host/');
        const url = new URL(urlString);
        const token = url.searchParams.get('token');
        const error = url.searchParams.get('error');
        if (error) {
          alert(`Moodle connection failed. The server responded with: "${error}". Please try connecting again.`);
          moodleTokenParam = null;
        } else if (token) {
          moodleTokenParam = token;
        } else {
          moodleTokenParam = null;
        }
      } catch (e) {
        console.error("Error parsing Moodle redirect URL:", e);
        moodleTokenParam = null;
      }
    }
    
    if (moodleTokenParam && moodleTokenParam.length === 32) {
      saveMoodleToken(moodleTokenParam);
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
      setShowSettings(true);
    }
  }, [saveMoodleToken]);

  const allCalendarEvents = useMemo(() => [...calendarEvents, ...moodleEvents, ...googleEvents], [calendarEvents, moodleEvents, googleEvents]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (showSettings) setShowSettings(false);
      else if (showSchedule) setShowSchedule(false);
      else if (sharedContent) setSharedContent(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showSettings, showSchedule, sharedContent]);

  useEffect(() => {
    if (!moodleToken || isSyncingMoodle) return;
    const syncMoodle = async () => {
        setIsSyncingMoodle(true);
        try {
            const mCourses = await fetchMoodleCourses(moodleToken);
            for (const mc of mCourses) {
                if (!courses.includes(mc.fullname)) addCourse(mc.fullname);
                const contents = await fetchCourseContents(moodleToken, mc.id);
                for (const item of contents) {
                    const exists = memories.some(m => m.type === 'file' && (m as FileMemory).moodleId === item.id.toString());
                    if (!exists && item.type === 'file') {
                        await addMemory({
                            type: 'file',
                            title: item.name,
                            fileUrl: item.fileurl || '',
                            mimeType: item.mimetype || 'application/pdf',
                            sourceType: 'moodle',
                            moodleId: item.id.toString(),
                            category: 'college',
                            course: mc.fullname
                        } as Omit<FileMemory, 'id' | 'date'>);
                    }
                }
            }
        } catch (e) { console.error("Moodle auto-sync failed", e); }
        finally { setIsSyncingMoodle(false); }
    };
    syncMoodle();
  }, [moodleToken, addCourse, memories.length]);

  const toggleSettings = (open: boolean) => {
    if (open) {
      window.history.pushState({ modal: 'settings' }, '');
      setShowSettings(true);
    } else {
      if (window.history.state?.modal === 'settings') window.history.back();
      setShowSettings(false);
    }
  };

  const toggleSchedule = (open: boolean) => {
    if (open) {
      window.history.pushState({ modal: 'schedule' }, '');
      setShowSchedule(true);
    } else {
      if (window.history.state?.modal === 'schedule') window.history.back();
      setShowSchedule(false);
    }
  };

  const handleProcessShare = useCallback(async (url: string, title: string, text: string) => {
    setIsProcessingShare(true);
    try {
      const analysis = await processSharedUrl(url, title, text);
      await addMemory({
        type: 'web',
        url: url,
        title: analysis.title,
        content: analysis.summary,
        contentType: analysis.type,
        category: 'personal',
        tags: analysis.takeaways
      } as Omit<WebMemory, 'id' | 'date'>);
      setView('webclips');
    } catch (error) {
      setSharedContent({ url, title: title || text || 'Shared Link' });
      window.history.pushState({ modal: 'share' }, '');
    } finally {
      setIsProcessingShare(false);
    }
  }, [addMemory]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSharedParam = params.has('shared') || params.has('url') || params.has('text') || params.has('title');
    if (hasSharedParam) {
      const title = params.get('title') || '';
      const text = params.get('text') || '';
      const url = params.get('url') || '';
      if (url || text.includes('http')) {
        handleProcessShare(url || text.match(/(https?:\/\/[^\s]+)/)?.[0] || '', title, text);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [handleProcessShare]);

  useEffect(() => {
    const getMoodleEvents = async () => {
      if (moodleToken) {
        const events = await fetchMoodleEvents(moodleToken);
        setMoodleEvents(events);
      } else {
        setMoodleEvents([]);
      }
    };
    getMoodleEvents();
  }, [moodleToken]);
  
  useEffect(() => {
    const getGoogleEvents = async () => {
        if (isGoogleConnected) {
            const token = localStorage.getItem('google_access_token');
            if (token) {
                try {
                    const events = await fetchGoogleCalendarEvents(token);
                    setGoogleEvents(events);
                } catch (error) {
                    console.error("Failed to fetch Google Calendar events", error);
                    localStorage.removeItem('google_access_token');
                }
            }
        } else {
            setGoogleEvents([]);
        }
    };
    getGoogleEvents();
  }, [isGoogleConnected]);


  const addCalendarEvent = (event: Omit<CalendarEvent, 'id'>) => {
    const newEvent = { ...event, id: Date.now().toString(), source: 'manual' as const };
    setCalendarEvents(prev => [...prev, newEvent].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
  };

  const deleteCalendarEvent = (eventId: string) => {
      if (window.confirm('Delete event?')) {
          setCalendarEvents(prev => prev.filter(e => e.id !== eventId));
      }
  };

  const handleSaveSharedClip = (memory: Omit<WebMemory, 'id' | 'date' | 'category'>) => {
    addMemory({ ...memory, category: 'personal' });
    setSharedContent(null);
    if (window.history.state?.modal === 'share') window.history.back();
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-gray-900"><Loader2Icon className="w-24 h-24 animate-spin text-blue-500" /></div>;
  if (!user) return <SyncSetup onSyncIdSet={() => {}} />;
  
  const renderView = () => {
    switch (view) {
      case 'physical': return <VisionView memories={memories.filter(m => m.type === 'item' || m.type === 'video')} onDelete={deleteMemory} onUpdate={updateMemory} onSave={addMemory} bulkDelete={bulkDeleteMemories} />;
      case 'college': return <CollegeView lectures={memories.filter(m => m.category === 'college')} onDelete={deleteMemory} onUpdate={updateMemory} onSave={addMemory} bulkDelete={bulkDeleteMemories} courses={courses} addCourse={addCourse} tasks={tasks} addTask={addTask} updateTask={updateTask} deleteTask={deleteTask} moodleToken={moodleToken} />;
      case 'webclips': return <WebClipsView memories={memories.filter(m => m.type === 'web')} onDelete={deleteMemory} onUpdate={updateMemory} onSave={addMemory} syncSharedClips={async()=>0} pendingClipsCount={0} bulkDelete={bulkDeleteMemories}/>;
      case 'askai': return <QASession memories={memories} tasks={tasks} calendarEvents={allCalendarEvents} onAddCalendarEvent={addCalendarEvent} />;
      case 'voicenotes': return <PersonalView memories={memories.filter(m => m.category === 'personal')} tasks={tasks} onSaveMemory={addMemory} onDeleteMemory={deleteMemory} onUpdateMemory={updateMemory} bulkDeleteMemories={bulkDeleteMemories} onAddTask={addTask} onUpdateTask={updateTask} onDeleteTask={deleteTask} />;
      case 'files': return <FilesView memories={memories} onSave={addMemory} onDelete={deleteMemory} onUpdate={updateMemory} />;
      default: return <QASession memories={memories} tasks={tasks} />;
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0b0f1a] text-white flex flex-col md:flex-row overflow-hidden overscroll-none">
      {isProcessingShare && (
        <div className="fixed inset-0 z-[300] bg-black/95 flex flex-col items-center justify-center p-10 text-center animate-fade-in" role="alert" aria-live="assertive">
          <div className="bg-blue-600/20 p-12 rounded-[4rem] border-4 border-blue-500 shadow-[0_0_80px_rgba(37,99,235,0.4)] flex flex-col items-center gap-10">
            <BrainCircuitIcon className="w-32 h-32 text-blue-400 animate-pulse" />
            <div className="space-y-6">
              <h2 className="text-5xl font-black uppercase tracking-tighter text-white">AI Processing</h2>
              <p className="text-2xl font-bold text-blue-300">Summarizing your shared link for your Second Brain. Please wait...</p>
            </div>
            <Loader2Icon className="w-16 h-16 animate-spin text-white" />
          </div>
        </div>
      )}
      <TopInstallBanner />
      <div className="hidden md:block flex-shrink-0">
        <Sidebar view={view} setView={setView} onOpenSettings={() => toggleSettings(true)} onOpenSchedule={() => toggleSchedule(true)} />
      </div>
      <div className="flex-grow flex flex-col min-w-0 bg-[#111827] md:rounded-l-[2rem] md:my-3 md:mr-3 shadow-2xl border-l border-t border-b border-gray-800/50 relative overflow-hidden">
        {showSchedule && <ScheduleView events={allCalendarEvents} onClose={() => toggleSchedule(false)} onAddEvent={addCalendarEvent} onDeleteEvent={deleteCalendarEvent} />}
        {showSettings && <SettingsModal syncId={user.email || user.uid} onClose={() => toggleSettings(false)} onReset={() => {}} data={{ memories, courses, tasks }} onImport={() => {}} moodleToken={moodleToken} onSaveMoodleToken={saveMoodleToken} isGoogleConnected={isGoogleConnected} onConnectGoogle={connectGoogleCalendar} onDisconnectGoogle={disconnectGoogleCalendar} />}
        {sharedContent && <AddWebMemoryModal initialUrl={sharedContent.url} initialTitle={sharedContent.title} onClose={() => setSharedContent(null)} onSave={handleSaveSharedClip} />}
        <header className="flex-shrink-0 bg-gray-800 border-b-2 border-gray-700 shadow-md z-20 md:hidden" style={{ paddingTop: 'var(--sat)' }}>
          <div className="flex justify-between items-center px-4 py-3">
              <button onClick={() => toggleSchedule(true)} className="p-3 bg-gray-900 rounded-xl border-2 border-gray-700 text-blue-400 active:scale-90 transition-transform"><CalendarIcon className="w-8 h-8" /></button>
              <div className="flex items-center gap-3">
                  <BrainCircuitIcon className="w-8 h-8 text-blue-400" />
                  <h1 className="text-xl font-black uppercase tracking-tight">{viewTitles[view]}</h1>
              </div>
              <button onClick={() => toggleSettings(true)} className="p-3 rounded-xl bg-gray-900 border-2 border-gray-700 active:scale-90 transition-transform"><SettingsIcon className="w-8 h-8 text-gray-400" /></button>
          </div>
        </header>
        <main className="flex-grow min-h-0 relative z-10 flex flex-col">
          <div className="flex-grow overflow-y-auto p-4 sm:p-6 lg:p-10 scroll-smooth pb-10">
            <div className="max-w-7xl mx-auto h-full">{renderView()}</div>
          </div>
        </main>
        <footer className="flex-shrink-0 bg-gray-900 border-t-2 border-gray-800 shadow-[0_-4px_10px_rgba(0,0,0,0.3)] z-20 md:hidden" style={{ paddingBottom: 'max(var(--sab), 0.5rem)' }}>
          <BottomNavBar view={view} setView={setView} />
        </footer>
      </div>
      {updateAvailable && <UpdateNotification onUpdate={updateServiceWorker} />}
    </div>
  );
}

export default App;
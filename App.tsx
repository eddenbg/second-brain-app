import React, { useState, useMemo, useEffect, useCallback } from 'react';
import BottomNavBar from './components/BottomNavBar';
import type { View } from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import AskAIView from './components/AskAIView';
import PersonalView from './components/PersonalView';
import ScheduleView from './components/ScheduleView';
import FilesView from './components/FilesView';
import UpdateNotification from './components/UpdateNotification';
import SettingsModal from './components/SettingsModal';
import TopInstallBanner from './components/TopInstallBanner';
import { useRecordings } from './hooks/useRecordings';
import { useServiceWorker } from './hooks/useServiceWorker';
import { fetchMoodleEvents, fetchMoodleCourses, fetchCourseContents } from './services/moodleService';
import { processSharedUrl } from './services/geminiService';
import { getStoredToken, fetchGoogleCalendarEvents } from './services/googleCalendarService';
import type { AnyMemory, WebMemory, CalendarEvent, Task, FileMemory } from './types';
import { Settings, Loader2, Brain, Calendar } from 'lucide-react';

const viewTitles: Record<View, string> = {
    personal: 'Personal Hub',
    college:  'College Hub',
    askai:    'Ask AI',
    files:    'Files Vault',
};

function App() {
  const [view, setView] = useState<View>('personal');
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
  } = useRecordings();

  const { updateAvailable, updateServiceWorker } = useServiceWorker();

  const allCalendarEvents = useMemo(
    () => [...calendarEvents, ...moodleEvents, ...googleEvents],
    [calendarEvents, moodleEvents, googleEvents]
  );

  const loadGoogleEvents = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    try {
        const events = await fetchGoogleCalendarEvents(token);
        setGoogleEvents(events);
    } catch (e) {
        console.error('Google Calendar fetch failed', e);
    }
  }, []);

  // Load Google events on mount if already connected
  useEffect(() => { loadGoogleEvents(); }, [loadGoogleEvents]);

  // Request fullscreen on first interaction (maximises immersion in PWA mode)
  useEffect(() => {
    const requestFS = () => {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    requestFS();
    document.addEventListener('click', requestFS, { once: true });
    return () => document.removeEventListener('click', requestFS);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
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
      setView('personal');
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

  const addCalendarEvent = (event: Omit<CalendarEvent, 'id'>) => {
    const newEvent = { ...event, id: Date.now().toString(), source: 'manual' as const };
    setCalendarEvents(prev => [...prev, newEvent].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
  };

  const deleteCalendarEvent = (eventId: string) => {
      if (window.confirm('Delete event?')) {
          setCalendarEvents(prev => prev.filter(e => e.id !== eventId));
      }
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-[#001F3F]">
      <Loader2 className="w-24 h-24 animate-spin text-white" />
    </div>
  );

  const personalMemories = memories.filter(m => m.category === 'personal');
  const collegeMemories = memories.filter(m => m.category === 'college');

  const renderView = () => {
    switch (view) {
      case 'personal':
        return (
          <PersonalView
            memories={personalMemories}
            tasks={tasks}
            onSaveMemory={addMemory}
            onDeleteMemory={deleteMemory}
            onUpdateMemory={updateMemory}
            bulkDeleteMemories={bulkDeleteMemories}
            onAddTask={addTask}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
          />
        );
      case 'college':
        return (
          <CollegeView
            lectures={collegeMemories}
            onDelete={deleteMemory}
            onUpdate={updateMemory}
            onSave={addMemory}
            bulkDelete={bulkDeleteMemories}
            courses={courses}
            addCourse={addCourse}
            tasks={tasks}
            addTask={addTask}
            updateTask={updateTask}
            deleteTask={deleteTask}
            moodleToken={moodleToken}
          />
        );
      case 'askai':
        return <AskAIView memories={memories} />;
      case 'files':
        return (
          <FilesView
            memories={memories}
            onSave={addMemory}
            onDelete={deleteMemory}
            onUpdate={updateMemory}
          />
        );
      default:
        return <AskAIView memories={memories} />;
    }
  };

  return (
    <div className="fixed inset-0 bg-[#001F3F] text-white flex flex-col overflow-hidden overscroll-none">
      <TopInstallBanner />

      <header
        className="flex-shrink-0 bg-[#001F3F] border-b-2 sm:border-b-4 border-white z-20"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 6px)' }}
      >
        <div className="flex justify-between items-center px-3 sm:px-6 py-2 sm:py-3 landscape:py-1">
          <button
            onClick={() => toggleSchedule(true)}
            aria-label="Schedule"
            className="btn-icon flex items-center justify-center p-2 sm:p-3 bg-white/10 rounded-xl sm:rounded-2xl border-2 sm:border-3 border-white text-white active:scale-90 transition-transform"
          >
            <Calendar className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" strokeWidth={3} />
          </button>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Brain className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-white flex-shrink-0" strokeWidth={3} />
            <h1 className="text-base sm:text-xl md:text-2xl font-black uppercase tracking-tighter text-white truncate">{viewTitles[view]}</h1>
          </div>
          <button
            onClick={() => toggleSettings(true)}
            aria-label="Settings"
            className="btn-icon flex items-center justify-center p-2 sm:p-3 bg-white/10 rounded-xl sm:rounded-2xl border-2 sm:border-3 border-white text-white active:scale-90 transition-transform"
          >
            <Settings className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" strokeWidth={3} />
          </button>
        </div>
      </header>

      <main className="flex-grow min-h-0 relative z-10 flex flex-col">
        <div className="flex-grow overflow-y-auto p-4 scroll-smooth pb-36">
          <div className="max-w-4xl mx-auto h-full">{renderView()}</div>
        </div>
      </main>

      <footer
        className="flex-shrink-0 bg-[#001F3F] border-t-4 border-white z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <BottomNavBar view={view} setView={setView} />
      </footer>

      {showSchedule && (
        <ScheduleView
          events={allCalendarEvents}
          onClose={() => toggleSchedule(false)}
          onAddEvent={addCalendarEvent}
          onDeleteEvent={deleteCalendarEvent}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => toggleSettings(false)}
          moodleToken={moodleToken}
          onSaveMoodleToken={saveMoodleToken}
          onGoogleConnected={loadGoogleEvents}
        />
      )}
      {updateAvailable && <UpdateNotification onUpdate={updateServiceWorker} />}
    </div>
  );
}

export default App;

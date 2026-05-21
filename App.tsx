import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import BottomNavBar from './components/BottomNavBar';
import type { View } from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import AskAIView from './components/AskAIView';
import PersonalView from './components/PersonalView';
import ScheduleView from './components/ScheduleView';
import FilesView from './components/FilesView';
import SettingsModal from './components/SettingsModal';
import TopInstallBanner from './components/TopInstallBanner';
import { useRecordings } from './hooks/useRecordings';
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
  // Capture share params immediately on mount before auth loads (prevents race condition)
  const pendingShareRef = useRef<{ url: string; title: string; text: string } | null>(null);
  const [webCategories, setWebCategories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('web_categories') || '[]'); } catch { return []; }
  });
  const updateWebCategories = useCallback((cats: string[]) => {
    setWebCategories(cats);
    localStorage.setItem('web_categories', JSON.stringify(cats));
  }, []);

  const collegeBackHandlerRef = useRef<(() => boolean) | null>(null);

  const {
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask,
    courses, addCourse, deleteCourse, user, loading,
    moodleToken, saveMoodleToken,
    signInWithGoogle, signOut: signOutUser,
  } = useRecordings();

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const personalMemories = useMemo(() => memories.filter(m => m.category === 'personal'), [memories]);

  // Moodle sync
  useEffect(() => {
    const syncMoodle = async () => {
      if (!moodleToken || memories.length === 0) return;
      try {
        setIsSyncingMoodle(true);
        const moodleCourses = await fetchMoodleCourses(moodleToken);
        for (const mc of moodleCourses) {
          if (!courses.includes(mc.fullname)) addCourse(mc.fullname);
        }
        for (const mc of moodleCourses) {
          const contents = await fetchCourseContents(moodleToken, mc.id);
          for (const item of contents) {
            const alreadySaved = memories.some(m => m.title === item.name && (m as any).course === mc.fullname);
            if (!alreadySaved) {
              await addMemory({
                type: 'file',
                title: item.name,
                category: 'college',
                course: mc.fullname,
                url: item.fileurl,
                mimeType: item.mimetype,
              } as Omit<FileMemory, 'id' | 'date'>);
            }
          }
        }
      } catch (e) {
        console.error('Moodle sync failed', e);
      } finally {
        setIsSyncingMoodle(false);
      }
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
      const analysis = await processSharedUrl(url, title, text, webCategories);
      await addMemory({
        type: 'web',
        url: url,
        title: analysis.title,
        content: analysis.summary,
        contentType: analysis.type,
        category: 'personal',
        tags: analysis.suggestedTags.length > 0 ? analysis.suggestedTags : analysis.takeaways
      } as Omit<WebMemory, 'id' | 'date'>);
      setView('personal');
    } catch (error) {
      setSharedContent({ url, title: title || text || 'Shared Link' });
      window.history.pushState({ modal: 'share' }, '');
    } finally {
      setIsProcessingShare(false);
    }
  }, [addMemory]);

  // Step 1: capture share params immediately on mount and clear the URL
  // (must run before auth resolves so params aren't lost when handleProcessShare re-renders)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSharedParam = params.has('shared') || params.has('url') || params.has('text') || params.has('title');
    if (hasSharedParam) {
      const title = params.get('title') || '';
      const text  = params.get('text')  || '';
      const url   = params.get('url')   || '';
      window.history.replaceState({}, document.title, window.location.pathname);
      const resolvedUrl = url || text.match(/(https?:\/\/[^\s]+)/)?.[0] || '';
      if (resolvedUrl) pendingShareRef.current = { url: resolvedUrl, title, text };
    }
  }, []); // run once on mount only

  // Step 2: process the share once Firebase auth has resolved
  useEffect(() => {
    if (!loading && user && pendingShareRef.current) {
      const share = pendingShareRef.current;
      pendingShareRef.current = null;
      handleProcessShare(share.url, share.title, share.text);
    }
  }, [loading, user, handleProcessShare]);

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

  // Load Google Calendar events
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    fetchGoogleCalendarEvents(token)
      .then(events => setGoogleEvents(events))
      .catch(() => setGoogleEvents([]));
  }, []);

  const allCalendarEvents = useMemo(() => {
    const seen = new Set<string>();
    return [...calendarEvents, ...moodleEvents, ...googleEvents].filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [calendarEvents, moodleEvents, googleEvents]);

  // hardware back button / browser back handling
  useEffect(() => {
    const handlePopState = () => {
      if (showSettings) { setShowSettings(false); return; }
      if (showSchedule) { setShowSchedule(false); return; }
      if (sharedContent) { setSharedContent(null); return; }
      if (collegeBackHandlerRef.current?.()) return;
      setView('personal');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showSettings, showSchedule, sharedContent, view]);

  const renderView = () => {
    switch (view) {
      case 'personal':
        return (
          <PersonalView
            memories={personalMemories}
            tasks={tasks.filter(t => t.category === 'personal')}
            onDeleteMemory={deleteMemory}
            onUpdateMemory={updateMemory}
            bulkDeleteMemories={bulkDeleteMemories}
            onSaveMemory={addMemory}
            onAddTask={addTask}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
            webCategories={webCategories}
            onUpdateWebCategories={updateWebCategories}
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
            deleteCourse={deleteCourse}
            tasks={tasks}
            addTask={addTask}
            updateTask={updateTask}
            deleteTask={deleteTask}
            moodleToken={moodleToken}
            backHandlerRef={collegeBackHandlerRef}
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
        return null;
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#001F3F] flex items-center justify-center">
      <Loader2 className="animate-spin text-white" size={48} strokeWidth={2} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#001F3F] flex flex-col text-white overflow-hidden" style={{ height: '100dvh' }}>
      <TopInstallBanner />

      {/* Processing share overlay */}
      {isProcessingShare && (
        <div className="fixed inset-0 bg-[#001F3F]/90 z-50 flex flex-col items-center justify-center gap-6">
          <Loader2 className="animate-spin text-white" size={64} strokeWidth={2} />
          <p className="text-white font-black text-2xl uppercase tracking-widest">Saving Link…</p>
        </div>
      )}

      {/* Shared content fallback modal */}
      {sharedContent && (
        <div className="fixed inset-0 bg-[#001F3F]/95 z-50 flex flex-col items-center justify-center gap-6 p-6">
          <p className="text-white font-black text-xl uppercase">Save this link?</p>
          <p className="text-white/70 text-center break-all">{sharedContent.url}</p>
          <div className="flex gap-4">
            <button
              onClick={async () => {
                await addMemory({ type: 'web', url: sharedContent.url, title: sharedContent.title, content: '', category: 'personal' } as Omit<WebMemory, 'id' | 'date'>);
                setSharedContent(null);
                setView('personal');
              }}
              className="px-8 py-4 bg-white text-[#001F3F] rounded-2xl font-black text-lg uppercase"
            >Save</button>
            <button onClick={() => setSharedContent(null)} className="px-8 py-4 bg-white/10 text-white rounded-2xl font-black text-lg uppercase">Dismiss</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header
        className="flex-shrink-0 bg-[#001F3F] border-b-2 sm:border-b-4 border-white z-20"
      >
        <div className="flex justify-between items-center px-3 sm:px-6 py-2 sm:py-3 landscape:py-1">
          <button
            onClick={() => toggleSchedule(true)}
            className="btn-icon flex items-center justify-center p-2 sm:p-3 bg-white/10 rounded-xl sm:rounded-2xl border-2 sm:border-3 border-white text-white active:scale-90 transition-transform"
            aria-label="Open schedule"
          >
            <Calendar className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" strokeWidth={3} />
          </button>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Brain className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-white flex-shrink-0" strokeWidth={3} />
            <h1 className="text-base sm:text-xl md:text-2xl font-black uppercase tracking-tighter text-white truncate">{viewTitles[view]}</h1>
          </div>
          <button
            onClick={() => toggleSettings(true)}
            className="btn-icon flex items-center justify-center p-2 sm:p-3 bg-white/10 rounded-xl sm:rounded-2xl border-2 sm:border-3 border-white text-white active:scale-90 transition-transform"
            aria-label="Open settings"
          >
            <Settings className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10" strokeWidth={3} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-grow overflow-hidden relative">
        <div className="max-w-4xl mx-auto h-full overflow-y-auto no-scrollbar p-4">{renderView()}</div>
      </main>

      {/* Bottom nav */}
      <BottomNavBar view={view} setView={setView} />

      {/* Modals */}
      {showSettings && (
        <SettingsModal
          onClose={() => toggleSettings(false)}
          user={user}
          onSignIn={signInWithGoogle}
          onSignOut={signOutUser}
          moodleToken={moodleToken}
          onSaveMoodleToken={saveMoodleToken}
        />
      )}
      {showSchedule && (
        <ScheduleView
          events={allCalendarEvents}
          onClose={() => toggleSchedule(false)}
          onAddEvent={addCalendarEvent}
          onDeleteEvent={deleteCalendarEvent}
        />
      )}
    </div>
  );
}

export default App;

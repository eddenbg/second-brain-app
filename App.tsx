import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import BottomNavBar from './components/BottomNavBar';
import type { View } from './components/BottomNavBar';
import CollegeView from './components/CollegeView';
import AskAIView, { ASK_AI_GREETING } from './components/AskAIView';
import type { AskAIMessage } from './components/AskAIView';
import PersonalView from './components/PersonalView';
import ScheduleView from './components/ScheduleView';
import FilesView from './components/FilesView';
import SettingsModal from './components/SettingsModal';
import { useRecordings } from './hooks/useRecordings';
import { safeSetItem } from './utils/safeStorage';
import { fetchMoodleEvents, fetchMoodleCourses, fetchCourseContents } from './services/moodleService';
import { processSharedUrl } from './services/geminiService';
import { saveNotionToken, getStoredNotionClientId, getStoredNotionClientSecret } from './services/notionService';
import { getStoredToken, fetchGoogleCalendarEvents } from './services/googleCalendarService';
import { refreshGoogleToken, watchGoogleTokenExpiry, GOOGLE_AUTH_EXPIRED_EVENT, GOOGLE_TOKEN_REFRESHED_EVENT } from './services/googleAuthService';
import type { AnyMemory, WebMemory, CalendarEvent, Task, FileMemory } from './types';
import { Settings, Loader2, Brain, Calendar } from 'lucide-react';

const ASK_AI_SESSION_KEY = 'ask_ai_conversation';

const loadAskAiSession = (): AskAIMessage[] | null => {
  try {
    const raw = sessionStorage.getItem(ASK_AI_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length > 1 ? parsed : null;
  } catch {
    return null;
  }
};

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
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('dark_mode') === '1');
  const [isHighContrast, setIsHighContrast] = useState(() => localStorage.getItem('high_contrast') === '1');
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>(() =>
    (localStorage.getItem('font_size') as 'normal' | 'large' | 'xlarge') || 'normal'
  );
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [moodleEvents, setMoodleEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [sharedContent, setSharedContent] = useState<{ url: string; title: string } | null>(null);
  const [isProcessingShare, setIsProcessingShare] = useState(false);
  const [isSyncingMoodle, setIsSyncingMoodle] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Capture share params immediately on mount before auth loads (prevents race condition)
  const pendingShareRef = useRef<{ url: string; title: string; text: string } | null>(null);
  const [webCategories, setWebCategories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('web_categories') || '[]'); } catch { return []; }
  });
  const updateWebCategories = useCallback((cats: string[]) => {
    setWebCategories(cats);
    safeSetItem('web_categories', JSON.stringify(cats));
  }, []);

  // Ask AI conversation is kept here (and in sessionStorage) so switching
  // tabs doesn't reset it. Only "New Conversation" clears it.
  const [askAiRestored] = useState(() => loadAskAiSession() !== null);
  const [askAiMessages, setAskAiMessages] = useState<AskAIMessage[]>(() => loadAskAiSession() || [ASK_AI_GREETING]);
  useEffect(() => {
    try {
      sessionStorage.setItem(ASK_AI_SESSION_KEY, JSON.stringify(askAiMessages));
    } catch {
      // sessionStorage full or unavailable — the in-memory copy still persists across tabs
    }
  }, [askAiMessages]);
  const startNewAskAiConversation = useCallback(() => {
    setAskAiMessages([ASK_AI_GREETING]);
  }, []);

  const collegeBackHandlerRef = useRef<(() => boolean) | null>(null);
  const filesBackHandlerRef = useRef<(() => boolean) | null>(null);

  // Dark mode effect: apply/remove class and store preference
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    safeSetItem('dark_mode', isDarkMode ? '1' : '0');
  }, [isDarkMode]);

  // High contrast mode effect
  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }
    safeSetItem('high_contrast', isHighContrast ? '1' : '0');
  }, [isHighContrast]);

  // Font size effect
  useEffect(() => {
    document.documentElement.classList.remove('font-large', 'font-xlarge');
    if (fontSize === 'large') {
      document.documentElement.classList.add('font-large');
    } else if (fontSize === 'xlarge') {
      document.documentElement.classList.add('font-xlarge');
    }
    safeSetItem('font_size', fontSize);
  }, [fontSize]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => !prev);
  }, []);

  const toggleHighContrast = useCallback(() => {
    setIsHighContrast(prev => !prev);
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSize(prev => {
      if (prev === 'normal') return 'large';
      if (prev === 'large') return 'xlarge';
      return 'normal';
    });
  }, []);

  const {
    memories, addMemory, deleteMemory, updateMemory, bulkDeleteMemories,
    tasks, addTask, updateTask, deleteTask,
    courses, addCourse, deleteCourse, user, loading,
    moodleToken, saveMoodleToken,
    signInWithGoogle, signOut: signOutUser,
    storageWarning,
  } = useRecordings();

  // Non-blocking notice when the offline cache can't be written
  useEffect(() => {
    if (!storageWarning) return;
    setToast(storageWarning);
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [storageWarning]);

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const personalMemories = useMemo(() => memories.filter(m => m.category === 'personal'), [memories]);

  // TODO(deferred): Moodle full integration (assignments, grades, two-way sync).
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
                fileUrl: item.fileurl,
                mimeType: item.mimetype,
                sourceType: 'moodle',
                moodleId: String(item.id),
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

  // Notion OAuth callback: ?code=XXX&state=notion_oauth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state === 'notion_oauth') {
      window.history.replaceState({}, document.title, window.location.pathname);
      const redirectUri = `${window.location.origin}/`;
      fetch('/.netlify/functions/notionOAuth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: redirectUri,
          client_id: getStoredNotionClientId(),
          client_secret: getStoredNotionClientSecret(),
        }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.access_token) {
            saveNotionToken(data.access_token);
            // If this is running in a popup opened by the main app, send the
            // token back and close — the parent window saves it and we're done.
            if (window.opener && window.opener !== window) {
              try {
                window.opener.postMessage(
                  { type: 'NOTION_TOKEN', token: data.access_token },
                  window.location.origin
                );
              } catch {}
              setTimeout(() => window.close(), 300);
              return;
            }
            setToast('Notion connected!');
            setTimeout(() => setToast(null), 4000);
          } else {
            setToast('Notion connection failed. Try again.');
            setTimeout(() => setToast(null), 5000);
          }
        })
        .catch(() => {
          setToast('Notion connection failed. Try again.');
          setTimeout(() => setToast(null), 5000);
        });
    }
  }, []);

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

  // Google API token (Calendar/Drive) expiry: detected via onAuthStateChanged,
  // visibility changes, a 1-minute check, and 401 responses from API calls.
  const [googleExpired, setGoogleExpired] = useState(false);
  const [googleTokenVersion, setGoogleTokenVersion] = useState(0);
  const [isReconnectingGoogle, setIsReconnectingGoogle] = useState(false);
  const autoRefreshTriedRef = useRef(false);

  useEffect(() => watchGoogleTokenExpiry(setGoogleExpired), []);

  // When a Drive/Calendar call returns 401, try to refresh the token right
  // away (once per session). Browsers often block popups that aren't
  // triggered by a tap — then the banner's Reconnect button does it.
  useEffect(() => {
    const onApiAuthError = () => {
      if (autoRefreshTriedRef.current) return;
      autoRefreshTriedRef.current = true;
      refreshGoogleToken(false).catch(() => { /* banner stays visible */ });
    };
    window.addEventListener(GOOGLE_AUTH_EXPIRED_EVENT, onApiAuthError);
    return () => window.removeEventListener(GOOGLE_AUTH_EXPIRED_EVENT, onApiAuthError);
  }, []);

  useEffect(() => {
    const onRefreshed = () => {
      setGoogleExpired(false);
      setGoogleTokenVersion(v => v + 1);
    };
    window.addEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(GOOGLE_TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  const reconnectGoogle = useCallback(async () => {
    setIsReconnectingGoogle(true);
    try {
      const ok = await refreshGoogleToken(true);
      if (ok) {
        setToast('Google reconnected');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user') {
        setToast('Could not reconnect Google. Try again.');
        setTimeout(() => setToast(null), 5000);
      }
    } finally {
      setIsReconnectingGoogle(false);
    }
  }, []);

  // Load Google Calendar events (again after every token refresh)
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    fetchGoogleCalendarEvents(token)
      .then(events => setGoogleEvents(events))
      .catch(() => setGoogleEvents([]));
  }, [googleTokenVersion]);

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
      if (filesBackHandlerRef.current?.()) return;
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
        return (
          <AskAIView
            memories={memories}
            messages={askAiMessages}
            setMessages={setAskAiMessages}
            restoredFromEarlier={askAiRestored}
            onNewConversation={startNewAskAiConversation}
          />
        );
      case 'files':
        return (
          <FilesView
            memories={memories}
            onSave={addMemory}
            onDelete={deleteMemory}
            onUpdate={updateMemory}
            backHandlerRef={filesBackHandlerRef}
            moodleToken={moodleToken}
            isGoogleUser={!!user && !user.isAnonymous}
            googleExpired={googleExpired}
            googleTokenVersion={googleTokenVersion}
            onReconnectGoogle={reconnectGoogle}
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

      {/* Google token expired banner */}
      {googleExpired && (
        <div role="alert" className="flex-shrink-0 bg-yellow-500 text-[#001F3F] px-4 py-2 flex items-center justify-between gap-3 z-10">
          <p className="font-black text-xs uppercase tracking-widest">Google connection expired.</p>
          <button
            onClick={reconnectGoogle}
            disabled={isReconnectingGoogle}
            className="flex items-center gap-2 px-4 py-2 bg-[#001F3F] text-white rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-transform disabled:opacity-60"
            style={{ minHeight: 'unset' }}
          >
            {isReconnectingGoogle && <Loader2 className="animate-spin" size={14} strokeWidth={3} />}
            {isReconnectingGoogle ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}

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
          isDarkMode={isDarkMode}
          onToggleDarkMode={toggleDarkMode}
          isHighContrast={isHighContrast}
          onToggleHighContrast={toggleHighContrast}
          fontSize={fontSize}
          onCycleFontSize={cycleFontSize}
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

      {/* Toast notifications */}
      {/* Live region stays mounted so screen readers announce new messages */}
      <div role="status" aria-live="polite" className="fixed bottom-24 left-0 right-0 flex justify-center z-[300] pointer-events-none">
        {toast && (
          <div className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-2xl border-2 border-white/20 animate-fade-in">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

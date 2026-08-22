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
import ConfirmationModal from './components/ConfirmationModal';
import OfflineBanner from './components/OfflineBanner';
import { useRecordings } from './hooks/useRecordings';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { fetchMoodleEvents } from './services/moodleService';
import { processSharedUrl } from './services/geminiService';
import { extractUrlContent } from './services/urlContentService';
import { saveNotionToken, getStoredNotionClientId, getStoredNotionClientSecret } from './services/notionService';
import { getStoredToken, fetchGoogleCalendarEvents, GOOGLE_TOKEN_CHANGE_EVENT } from './services/googleCalendarService';
import { getStoredDriveToken } from './services/googleDriveService';
import { updateService } from './services/updateService';
import type { AnyMemory, WebMemory, CalendarEvent, Task } from './types';
import { Settings, Loader2, Brain, Calendar } from 'lucide-react';

const viewTitles: Record<View, string> = {
    personal: 'Personal Hub',
    college:  'College Hub',
    askai:    'Ask AI',
    files:    'Files Vault',
};

function App() {
  const isOnline = useOnlineStatus();
  const [view, setView] = useState<View>('personal');
  const [showSettings, setShowSettings] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('dark_mode') === '1');
  const [isHighContrast, setIsHighContrast] = useState(() => localStorage.getItem('high_contrast') === '1');
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>(() =>
    (localStorage.getItem('font_size') as 'normal' | 'large' | 'xlarge') || 'normal'
  );
  const [moodleEvents, setMoodleEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  // True when the person is signed in with a real Google account but the
  // Calendar fetch below could not load events because the access token has
  // expired or was rejected — as opposed to simply never having connected
  // Calendar at all, which is not an error worth surfacing.
  const [googleCalendarNeedsReconnect, setGoogleCalendarNeedsReconnect] = useState(false);
  const [sharedContent, setSharedContent] = useState<{ url: string; title: string } | null>(null);
  const [isProcessingShare, setIsProcessingShare] = useState(false);
  const [isSavingSharedLink, setIsSavingSharedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ eventId: string } | null>(null);
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
  const filesBackHandlerRef = useRef<(() => boolean) | null>(null);

  // Dark mode effect: apply/remove class and store preference
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('dark_mode', isDarkMode ? '1' : '0');
  }, [isDarkMode]);

  // High contrast mode effect
  useEffect(() => {
    if (isHighContrast) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }
    localStorage.setItem('high_contrast', isHighContrast ? '1' : '0');
  }, [isHighContrast]);

  // Font size effect
  useEffect(() => {
    document.documentElement.classList.remove('font-large', 'font-xlarge');
    if (fontSize === 'large') {
      document.documentElement.classList.add('font-large');
    } else if (fontSize === 'xlarge') {
      document.documentElement.classList.add('font-xlarge');
    }
    localStorage.setItem('font_size', fontSize);
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
    courses, addCourse, deleteCourse, courseTerms, user, loading,
    moodleToken, saveMoodleToken,
    // Manually-added calendar events now live in Firestore via the hook, same
    // as memories/tasks — previously this was plain useState right here in
    // App.tsx with no persistence at all, so an event added on one device
    // never showed up on another, and vanished on a reload of the same one.
    calendarEvents, addCalendarEvent, deleteCalendarEvent,
    signInWithGoogle, signOut: signOutUser,
    anthropicApiKey, saveAnthropicApiKey, syncNotionToken,
  } = useRecordings();

  const collegeMemories = useMemo(() => memories.filter(m => m.category === 'college'), [memories]);
  const personalMemories = useMemo(() => memories.filter(m => m.category === 'personal'), [memories]);

  // Moodle course/file sync used to run here silently and automatically —
  // no confirmation, no visible progress (isSyncingMoodle was set but never
  // rendered anywhere) — creating a local course per Moodle course and
  // importing every file it found the moment a token existed. In practice it
  // was inert: the wsfunctions it called (core_course_get_..., see
  // moodleService.ts) hit an invalidtoken exception on this Moodle install
  // before ever reaching the import step, so nothing ever actually landed.
  // Fixing that error path would have switched this on for real, at which
  // point it directly conflicts with the deliberate, reviewed import flows
  // now in College Hub: "Import Semester" (CollegeView.tsx) lets the user see
  // and confirm which Moodle courses become notebooks before anything is
  // created, and the in-course "Browse Moodle" button imports a course's
  // files on demand. Silently mass-creating courses and mass-importing every
  // file in the background would fight both of those and dump everything
  // into an untermed "General" bucket besides. Removed in favor of the
  // explicit UI.

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
      // Analysis gives a short AI summary for `content`; separately fetch the
      // real page text server-side so "Play" has the whole article to read,
      // not just that summary. Run in parallel — extraction failing shouldn't
      // block the share, it just leaves fullText unset (falls back to content).
      const [analysis, extracted] = await Promise.all([
        processSharedUrl(url, title, text, webCategories),
        extractUrlContent(url),
      ]);
      await addMemory({
        type: 'web',
        url: url,
        title: analysis.title,
        content: analysis.summary,
        contentType: analysis.type,
        category: 'personal',
        tags: analysis.suggestedTags.length > 0 ? analysis.suggestedTags : analysis.takeaways,
        ...(extracted?.text && { fullText: extracted.text, fullTextFetchedAt: new Date().toISOString() }),
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
            syncNotionToken(data.access_token);
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
    if (!moodleToken) {
      setMoodleEvents([]);
      return;
    }
    let cancelled = false;
    fetchMoodleEvents(moodleToken)
      .then(events => { if (!cancelled) setMoodleEvents(events); })
      .catch(err => {
        // fetchMoodleEvents now throws instead of silently resolving to []
        // (that silence was the bug: a healthy connection with no visible
        // failure and no events). Surface it via the same toast pattern used
        // for Google/Notion above so it isn't console-only.
        console.error('[App] Moodle events fetch failed', err);
        if (cancelled) return;
        setMoodleEvents([]);
        setToast('Could not load Moodle calendar events. Open Settings to check your connection.');
        setTimeout(() => setToast(null), 6000);
      });
    return () => { cancelled = true; };
  }, [moodleToken]);

  // Just opens the confirmation dialog; the hook's deleteCalendarEvent (which
  // actually removes the event, from Firestore too) runs on confirm below.
  const confirmDeleteCalendarEvent = (eventId: string) => {
      setConfirmDialog({ eventId });
  };

  // Load Google Calendar events.
  //
  // Re-runs when the signed-in user changes, and also re-runs whenever the
  // stored Calendar token is written or cleared anywhere else in the app —
  // Settings' reconnect flow, a future silent-reauth path, or this fetch's
  // own 401 handling — via the 'google-calendar-token-changed' event
  // googleCalendarService fires on every such write. Without that second
  // trigger, `user`'s object identity does not change just because
  // localStorage did, so events fetched before a reconnect never refetched
  // short of a full page reload.
  //
  // Google Calendar access tokens last roughly an hour and this app is never
  // issued a refresh token (Google does not hand one to a browser app with no
  // server-side secret to redeem it), so the very common case is: the person
  // connected Calendar at some point, comes back to the app later, and the
  // token has quietly expired since. getStoredToken() already treats that as
  // "no token" (it checks the locally-recorded expiry itself), so this used
  // to just leave googleEvents empty with zero explanation — a "connected"
  // Settings screen and a silently blank Schedule view. Track that case
  // explicitly instead of swallowing it.
  useEffect(() => {
    let cancelled = false;

    const runFetch = () => {
      const token = getStoredToken();
      if (!token) {
        setGoogleEvents([]);
        // Only worth flagging for someone actually signed in with Google —
        // for anonymous/never-connected users, "no token" isn't an error.
        setGoogleCalendarNeedsReconnect(!!user && !user.isAnonymous);
        return;
      }
      setGoogleCalendarNeedsReconnect(false);
      fetchGoogleCalendarEvents(token)
        .then(events => { if (!cancelled) setGoogleEvents(events); })
        .catch(() => {
          if (cancelled) return;
          setGoogleEvents([]);
          setGoogleCalendarNeedsReconnect(true);
        });
    };

    runFetch();
    window.addEventListener(GOOGLE_TOKEN_CHANGE_EVENT, runFetch);
    return () => {
      cancelled = true;
      window.removeEventListener(GOOGLE_TOKEN_CHANGE_EVENT, runFetch);
    };
  }, [user]);

  // Tell the user the moment the fetch above determines Google Calendar
  // events could not be loaded because the connection lapsed, rather than
  // just rendering an empty Schedule view with no explanation.
  useEffect(() => {
    if (!googleCalendarNeedsReconnect) return;
    setToast('Google Calendar connection expired. Open Settings to reconnect.');
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [googleCalendarNeedsReconnect]);

  // Separately, notify about Google Drive (used for recording backups, not
  // the Schedule view) lapsing. Nothing on screen actively fetches with the
  // Drive token the way the effect above does for Calendar, so a visibility
  // check remains the only signal available for it.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!user || user.isAnonymous) return;
      if (!getStoredDriveToken()) {
        setToast('Google Drive connection expired. Open Settings to reconnect.');
        setTimeout(() => setToast(null), 6000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user]);


  // Initialize live update service for instant web app updates
  useEffect(() => {
    // Update service auto-starts monitoring in constructor
    // Clean up on unmount
    return () => {
      updateService.stopMonitoring();
    };
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
            courseTerms={courseTerms}
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
            backHandlerRef={filesBackHandlerRef}
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
      <OfflineBanner isOnline={isOnline} />

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
              disabled={isSavingSharedLink}
              onClick={async () => {
                setIsSavingSharedLink(true);
                try {
                  // The AI analysis path failed (hence this fallback modal), but the
                  // page fetch is independent of that — still worth trying so this
                  // clip isn't stuck with an empty `content` and no full text either.
                  const extracted = await extractUrlContent(sharedContent.url);
                  await addMemory({
                    type: 'web',
                    url: sharedContent.url,
                    title: sharedContent.title || extracted?.title || 'Shared Link',
                    content: extracted?.text ? extracted.text.slice(0, 500) : '',
                    category: 'personal',
                    ...(extracted?.text && { fullText: extracted.text, fullTextFetchedAt: new Date().toISOString() }),
                  } as Omit<WebMemory, 'id' | 'date'>);
                  setSharedContent(null);
                  setView('personal');
                } finally {
                  setIsSavingSharedLink(false);
                }
              }}
              className="px-8 py-4 bg-white text-[#001F3F] rounded-2xl font-black text-lg uppercase disabled:opacity-50"
            >{isSavingSharedLink ? 'Saving…' : 'Save'}</button>
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
        <div className="max-w-4xl mx-auto h-full overflow-y-auto overflow-x-hidden no-scrollbar p-4">{renderView()}</div>
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
          anthropicApiKey={anthropicApiKey}
          onSaveAnthropicApiKey={saveAnthropicApiKey}
          onNotionTokenChanged={syncNotionToken}
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
          onDeleteEvent={confirmDeleteCalendarEvent}
        />
      )}

      {confirmDialog && (
        <ConfirmationModal
          title="Delete Event"
          message="Are you sure you want to delete this event?"
          confirmText="Delete"
          cancelText="Cancel"
          isDangerous={true}
          onConfirm={() => {
            deleteCalendarEvent(confirmDialog.eventId);
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Toast notifications */}
      {toast && (
        <div className="fixed bottom-24 left-0 right-0 flex justify-center z-[300] pointer-events-none">
          <div className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-2xl border-2 border-white/20 animate-fade-in">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

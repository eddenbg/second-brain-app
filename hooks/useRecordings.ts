import { useState, useEffect, useCallback, useRef } from 'react';
import type { AnyMemory, WebMemory, Task, CalendarEvent } from '../types';
import { db, auth, storage } from '../utils/firebase';
import { 
    collection, 
    doc, 
    writeBatch,
    query,
    orderBy,
    onSnapshot
} from 'firebase/firestore';
import { onAuthStateChanged, User, signInAnonymously, linkWithRedirect, signInWithRedirect, linkWithPopup, signInWithPopup, getRedirectResult, signInWithCredential, GoogleAuthProvider, signOut as firebaseSignOut, UserCredential } from 'firebase/auth';
import { saveGoogleToken } from '../services/googleCalendarService';
import { saveDriveToken, getStoredDriveToken, uploadAudioToDrive } from '../services/googleDriveService';
import { googleProvider } from '../utils/firebase';

export interface StoredData {
    memories: AnyMemory[];
    courses: string[];
    tasks: Task[];
    calendarEvents?: CalendarEvent[];
    moodleToken?: string;
    anthropicApiKey?: string;
    notionToken?: string;
    /** Course name -> term name (e.g. "Fall 2026"). Courses with no entry belong to 'General'. */
    courseTerms?: Record<string, string>;
}

const LOCAL_STORAGE_KEY = 'second_brain_local_data';

// Same device-local keys the standalone Claude/Notion connect UI already reads
// from directly (ClaudeResearchPanel.tsx, notionService.ts). Mirroring writes
// into these on every Firestore sync means those components sync across
// devices for free, with no prop-threading required.
const ANTHROPIC_KEY_LOCAL_KEY = 'anthropic_api_key';
const NOTION_TOKEN_LOCAL_KEY = 'notion_integration_token';

/**
 * Firestore rejects any document containing an undefined value, failing the whole
 * write. Several fields are built as `x || undefined` (videoDataUrl, summary,
 * notebook.backgroundImageUrl when no background was set), so a perfectly ordinary
 * lecture could not be saved at all. Drop those keys instead of sending them.
 */
const stripUndefined = (value: any): any => {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined) continue;
            out[k] = stripUndefined(v);
        }
        return out;
    }
    return value;
};


/** Roughly a Firestore document's limit; stay well under it. */
const INLINE_MEDIA_LIMIT = 700_000;

/**
 * Best-effort, silent reissue of the Calendar/Drive access token.
 *
 * Uses a separate GoogleAuthProvider instance with prompt: 'none', not the
 * shared `googleProvider` singleton from utils/firebase.ts — that singleton
 * backs the ordinary sign-in button, and mutating its custom parameters here
 * would leak 'none' into that flow too, silently breaking sign-in for anyone
 * who has not already granted consent (their popup would fail instead of
 * showing the consent screen).
 *
 * prompt: 'none' is standard OAuth2, not a Firebase feature: if the browser
 * still holds an active Google session and consent was already granted,
 * Google reissues a token with no UI at all; otherwise the request fails
 * cleanly (interaction_required) rather than falling back to a visible
 * prompt. So this either fixes the expired token invisibly or does nothing —
 * it can never surprise the user with an unexpected popup.
 *
 * Callers already sit inside a user-gesture call chain (this runs from
 * externalizeMedia, itself reached from tapping Save), which is what keeps a
 * same-tick signInWithPopup from being blocked — this must not be called from
 * a background timer, where the popup would be blocked outright.
 */
const trySilentGoogleReauth = async (): Promise<string | null> => {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) return null;

    const silentProvider = new GoogleAuthProvider();
    silentProvider.addScope('https://www.googleapis.com/auth/calendar.readonly');
    silentProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
    silentProvider.addScope('https://www.googleapis.com/auth/drive.file');
    silentProvider.setCustomParameters({ prompt: 'none' });

    try {
        const result = await signInWithPopup(auth, silentProvider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken;
        if (!token) return null;
        saveGoogleToken(token);
        saveDriveToken(token);
        return token;
    } catch {
        // Expected whenever silent reauth is not possible — no active Google
        // session in this browser, or consent was revoked. Not an error worth
        // surfacing; the caller falls back to its existing "please reconnect"
        // messaging exactly as before this existed.
        return null;
    }
};

/**
 * Move oversized recordings out of the document and into the user's Drive.
 *
 * A Firestore document cannot exceed 1MB, and base64 audio blows past that after
 * about half a minute — saving a real lecture failed outright with "the value of
 * property audioDataUrl is longer than 1048487 bytes". Upload anything large and
 * keep only the download URL in the document.
 *
 * If the upload cannot happen (Storage not enabled, rules denying writes, offline)
 * we drop the media rather than fail the save: losing the audio is bad, losing the
 * transcript and handwriting with it is far worse. The caller is told what happened.
 */
const externalizeMedia = async (
    memory: any,
    uid: string,
): Promise<{ memory: any; warning?: string }> => {
    const fields = ['audioDataUrl', 'videoDataUrl'] as const;
    const oversized = fields.filter(f => typeof memory[f] === 'string'
        && memory[f].startsWith('data:')
        && memory[f].length > INLINE_MEDIA_LIMIT);

    if (oversized.length === 0) return { memory };

    // The Calendar/Drive access token Google hands back is only valid for an
    // hour, and this client never receives a refresh token — Google does not
    // hand one to a browser app with no server-side client secret to redeem it,
    // by design. Before giving up, try one silent reauth: if the browser still
    // has an active Google session and consent was already granted, Google can
    // reissue a token with no prompt at all, so in the common case the person
    // saving this recording never sees anything.
    const driveToken = getStoredDriveToken() || await trySilentGoogleReauth();
    if (!driveToken) {
        for (const f of oversized) delete memory[f];
        return {
            memory,
            warning: 'Saved your transcript and notes. The recording itself was not kept, because '
                + 'Google Drive access has expired — open Settings and refresh it, then record again.',
        };
    }

    try {
        for (const f of oversized) {
            const label = f === 'audioDataUrl' ? 'audio' : 'video';
            const name = `second-brain-${memory.id}-${label}.webm`;
            const fileId = await uploadAudioToDrive(driveToken, name, memory[f]);
            delete memory[f];
            if (f === 'audioDataUrl') memory.audioDriveFileId = fileId;
            else memory.videoDriveFileId = fileId;
        }
        return { memory };
    } catch (e: any) {
        console.error('Drive upload failed', e);
        for (const f of oversized) delete memory[f];
        return {
            memory,
            warning: `Saved your transcript and notes, but the recording could not be uploaded to Drive (${e?.message || 'upload error'}).`,
        };
    }
};

export const useRecordings = () => {
    const [memories, setMemories] = useState<AnyMemory[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    // Manually-added ('manual' source) calendar entries only. Moodle and Google
    // events are separate read-only feeds fetched live from those services —
    // this is just the app's own events, which previously lived in App.tsx as
    // plain React state with no Firestore write at all, so they vanished on
    // reload and never reached a second device.
    const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
    const [moodleToken, setMoodleToken] = useState<string | null>(null);
    const [anthropicApiKey, setAnthropicApiKey] = useState<string | null>(null);
    const [notionToken, setNotionToken] = useState<string | null>(null);
    const [savedCourses, setSavedCourses] = useState<string[]>([]);
    const [courses, setCourses] = useState<string[]>([]);
    const [courseTerms, setCourseTerms] = useState<Record<string, string>>({});
    
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingTaskIdsRef = useRef<Set<string>>(new Set());
    const pendingCalendarEventIdsRef = useRef<Set<string>>(new Set());

    // 1. Initial Load from LocalStorage (for speed)
    useEffect(() => {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                setMemories(data.memories || []);
                setTasks(data.tasks || []);
                setCalendarEvents(data.calendarEvents || []);
                setSavedCourses(data.courses || []);
                setMoodleToken(data.moodleToken || null);
                setCourseTerms(data.courseTerms || {});
            } catch (e) {
                console.error("Failed to parse local storage", e);
            }
        }
        // Claude/Notion keys are kept in their own localStorage entries (read
        // directly by ClaudeResearchPanel.tsx and notionService.ts), not the
        // blob above — seed state from those so this device's own connection
        // shows immediately, before the Firestore settings listener confirms it.
        setAnthropicApiKey(localStorage.getItem(ANTHROPIC_KEY_LOCAL_KEY) || null);
        setNotionToken(localStorage.getItem(NOTION_TOKEN_LOCAL_KEY) || null);
    }, []);

    // 2. Handle Auth state — auto sign-in anonymously (no login screen)
    useEffect(() => {
        if (!auth) {
            setLoading(false);
            return;
        }

        let authUnsubscribe: (() => void) | undefined;

        const init = async () => {
            // Await redirect result FIRST so the Google token is stored before
            // onAuthStateChanged fires and the UI reads from localStorage.
            //
            // Every outcome here is recorded to localStorage so Settings can show
            // what happened. Previously failures were swallowed, so a broken
            // redirect looked identical to never having tapped the button.
            const redirectWasPending = localStorage.getItem('auth_redirect_pending');
            try {
                const result = await getRedirectResult(auth);
                if (result) {
                    localStorage.removeItem('auth_redirect_pending');
                    localStorage.removeItem('last_auth_error');
                    const credential = GoogleAuthProvider.credentialFromResult(result);
                    const token = credential?.accessToken;
                    if (token) {
                        saveGoogleToken(token);
                        saveDriveToken(token);
                    }
                } else if (redirectWasPending) {
                    // Came back from Google but Firebase had no result waiting —
                    // the classic partitioned-storage / authDomain mismatch.
                    localStorage.removeItem('auth_redirect_pending');
                    localStorage.setItem(
                        'last_auth_error',
                        'Returned from Google but no sign-in result was found (auth/no-redirect-result). ' +
                        `authDomain=${(auth as any)?.config?.authDomain ?? 'unknown'}`
                    );
                }
            } catch (e: any) {
                localStorage.removeItem('auth_redirect_pending');
                localStorage.setItem('last_auth_error', `${e?.code || 'unknown'}: ${e?.message || e}`);
                if (e.code === 'auth/credential-already-in-use') {
                    // Google account already linked to another Firebase UID — sign into that account directly
                    const credential = GoogleAuthProvider.credentialFromError(e);
                    if (credential) {
                        signInWithCredential(auth, credential)
                            .then(() => localStorage.removeItem('last_auth_error'))
                            .catch(console.error);
                    }
                }
            }

            // Now set up the auth state listener — token is guaranteed to be stored
            authUnsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                if (currentUser) {
                    setUser(currentUser);
                    setLoading(false);
                } else {
                    try {
                        await signInAnonymously(auth);
                    } catch (e) {
                        console.error("Anonymous sign-in failed", e);
                        setLoading(false);
                    }
                }
            });
        };

        init();

        return () => authUnsubscribe?.();
    }, []);

    // 3. Real-time Listeners for Memories and Tasks
    useEffect(() => {
        if (!user || !db || (db as any).type === 'mock') return;

        // Memories Listener
        const memoriesRef = collection(db, 'users', user.uid, 'memories');
        const qMemories = query(memoriesRef, orderBy('date', 'desc'));
        const unsubMemories = onSnapshot(
            qMemories,
            (snapshot) => {
                const remoteMemories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AnyMemory[];
                setMemories(remoteMemories);
            },
            (error) => {
                console.error('Memories listener error:', error);
            }
        );

        // Tasks Listener
        const tasksRef = collection(db, 'users', user.uid, 'tasks');
        const unsubTasks = onSnapshot(
            tasksRef,
            (snapshot) => {
                const remoteTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];
                setTasks(prev => {
                    const pendingIds = pendingTaskIdsRef.current;
                    if (pendingIds.size === 0) return remoteTasks;
                    // Merge: keep optimistic tasks not yet confirmed in remote snapshot
                    const remoteIds = new Set(remoteTasks.map(t => t.id));
                    const stillPending = prev.filter(t => pendingIds.has(t.id) && !remoteIds.has(t.id));
                    return [...remoteTasks, ...stillPending];
                });
            },
            (error) => {
                console.error('Tasks listener error:', error);
            }
        );

        // Calendar Events Listener (manually-added events only)
        const calendarEventsRef = collection(db, 'users', user.uid, 'calendarEvents');
        const unsubCalendarEvents = onSnapshot(
            calendarEventsRef,
            (snapshot) => {
                const remoteEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CalendarEvent[];
                setCalendarEvents(prev => {
                    const pendingIds = pendingCalendarEventIdsRef.current;
                    if (pendingIds.size === 0) return remoteEvents;
                    const remoteIds = new Set(remoteEvents.map(e => e.id));
                    const stillPending = prev.filter(e => pendingIds.has(e.id) && !remoteIds.has(e.id));
                    return [...remoteEvents, ...stillPending];
                });
            },
            (error) => {
                console.error('Calendar events listener error:', error);
            }
        );

        return () => {
            unsubMemories();
            unsubTasks();
            unsubCalendarEvents();
        };
    }, [user]);

    // 3b. Separate Real-time Listener for Settings to ensure cross-device sync
    useEffect(() => {
        if (!user || !db || (db as any).type === 'mock') return;

        const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
        const unsubSettings = onSnapshot(
            settingsRef,
            async (doc) => {
                if (doc.exists()) {
                    const data = doc.data();
                    setSavedCourses(data.courses || []);
                    setMoodleToken(data.moodleToken || null);
                    setCourseTerms(data.courseTerms || {});

                    // Cross-device sync: whatever this Google account has connected
                    // on any device becomes this device's connection too, so signing
                    // in with Google is the only step needed anywhere. Distinguish
                    // "field absent" (this account has never synced one — e.g. an
                    // existing device already has a token saved locally from before
                    // this synced-settings field existed) from "field explicitly
                    // null" (deliberately disconnected on some device) — only the
                    // latter should clear an existing local token. The absent case
                    // instead migrates this device's local token up to the cloud.
                    if ('anthropicApiKey' in data) {
                        setAnthropicApiKey(data.anthropicApiKey || null);
                        if (data.anthropicApiKey) localStorage.setItem(ANTHROPIC_KEY_LOCAL_KEY, data.anthropicApiKey);
                        else localStorage.removeItem(ANTHROPIC_KEY_LOCAL_KEY);
                    } else {
                        const localKey = localStorage.getItem(ANTHROPIC_KEY_LOCAL_KEY);
                        setAnthropicApiKey(localKey);
                        if (localKey) {
                            const { setDoc } = await import('firebase/firestore');
                            setDoc(settingsRef, { anthropicApiKey: localKey }, { merge: true }).catch(() => {});
                        }
                    }

                    if ('notionToken' in data) {
                        setNotionToken(data.notionToken || null);
                        if (data.notionToken) localStorage.setItem(NOTION_TOKEN_LOCAL_KEY, data.notionToken);
                        else localStorage.removeItem(NOTION_TOKEN_LOCAL_KEY);
                    } else {
                        const localToken = localStorage.getItem(NOTION_TOKEN_LOCAL_KEY);
                        setNotionToken(localToken);
                        if (localToken) {
                            const { setDoc } = await import('firebase/firestore');
                            setDoc(settingsRef, { notionToken: localToken }, { merge: true }).catch(() => {});
                        }
                    }
                } else {
                    setSavedCourses([]);
                    setMoodleToken(null);
                    setCourseTerms({});
                    // No settings doc at all yet — same migrate-don't-clobber logic
                    // as above, just against an empty object instead of `data`.
                    const localKey = localStorage.getItem(ANTHROPIC_KEY_LOCAL_KEY);
                    setAnthropicApiKey(localKey);
                    const localToken = localStorage.getItem(NOTION_TOKEN_LOCAL_KEY);
                    setNotionToken(localToken);
                    if (localKey || localToken) {
                        import('firebase/firestore').then(({ setDoc }) => {
                            setDoc(settingsRef, {
                                ...(localKey ? { anthropicApiKey: localKey } : {}),
                                ...(localToken ? { notionToken: localToken } : {}),
                            }, { merge: true }).catch(() => {});
                        });
                    }
                }
            },
            (error) => {
                console.error('Settings listener error:', error);
            }
        );

        return () => unsubSettings();

    }, [user]);

    // 4. Derived courses from memories + savedCourses
    useEffect(() => {
        const extracted = Array.from(new Set(
            memories
                .filter(m => m.category === 'college' && m.course)
                .map(m => m.course as string)
        ));
        const uniqueCourses = Array.from(new Set([...extracted, ...savedCourses]))
            .filter(c => c !== 'General')
            .sort();
            
        setCourses(uniqueCourses);
    }, [memories, savedCourses]);

    // 5. Save to local storage for offline persistent cache
    useEffect(() => {
        const data = { memories, tasks, calendarEvents, courses: savedCourses, moodleToken, courseTerms };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }, [memories, tasks, calendarEvents, savedCourses, moodleToken, courseTerms]);

    // --- Cloud Sync Action ---
    const performSync = useCallback(async () => {
        if (!user || !db || (db as any).type === 'mock') return;
        setIsSyncing(true);
        setSyncError(null);
        try {
            const batch = writeBatch(db);
            
            for (const mem of memories) {
                const docRef = doc(db, 'users', user.uid, 'memories', mem.id);
                batch.set(docRef, mem);
            }

            for (const task of tasks) {
                const docRef = doc(db, 'users', user.uid, 'tasks', task.id);
                batch.set(docRef, task);
            }

            for (const event of calendarEvents) {
                const docRef = doc(db, 'users', user.uid, 'calendarEvents', event.id);
                batch.set(docRef, event);
            }

            const settingsRef = doc(db, 'users', user.uid, 'settings', 'general');
            batch.set(settingsRef, { courses: savedCourses, moodleToken, courseTerms }, { merge: true });

            await batch.commit();
        } catch (e) {
            console.error('Sync failed', e);
            setSyncError('Sync failed. Please try again.');
        } finally {
            setIsSyncing(false);
        }
    }, [user, memories, tasks, calendarEvents, savedCourses, moodleToken, courseTerms]);

    // Reports failure instead of throwing into a promise nobody awaits. A rejected
    // write here used to disappear entirely, so a recording that was never stored
    // looked saved: the screen simply returned to the list without it.
    const addMemory = useCallback(async (memoryData: Omit<AnyMemory, 'id' | 'date'>): Promise<{ ok: boolean; reason?: string }> => {
        if (!db || (db as any).type === 'mock') {
            return { ok: false, reason: 'Storage is unavailable. Check your connection and try again.' };
        }
        if (!user) {
            return { ok: false, reason: 'Not signed in yet, so there is nowhere to save. Open Settings and sign in with Google.' };
        }
        const newMemory = stripUndefined({
            ...memoryData,
            id: Date.now().toString(),
            date: new Date().toISOString(),
        }) as AnyMemory;
        const { memory: storedMemory, warning } = await externalizeMedia(newMemory, user.uid);

        const { setDoc } = await import('firebase/firestore');
        try {
            await setDoc(doc(db, 'users', user.uid, 'memories', storedMemory.id), storedMemory);
        } catch (e: any) {
            console.error('addMemory failed', e);
            const denied = e?.code === 'permission-denied' || /insufficient permissions/i.test(e?.message || '');
            return {
                ok: false,
                reason: denied
                    ? 'The database rejected the save (missing or insufficient permissions). The Firestore security rules for this project need updating — nothing can be saved until then.'
                    : (e?.message || 'Could not save.'),
            };
        }
        // Fire-and-forget: generate AI topic tags and patch the document
        (async () => {
            try {
                const { generateTopicsForMemory } = await import('../services/geminiService');
                const { updateDoc } = await import('firebase/firestore');
                const content = (newMemory as any).transcript || (newMemory as any).extractedText ||
                               (newMemory as any).content || (newMemory as any).description ||
                               (newMemory as any).summary || '';
                const topics = await generateTopicsForMemory(newMemory.title, content);
                if (topics.length > 0) {
                    await updateDoc(doc(db, 'users', user.uid, 'memories', newMemory.id), { topics } as any);
                }
            } catch { /* topic generation is best-effort */ }
        })();

        return warning ? { ok: true, reason: warning } : { ok: true };
    }, [user]);

    const deleteMemory = useCallback(async (id: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', user.uid, 'memories', id));
    }, [user]);

    const bulkDeleteMemories = useCallback(async (ids: string[]) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await Promise.all(ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'memories', id))));
    }, [user]);

    const updateMemory = useCallback(async (id: string, updates: Partial<AnyMemory>) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'memories', id), updates as any);
    }, [user]);

    const addTask = useCallback(async (taskData: Omit<Task, 'id' | 'createdAt'>) => {
        const newTask: Task = { ...taskData, id: Date.now().toString(), createdAt: new Date().toISOString() };
        pendingTaskIdsRef.current.add(newTask.id);
        setTasks(prev => [...prev, newTask]); // optimistic — shows immediately
        if (!user || !db || (db as any).type === 'mock') {
            pendingTaskIdsRef.current.delete(newTask.id);
            return;
        }
        try {
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid, 'tasks', newTask.id), newTask);
        } catch (err) {
            console.error('addTask failed:', err);
            setTasks(prev => prev.filter(t => t.id !== newTask.id)); // rollback on error
        } finally {
            pendingTaskIdsRef.current.delete(newTask.id);
        }
    }, [user]);

    const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { updateDoc } = await import('firebase/firestore');
        await updateDoc(doc(db, 'users', user.uid, 'tasks', id), updates as any);
    }, [user]);

    const deleteTask = useCallback(async (id: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', user.uid, 'tasks', id));
    }, [user]);

    const addCalendarEvent = useCallback(async (eventData: Omit<CalendarEvent, 'id'>) => {
        const newEvent: CalendarEvent = { ...eventData, id: Date.now().toString(), source: 'manual' };
        pendingCalendarEventIdsRef.current.add(newEvent.id);
        setCalendarEvents(prev => [...prev, newEvent].sort(
            (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        )); // optimistic — shows immediately, same as addTask
        if (!user || !db || (db as any).type === 'mock') {
            pendingCalendarEventIdsRef.current.delete(newEvent.id);
            return;
        }
        try {
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid, 'calendarEvents', newEvent.id), newEvent);
        } catch (err) {
            console.error('addCalendarEvent failed:', err);
        } finally {
            pendingCalendarEventIdsRef.current.delete(newEvent.id);
        }
    }, [user]);

    const deleteCalendarEvent = useCallback(async (id: string) => {
        setCalendarEvents(prev => prev.filter(e => e.id !== id));
        if (!user || !db || (db as any).type === 'mock') return;
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'users', user.uid, 'calendarEvents', id));
    }, [user]);

    // Returns why it failed rather than silently doing nothing: without this the
    // Add Course button looked broken when the user simply was not signed in yet.
    // Callers that do not care can ignore the result.
    const addCourse = useCallback(async (courseName: string, term?: string): Promise<{ ok: boolean; reason?: string }> => {
        if (!db || (db as any).type === 'mock') {
            return { ok: false, reason: 'Storage is unavailable. Check your connection and try again.' };
        }
        if (!user) {
            return { ok: false, reason: 'Waiting for sign-in. Give it a moment, then try again.' };
        }
        try {
            const updated = [...new Set([...savedCourses, courseName])];
            const updatedTerms = { ...courseTerms, [courseName]: term || 'General' };
            const { setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: updated, moodleToken, courseTerms: updatedTerms }, { merge: true });
            return { ok: true };
        } catch (e: any) {
            console.error('addCourse failed', e);
            return { ok: false, reason: e?.message || 'Could not save the course.' };
        }
    }, [user, savedCourses, moodleToken, courseTerms]);

    const deleteCourse = useCallback(async (courseName: string) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { setDoc, deleteDoc } = await import('firebase/firestore');
        // Remove from savedCourses
        const updatedCourses = savedCourses.filter(c => c !== courseName);
        // Remove from courseTerms
        const updatedTerms = { ...courseTerms };
        delete updatedTerms[courseName];
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: updatedCourses, moodleToken, courseTerms: updatedTerms }, { merge: true });
        // Delete all memories belonging to this course
        const courseMemories = memories.filter(m => m.category === 'college' && (m as any).course === courseName);
        await Promise.all(courseMemories.map(m => deleteDoc(doc(db, 'users', user.uid, 'memories', m.id))));
    }, [user, savedCourses, moodleToken, memories, courseTerms]);

    const saveMoodleToken = useCallback(async (token: string | null) => {
        if (!user || !db || (db as any).type === 'mock') return;
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), { courses: savedCourses, moodleToken: token }, { merge: true });
        setMoodleToken(token);
    }, [user, savedCourses]);

    // Claude and Notion connections are plain string tokens (no OAuth refresh
    // flow like Google), so storing them in the same synced settings doc as
    // moodleToken makes "sign in with Google" the only step needed anywhere —
    // any device on this account picks the connection up via the settings
    // listener above, which also mirrors it into this device's localStorage
    // for the components that still read those keys directly.
    // Read auth.currentUser fresh rather than closing over the `user` state —
    // syncNotionToken in particular can be called from a one-time mount effect
    // handling the Notion OAuth redirect, which fires before the anonymous
    // sign-in resolves and would otherwise capture a stale null user forever.
    const saveAnthropicApiKey = useCallback(async (key: string | null) => {
        if (key) localStorage.setItem(ANTHROPIC_KEY_LOCAL_KEY, key);
        else localStorage.removeItem(ANTHROPIC_KEY_LOCAL_KEY);
        setAnthropicApiKey(key);
        const uid = auth?.currentUser?.uid;
        if (!uid || !db || (db as any).type === 'mock') return;
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', uid, 'settings', 'general'), { anthropicApiKey: key }, { merge: true });
    }, []);

    const syncNotionToken = useCallback(async (token: string | null) => {
        if (token) localStorage.setItem(NOTION_TOKEN_LOCAL_KEY, token);
        else localStorage.removeItem(NOTION_TOKEN_LOCAL_KEY);
        setNotionToken(token);
        const uid = auth?.currentUser?.uid;
        if (!uid || !db || (db as any).type === 'mock') return;
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', uid, 'settings', 'general'), { notionToken: token }, { merge: true });
    }, []);

    const signInWithGoogle = useCallback(async () => {
        if (!auth) throw new Error('Firebase not configured');

        // Inside the Android app, go through the native Google SDK.
        //
        // Google blocks its sign-in page in embedded WebViews, so neither the popup
        // nor the redirect can ever succeed there. The native plugin uses Play
        // Services instead and hands back a credential we exchange for a Firebase
        // session. Loaded lazily so the web bundle never pulls it in.
        const isNativeApp = typeof window !== 'undefined'
            && (window as any).Capacitor?.isNativePlatform?.() === true;

        if (isNativeApp) {
            try {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithGoogle({
                    scopes: [
                        'https://www.googleapis.com/auth/calendar.readonly',
                        'https://www.googleapis.com/auth/drive.readonly',
                        'https://www.googleapis.com/auth/drive.file',
                    ],
                });

                const idToken = result.credential?.idToken;
                const accessToken = result.credential?.accessToken;
                if (!idToken) throw new Error('Google returned no ID token');

                // Mirror the native session into the JS SDK, which is what the rest
                // of the app (Firestore reads and writes) authenticates with.
                const credential = GoogleAuthProvider.credential(idToken, accessToken);
                await signInWithCredential(auth, credential);

                if (accessToken) {
                    saveGoogleToken(accessToken);
                    saveDriveToken(accessToken);
                }
                localStorage.removeItem('last_auth_error');
                return;
            } catch (e: any) {
                localStorage.setItem('last_auth_error', `native: ${e?.code || 'unknown'}: ${e?.message || e}`);
                throw e;
            }
        }

        const storeGoogleTokenFromResult = (result: UserCredential) => {
            const credential = GoogleAuthProvider.credentialFromResult(result);
            const token = credential?.accessToken;
            if (token) {
                saveGoogleToken(token);
                saveDriveToken(token);
            }
        };

        const tryPopup = async () => {
            let result: UserCredential;
            if (auth.currentUser?.isAnonymous) {
                result = await linkWithPopup(auth.currentUser, googleProvider);
            } else {
                result = await signInWithPopup(auth, googleProvider);
            }
            storeGoogleTokenFromResult(result);
        };

        const tryRedirect = async () => {
            // Breadcrumb so that, on the way back, we can tell "user never tried"
            // apart from "redirect came back empty".
            localStorage.setItem('auth_redirect_pending', String(Date.now()));
            try {
                if (auth.currentUser?.isAnonymous) {
                    await linkWithRedirect(auth.currentUser, googleProvider);
                } else {
                    await signInWithRedirect(auth, googleProvider);
                }
            } catch (e: any) {
                localStorage.removeItem('auth_redirect_pending');
                localStorage.setItem('last_auth_error', `${e?.code || 'unknown'}: ${e?.message || e}`);
                throw e;
            }
        };

        // Try the popup FIRST, in every mode including the installed PWA.
        //
        // The redirect flow hands the browser off to a cross-origin handler on
        // firebaseapp.com and depends on state surviving that round trip, which is
        // exactly what has been failing here. The popup keeps the whole exchange in
        // one context and sidesteps that entirely. Standalone used to skip straight
        // to redirect on the assumption popups are always blocked; that assumption
        // cost us the one flow that does not depend on third-party storage. If the
        // popup really is blocked we still fall back, so this is never worse.
        try {
            await tryPopup();
            localStorage.removeItem('last_auth_error');
            return;
        } catch (e: any) {
            const code = e?.code || '';

            if (code === 'auth/credential-already-in-use') {
                // Google account already attached to a previous anonymous user.
                const credential = GoogleAuthProvider.credentialFromError(e);
                if (credential) {
                    await signInWithCredential(auth, credential);
                    localStorage.removeItem('last_auth_error');
                    return;
                }
            }

            const popupUnavailable =
                code === 'auth/popup-blocked' ||
                code === 'auth/popup-closed-by-user' ||
                code === 'auth/cancelled-popup-request' ||
                code === 'auth/popup-cancelled' ||
                code === 'auth/operation-not-supported-in-this-environment';

            if (!popupUnavailable) {
                localStorage.setItem('last_auth_error', `${code || 'unknown'}: ${e?.message || e}`);
                throw e;
            }

            // Note why we fell back, so a later redirect failure is traceable to
            // its cause rather than looking like the only thing that was tried.
            localStorage.setItem('auth_popup_fallback_reason', code || 'unknown');
            await tryRedirect();
        }
    }, []);

    const signOut = useCallback(async () => {
        if (!auth) return;
        await firebaseSignOut(auth);
    }, []);

    return {
        memories, tasks, courses, moodleToken, courseTerms, calendarEvents,
        addMemory, deleteMemory, bulkDeleteMemories, updateMemory,
        addTask, updateTask, deleteTask, addCourse, deleteCourse, saveMoodleToken,
        addCalendarEvent, deleteCalendarEvent,
        anthropicApiKey, saveAnthropicApiKey, notionToken, syncNotionToken,
        user, loading, isSyncing, hasUnsavedChanges, syncError, performSync,
        fetchFromCloud: performSync,
        signInWithGoogle, signOut,
        isAnonymous: user?.isAnonymous ?? true,
    };
};

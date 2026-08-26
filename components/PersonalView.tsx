
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
    Mic, Globe, ArrowLeft, Plus, Trash2,
    Volume2, Loader2, X, Package, Camera, FileText,
    ListTodo, StopCircle, Play, Tag, Headphones
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, PhysicalItemMemory, WebMemory, PodcastSnipMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import AddPhysicalItemModal from './AddPhysicalItemModal';
import AddWebMemoryModal from './AddWebMemoryModal';
import NotionPickerModal from './NotionPickerModal';
import SearchBar from './SearchBar';
import MemoryThumbnail from './MemoryThumbnail';
import TranscriptionUploader from './TranscriptionUploader';
import { generateSpeechFromText, askQuestion, AI_TIMEOUT_ERROR_MESSAGE, UNAVAILABLE_ERROR_MESSAGE } from '../services/geminiService';
import { extractUrlContent } from '../services/urlContentService';
import { getStoredNotionToken, fetchNotionPageContent } from '../services/notionService';
import type { NotionPage, NotionLink } from '../services/notionService';
import { decode, decodeAudioData } from '../utils/audio';
import { getLocationName } from '../utils/location';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { PlusCircleIcon } from './Icons';
import TopicsBrowserModal from './TopicsBrowserModal';
import { PODCAST_NO_TIMESTAMP_TAG, formatPodcastTimestamp } from '../utils/podcastFormat';

interface PersonalViewProps {
    memories: AnyMemory[];
    tasks: Task[];
    onSaveMemory: (memory: Omit<AnyMemory, 'id'|'date'>) => void | Promise<{ ok: boolean; reason?: string } | void>;
    onDeleteMemory: (id: string) => void;
    onUpdateMemory: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDeleteMemories: (ids: string[]) => void;
    onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    onUpdateTask: (id: string, updates: Partial<Task>) => void;
    onDeleteTask: (id: string) => void;
    webCategories: string[];
    onUpdateWebCategories: (cats: string[]) => void;
}

type SubView =
  | 'hub'
  | 'recording'
  | 'voiceNotes'
  | 'kanban'
  | 'physicalItems'
  | 'addItem'
  | 'webClips'
  | 'addWebClip'
  | 'podcastSnips'
  | 'documents'
  | 'scanning'
  | 'transcribe'
  | 'detail'
  | 'search'
  | 'favorites';

// --- Read-Aloud Button ---
const ReadAloudButton: React.FC<{ text: string }> = ({ text }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => () => { sourceRef.current?.stop(); audioCtxRef.current?.close(); }, []);

    const toggle = async () => {
        if (isPlaying) {
            sourceRef.current?.stop();
            setIsPlaying(false);
            return;
        }
        setIsLoading(true);
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioCtxRef.current = ctx;
            const b64 = await generateSpeechFromText(text);
            if (b64) {
                const buf = await decodeAudioData(decode(b64), ctx, 24000, 1);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.connect(ctx.destination);
                src.onended = () => setIsPlaying(false);
                src.start(0);
                sourceRef.current = src;
                setIsPlaying(true);
            }
        } catch (e) { console.error(e); }
        finally { setIsLoading(false); }
    };

    return (
        <button
            onClick={toggle}
            disabled={isLoading}
            aria-label={isPlaying ? 'Stop reading' : 'Read aloud'}
            className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-lg uppercase ${
                isPlaying ? 'bg-red-600 text-white' : 'bg-white text-[#001F3F]'
            }`}
        >
            {isLoading ? <Loader2 className="w-7 h-7 animate-spin" /> :
             isPlaying ? <StopCircle className="w-7 h-7" /> :
             <Volume2 className="w-7 h-7" />}
            {isPlaying ? 'Stop' : 'Read Aloud'}
        </button>
    );
};

// Last-resort backstop for the whole tap-to-play chain (fetch article →
// optionally summarize → generate audio). Each step already has its own
// timeout (extractUrlContent ~10s, askQuestion 15s, generateSpeechFromText
// 20s — see those files), so in the normal case one of those fires first and
// produces a specific error. This just guarantees that no matter what goes
// wrong — including a hang in a step that has no timeout of its own, e.g. an
// awaited call whose promise simply never settles on a flaky connection —
// the button can never spin for longer than this before showing an error.
const OVERALL_LISTEN_TIMEOUT_MS = 55000;

type LoadingStage = 'fetching' | 'summarizing' | 'speaking';

const LOADING_STAGE_LABEL: Record<LoadingStage, string> = {
    fetching: 'Fetching…',
    summarizing: 'Summarizing…',
    speaking: 'Generating audio…',
};

/**
 * Shared "Play" / "Play Gist" listen controls: "Play" reads the source text
 * in full, "Play Gist" summarizes that same text into a short spoken gist so
 * the two are genuinely different lengths, not near-duplicates of each
 * other. Generalized out of what used to be a Web-Clips-only component so
 * Podcast Snips can reuse the exact same TTS/gist/timeout machinery instead
 * of a second copy of it (this logic has been hardened across several
 * bug-fix passes this session — staged loading labels, an overall backstop
 * timeout, stale-run guarding, a visible error state).
 *
 * `getSourceText` is called fresh on every tap so a caller can lazily fetch
 * (and cache) richer text on first use — see WebClipListenButtons below —
 * while a caller with the full text already in hand (PodcastListenButtons)
 * can just resolve it immediately.
 */
const ListenButtons: React.FC<{
    getSourceText: () => Promise<{ text: string; isFallback: boolean }>;
    /** Shown under the buttons while something using a fallback text source is playing. */
    fallbackNote?: string;
}> = ({ getSourceText, fallbackNote }) => {
    const [playingMode, setPlayingMode] = useState<'full' | 'gist' | null>(null);
    const [loadingMode, setLoadingMode] = useState<'full' | 'gist' | null>(null);
    const [loadingStage, setLoadingStage] = useState<LoadingStage | null>(null);
    const [usingFallback, setUsingFallback] = useState(false);
    // Set on any failure (fetch, summarize, or speech step) so the button
    // always lands in a visible, explained state instead of just quietly
    // going back to "Play" with no indication anything happened.
    const [errorMode, setErrorMode] = useState<'full' | 'gist' | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    const gistCacheRef = useRef<string | null>(null);
    // Bumped on every toggle() call so a stale run (e.g. the overall timeout
    // firing after the user already tapped again, or a resolved promise from
    // a run that's no longer the current one) can recognize it's stale and
    // skip touching state instead of clobbering a newer run's result.
    const runIdRef = useRef(0);

    useEffect(() => () => { sourceRef.current?.stop(); audioCtxRef.current?.close(); }, []);

    const stop = () => {
        sourceRef.current?.stop();
        setPlayingMode(null);
    };

    const speak = async (text: string) => {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioCtxRef.current = ctx;
        const b64 = await generateSpeechFromText(text);
        if (!b64) return false;
        const buf = await decodeAudioData(decode(b64), ctx, 24000, 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = () => setPlayingMode(null);
        src.start(0);
        sourceRef.current = src;
        return true;
    };

    const toggle = async (mode: 'full' | 'gist') => {
        if (playingMode === mode) { stop(); return; }
        if (playingMode) stop();

        const runId = ++runIdRef.current;
        const isStale = () => runIdRef.current !== runId;

        setLoadingMode(mode);
        setLoadingStage('fetching');
        setErrorMode(null);
        setErrorMessage(null);

        let timedOut = false;
        const run = (async () => {
            const { text: sourceText, isFallback } = await getSourceText();
            if (isStale()) return;
            setUsingFallback(isFallback);
            let text = sourceText;
            if (mode === 'gist') {
                setLoadingStage('summarizing');
                if (!gistCacheRef.current) {
                    const summary = await askQuestion(
                        'Summarize this in 2-3 short spoken sentences — the gist only, no markdown, no headings.',
                        sourceText
                    );
                    // askQuestion never throws — on failure it resolves with one
                    // of these human-readable sentences instead. Treat those as
                    // failures here rather than caching and speaking "That took
                    // too long to generate" as if it were the article's gist.
                    if (summary === AI_TIMEOUT_ERROR_MESSAGE || summary === UNAVAILABLE_ERROR_MESSAGE) {
                        throw new Error(summary);
                    }
                    gistCacheRef.current = summary;
                }
                text = gistCacheRef.current;
            }
            if (isStale()) return;
            setLoadingStage('speaking');
            const started = await speak(text);
            if (isStale()) return;
            if (!started) throw new Error("Couldn't generate audio for that — please try again.");
            setPlayingMode(mode);
        })();

        const overallTimeout = new Promise<void>((_, reject) => {
            setTimeout(() => {
                timedOut = true;
                reject(new Error("That's taking too long — please try again."));
            }, OVERALL_LISTEN_TIMEOUT_MS);
        });

        try {
            await Promise.race([run, overallTimeout]);
        } catch (e: any) {
            console.error(e);
            if (isStale()) return; // a newer tap has already taken over — don't stomp on it
            setErrorMode(mode);
            setErrorMessage(timedOut ? "That's taking too long — please try again." : (e?.message || 'Something went wrong — please try again.'));
        } finally {
            if (!isStale()) {
                setLoadingMode(null);
                setLoadingStage(null);
            }
        }
    };

    const renderButton = (mode: 'full' | 'gist', label: string, playingLabel: string) => {
        const isPlaying = playingMode === mode;
        const isLoading = loadingMode === mode;
        return (
            <button
                onClick={() => toggle(mode)}
                // Disabled for BOTH buttons while anything is loading, including
                // the one currently loading itself — re-tapping it before
                // toggle()'s playingMode guard applies would kick off a second,
                // overlapping run (and a second audio stream once its speak()
                // resolves) rather than doing nothing.
                disabled={loadingMode !== null}
                aria-label={isPlaying ? `Stop ${playingLabel}` : label}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-black text-xs uppercase tracking-wide transition-all disabled:opacity-40 ${
                    isPlaying ? 'bg-red-600 text-white' : 'bg-white/10 text-white'
                }`}
            >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> :
                 isPlaying ? <StopCircle className="w-5 h-5" /> :
                 <Play className="w-5 h-5" />}
                {isLoading ? (loadingStage ? LOADING_STAGE_LABEL[loadingStage] : 'Loading…') : isPlaying ? 'Stop' : label}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
                {renderButton('full', 'Play', 'playback')}
                {renderButton('gist', 'Play Gist', 'the gist')}
            </div>
            {usingFallback && playingMode && fallbackNote && (
                <p className="text-[10px] text-white/40 font-bold uppercase tracking-wide text-center">
                    {fallbackNote}
                </p>
            )}
            {errorMode && errorMessage && (
                <p role="alert" className="text-[10px] text-red-400 font-bold uppercase tracking-wide text-center">
                    {errorMessage}
                </p>
            )}
        </div>
    );
};

/**
 * Listen controls for a saved web clip. "Full text" means `memory.fullText`
 * — the real article/page body fetched server-side at save time — when
 * present. Clips saved before that existed (or by a save path that didn't
 * fetch it) only have the short `content` stub; the first time either
 * button is pressed on one of those, this lazily fetches and caches the
 * full text via onUpdateMemory so the clip is upgraded for good, not stuck
 * re-reading the same short stub forever. If that fetch fails (or there's
 * no URL to fetch), it falls back to `content` and says so, rather than
 * silently pretending it's the full article.
 */
const WebClipListenButtons: React.FC<{
    memory: WebMemory;
    onUpdateMemory: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ memory, onUpdateMemory }) => {
    const fullTextRef = useRef<string | null>(memory.fullText ?? null);
    useEffect(() => { fullTextRef.current = memory.fullText ?? null; }, [memory.fullText]);

    const getSourceText = useCallback(async (): Promise<{ text: string; isFallback: boolean }> => {
        if (fullTextRef.current) return { text: fullTextRef.current, isFallback: false };
        if (memory.url) {
            const extracted = await extractUrlContent(memory.url);
            if (extracted?.text) {
                fullTextRef.current = extracted.text;
                onUpdateMemory(memory.id, { fullText: extracted.text, fullTextFetchedAt: new Date().toISOString() } as Partial<WebMemory>);
                return { text: extracted.text, isFallback: false };
            }
        }
        return { text: memory.content, isFallback: true };
    }, [memory, onUpdateMemory]);

    if (!memory.content.trim() && !memory.fullText?.trim()) return null;

    return (
        <ListenButtons
            getSourceText={getSourceText}
            fallbackNote="Couldn't fetch the full article — playing the saved note instead"
        />
    );
};

/**
 * Listen controls for a saved podcast snip. Unlike web clips, the transcript
 * saved on the memory IS already the full text of the captured window (see
 * netlify/functions/podcastSnip.ts) — no lazy fetch needed — so this just
 * wires it straight into the same shared TTS/gist/timeout machinery.
 */
const PodcastListenButtons: React.FC<{ memory: PodcastSnipMemory }> = ({ memory }) => {
    const getSourceText = useCallback(
        async (): Promise<{ text: string; isFallback: boolean }> => ({ text: memory.transcript, isFallback: false }),
        [memory.transcript]
    );

    if (!memory.transcript.trim()) return null;

    return <ListenButtons getSourceText={getSourceText} />;
};

// --- Main Component ---
const PersonalView: React.FC<PersonalViewProps> = ({
    memories, tasks,
    onSaveMemory, onDeleteMemory, onUpdateMemory, bulkDeleteMemories,
    onAddTask, onUpdateTask, onDeleteTask,
    webCategories, onUpdateWebCategories
}) => {
    const [subView, setSubView] = useState<SubView>('hub');
    const [showTopics, setShowTopics] = useState(false);
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);
    const showTopicsRef = useRef(false);
    const showNotionPickerRef = useRef(false);
    const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('install_card_dismissed') === '1');
    const { isInstallable, installApp, justInstalled } = useInstallPrompt();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;

    // Web clips state
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [filterTag, setFilterTag] = useState<string | null>(null);
    const [showTagManager, setShowTagManager] = useState(false);
    const [newTagInput, setNewTagInput] = useState('');
    const [showNotionPicker, setShowNotionPicker] = useState(false);
    const notionToken = useMemo(() => getStoredNotionToken(), [showNotionPicker]);
    const importedNotionUrls = useMemo(
        () => new Set((memories.filter(m => m.type === 'web') as WebMemory[]).map(m => m.url)),
        [memories]
    );

    const voiceNotes = useMemo(() => memories.filter(m => m.type === 'voice'), [memories]);
    const physicalItems = useMemo(() => memories.filter(m => m.type === 'item' || m.type === 'video'), [memories]);
    const webClips = useMemo(() => memories.filter(m => m.type === 'web'), [memories]);
    const podcastSnips = useMemo(() => memories.filter(m => m.type === 'podcast') as PodcastSnipMemory[], [memories]);
    const documents = useMemo(() => memories.filter(m => m.type === 'document'), [memories]);
    const personalTasks = useMemo(() => tasks.filter(t => t.category === 'personal'), [tasks]);

    const goBack = useCallback(() => setSubView('hub'), []);

    // Push a history entry whenever we leave the hub so the phone back button works
    const navigateTo = useCallback((view: SubView) => {
        if (view !== 'hub') window.history.pushState({ personalSubView: view }, '');
        setSubView(view);
    }, []);

    useEffect(() => { showTopicsRef.current = showTopics; }, [showTopics]);
    useEffect(() => { showNotionPickerRef.current = showNotionPicker; }, [showNotionPicker]);

    useEffect(() => {
        const handlePop = () => {
            if (showTopicsRef.current) { setShowTopics(false); return; }
            if (showNotionPickerRef.current) { setShowNotionPicker(false); return; }
            setSubView('hub');
            setSelectedItem(null);
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, []);

    const handleImportFromNotion = async (page: NotionPage) => {
        const token = getStoredNotionToken();
        let content = page.title;
        let fetchedFullText = false;
        if (token) {
            const text = await fetchNotionPageContent(token, page.id);
            if (text) { content = text; fetchedFullText = true; }
        }
        onSaveMemory({
            type: 'web',
            title: page.title || 'Untitled Notion Page',
            url: page.url,
            content,
            category: 'personal',
            // Already the real full page text from Notion's own API — storing it
            // as fullText too means Play uses it directly instead of trying (and
            // typically failing, since Notion page URLs sit behind a login wall)
            // to re-fetch the same content from the raw URL on first tap.
            ...(fetchedFullText && { fullText: content, fullTextFetchedAt: new Date().toISOString() }),
        } as Omit<WebMemory, 'id' | 'date'>);
    };

    /**
     * Saves a batch of external links found inside a Notion page as individual
     * web clips. Unlike a full page import, these aren't crawled/summarized —
     * the link's own text (or the URL itself) is stored as the clip's content,
     * which is honest about what was actually captured.
     */
    const handleImportNotionLinks = (links: NotionLink[]) => {
        for (const link of links) {
            onSaveMemory({
                type: 'web',
                title: link.label || link.url,
                url: link.url,
                content: link.label || link.url,
                category: 'personal',
            } as Omit<WebMemory, 'id' | 'date'>);
        }
    };

    const handleSaveVoiceNote = async (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        // Stay put if the write failed, so the Recorder can show why instead of
        // silently returning to a list that does not contain the note.
        const result = await onSaveMemory({ ...mem, category: 'personal' });
        if (result && result.ok === false) return result;
        navigateTo('voiceNotes');
        return result;
    };

    const openDetail = (item: AnyMemory) => {
        setSelectedItem(item);
        navigateTo('detail');
    };

    // ── Hub ────────────────────────────────────────────
    // ── Hub ────────────────────────────────────────────────
    if (subView === 'hub') {
        return (
            <>
            {showTopics && (
                <TopicsBrowserModal
                    memories={memories}
                    onSaveMemory={onSaveMemory}
                    onUpdateMemory={onUpdateMemory}
                    onClose={() => {
                        if (window.history.state?.personalModal === 'topics') window.history.back();
                        setShowTopics(false);
                    }}
                />
            )}
            <div className="flex flex-col gap-6">
                {/* Install App Banner */}
                {!isStandalone && !installDismissed && (
                    <div className={`w-full rounded-3xl p-5 relative flex flex-col gap-3 ${isInstallable ? 'bg-blue-600' : 'bg-[#0a3060]  border-2 border-blue-500'}`}>
                        <button
                            onClick={() => { localStorage.setItem('install_card_dismissed', '1'); setInstallDismissed(true); }}
                            className="absolute top-3 right-3 p-2 text-white/60 active:text-white"
                            aria-label="Dismiss"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <div className="flex items-center gap-3">
                            <PlusCircleIcon className="w-8 h-8 text-white flex-shrink-0" />
                            <span className="text-lg font-black text-white uppercase tracking-tight">Install App</span>
                        </div>
                        <p className="text-blue-100 text-sm font-bold leading-snug">
                            Unlock fullscreen mode and save links from Chrome's share menu.
                        </p>
                        {justInstalled ? (
                            <div className="bg-green-500/20 border-2 border-green-400 rounded-2xl p-4 space-y-1">
                                <p className="text-white font-black text-xs uppercase tracking-widest">Installed!</p>
                                <p className="text-blue-100 text-sm font-bold">Close this browser tab and open Second Brain from the icon on your home screen.</p>
                            </div>
                        ) : isInstallable ? (
                            <button
                                onClick={installApp}
                                className="w-full py-4 bg-white text-blue-600 rounded-2xl font-black text-base uppercase tracking-wide shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <PlusCircleIcon className="w-6 h-6" />
                                Install Now
                            </button>
                        ) : (
                            <div className="bg-white/10 rounded-2xl p-4 space-y-1">
                                <p className="text-white font-black text-xs uppercase tracking-widest mb-2">How to install:</p>
                                <p className="text-blue-100 text-sm font-bold">In Chrome tap <strong className="text-white">⋮</strong> → <strong className="text-white">Add to Home Screen</strong> → Install</p>
                                <p className="text-blue-200/70 text-xs mt-1">Then reopen from your home screen icon.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Big Mic CTA */}
                <button
                    onClick={() => navigateTo('recording')}
                    aria-label="Record a new thought or idea"
                    className="w-full h-40 bg-white text-[#001F3F] rounded-3xl flex flex-col items-center justify-center gap-3 shadow-2xl"
                >
                    <Mic className="w-20 h-20" strokeWidth={3} />
                    <span className="text-2xl font-black uppercase tracking-wide">Record a Thought</span>
                </button>

                {/* Section Grid */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Voice Notes */}
                    <button
                        onClick={() => navigateTo('voiceNotes')}
                        aria-label={`Voice Notes – ${voiceNotes.length} saved`}
                        className="h-36 bg-[#3B82F6] text-white rounded-3xl flex flex-col items-center justify-center gap-2"
                    >
                        <Mic className="w-12 h-12" strokeWidth={3} />
                        <span className="text-lg font-black uppercase">Voice Notes</span>
                        <span className="text-sm opacity-75">{voiceNotes.length} saved</span>
                    </button>

                    {/* Personal Kanban */}
                    <button
                        onClick={() => navigateTo('kanban')}
                        aria-label={`My Tasks – ${personalTasks.length} tasks`}
                        className="h-36 bg-[#10B981] text-white rounded-3xl flex flex-col items-center justify-center gap-2"
                    >
                        <ListTodo className="w-12 h-12" strokeWidth={3} />
                        <span className="text-lg font-black uppercase">My Tasks</span>
                        <span className="text-sm opacity-75">{personalTasks.length} tasks</span>
                    </button>

                    {/* Physical Items */}
                    <button
                        onClick={() => navigateTo('physicalItems')}
                        aria-label={`My Belongings – ${physicalItems.length} items`}
                        className="h-36 bg-[#F59E0B] text-[#001F3F] rounded-3xl flex flex-col items-center justify-center gap-2"
                    >
                        <Package className="w-12 h-12" strokeWidth={3} />
                        <span className="text-lg font-black uppercase">My Belongings</span>
                        <span className="text-sm opacity-60">{physicalItems.length} items</span>
                    </button>

                    {/* Web Clips */}
                    <button
                        onClick={() => navigateTo('webClips')}
                        aria-label={`Web Clips – ${webClips.length} saved`}
                        className="h-36 bg-[#8B5CF6] text-white rounded-3xl flex flex-col items-center justify-center gap-2"
                    >
                        <Globe className="w-12 h-12" strokeWidth={3} />
                        <span className="text-lg font-black uppercase">Web Clips</span>
                        <span className="text-sm opacity-75">{webClips.length} saved</span>
                    </button>

                </div>

                {/* Podcast Snips – full width */}
                <button
                    onClick={() => navigateTo('podcastSnips')}
                    aria-label={`Podcast Snips – ${podcastSnips.length} saved`}
                    className="w-full h-28 bg-[#DB2777] text-white rounded-3xl flex items-center justify-center gap-4"
                >
                    <Headphones className="w-14 h-14" strokeWidth={3} />
                    <div className="text-left">
                        <div className="text-xl font-black uppercase">Podcast Snips</div>
                        <div className="text-sm opacity-75">{podcastSnips.length} saved • Share a moment from Spotify</div>
                    </div>
                </button>

                {/* Scan Document – full width */}
                <button
                    onClick={() => navigateTo('scanning')}
                    aria-label={`Scan or upload document – ${documents.length} scanned`}
                    className="w-full h-28 bg-[#EF4444] text-white rounded-3xl flex items-center justify-center gap-4"
                >
                    <Camera className="w-14 h-14" strokeWidth={3} />
                    <div className="text-left">
                        <div className="text-xl font-black uppercase">Scan or Upload Doc</div>
                        <div className="text-sm opacity-75">{documents.length} documents • Scan, Upload or OCR</div>
                    </div>
                </button>

                {/* Topics – full width */}
                <button
                    onClick={() => { window.history.pushState({ personalModal: 'topics' }, ''); setShowTopics(true); }}
                    aria-label="Browse memories by topic"
                    className="w-full h-28 bg-[#0891B2] text-white rounded-3xl flex items-center justify-center gap-4"
                >
                    <Tag className="w-14 h-14" strokeWidth={3} />
                    <div className="text-left">
                        <div className="text-xl font-black uppercase">Browse by Topic</div>
                        <div className="text-sm opacity-75">AI-tagged • Research with Claude</div>
                    </div>
                </button>

                {/* Notion Import – full width, only when connected */}
                {notionToken && (
                    <button
                        onClick={() => { window.history.pushState({ personalModal: 'notionPicker' }, ''); setShowNotionPicker(true); }}
                        aria-label="Import from Notion"
                        className="w-full h-20 bg-[#2D2D2D] text-white rounded-3xl flex items-center justify-center gap-4 border-2 border-white/10"
                    >
                        <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shrink-0">
                            <span className="text-white font-black text-xl leading-none">N</span>
                        </div>
                        <div className="text-left">
                            <div className="text-lg font-black uppercase">Import from Notion</div>
                            <div className="text-sm opacity-60">Browse and import your pages</div>
                        </div>
                    </button>
                )}
            </div>
            {showNotionPicker && notionToken && (
                <NotionPickerModal
                    token={notionToken}
                    onClose={() => {
                        if (window.history.state?.personalModal === 'notionPicker') window.history.back();
                        setShowNotionPicker(false);
                    }}
                    onImport={page => { handleImportFromNotion(page); }}
                    onImportLinks={handleImportNotionLinks}
                    importedUrls={importedNotionUrls}
                />
            )}
            </>
        );
    }

    // ── Record new thought ───────────────────────────────────────
    // ── Record new thought ───────────────────────────────────────────────
    if (subView === 'recording') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex justify-between items-center">
                    <h2 className="text-2xl font-black uppercase">New Thought</h2>
                    <button onClick={goBack} aria-label="Cancel" className="btn-outline w-20 h-14">
                        <X size={32} strokeWidth={3} />
                    </button>
                </header>
                <Recorder
                    onSave={handleSaveVoiceNote}
                    onCancel={goBack}
                    titlePlaceholder={`Thought – ${new Date().toLocaleDateString()}`}
                    saveButtonText="Save Thought"
                    audioOnly={true}
                />
            </div>
        );
    }

    // ── Voice Notes list ────────────────────────────────────
    // ── Voice Notes list ──────────────────────────────────────────────────
    if (subView === 'voiceNotes') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">Voice Notes</h2>
                    <button
                        onClick={() => navigateTo('recording')}
                        aria-label="Record new voice note"
                        className="btn-primary w-20 h-14"
                    >
                        <Plus size={32} strokeWidth={3} />
                    </button>
                </header>
                <div className="flex flex-col gap-4">
                    {voiceNotes.map(mem => (
                        <button
                            key={mem.id}
                            onClick={() => openDetail(mem)}
                            className="card-brutal flex items-center gap-5 text-left hover:bg-white/5"
                        >
                            <Mic size={36} strokeWidth={3} className="text-[#3B82F6] flex-shrink-0" />
                            <div className="flex-grow overflow-hidden">
                                <p className="text-xl font-black truncate">{mem.title}</p>
                                <p className="text-sm text-[#60A5FA] uppercase tracking-widest">
                                    {new Date(mem.date).toLocaleDateString()}
                                </p>
                            </div>
                        </button>
                    ))}
                    {voiceNotes.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Mic size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">No voice notes yet</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Personal Kanban ──────────────────────────────────────────
    // ── Personal Kanban ──────────────────────────────────────────────────────────
    if (subView === 'kanban') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase">My Tasks</h2>
                </header>
                <div className="h-[70vh]">
                    <KanbanBoard
                        tasks={personalTasks}
                        category="personal"
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onAddTask={(task) => onAddTask({ ...task, category: 'personal' })}
                        memories={memories}
                        onOpenMemory={openDetail}
                    />
                </div>
            </div>
        );
    }

    // ── Physical Items list ─────────────────────────────────────
    // ── Physical Items list ───────────────────────────────────────────────────
    if (subView === 'physicalItems') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">My Belongings</h2>
                    <button
                        onClick={() => navigateTo('addItem')}
                        aria-label="Add physical item"
                        className="btn-primary w-20 h-14"
                    >
                        <Camera size={32} strokeWidth={3} />
                    </button>
                </header>
                <button
                    onClick={() => navigateTo('addItem')}
                    aria-label="Photograph a belonging"
                    className="w-full h-32 bg-[#F59E0B] text-[#001F3F] rounded-3xl flex items-center justify-center gap-4"
                >
                    <Camera className="w-14 h-14" strokeWidth={3} />
                    <span className="text-xl font-black uppercase">Photograph a Belonging</span>
                </button>
                <div className="flex flex-col gap-4">
                    {physicalItems.map(mem => (
                        <button
                            key={mem.id}
                            onClick={() => openDetail(mem)}
                            className="card-brutal flex items-center gap-5 text-left hover:bg-white/5"
                        >
                            {(mem as PhysicalItemMemory).imageDataUrl ? (
                                <img
                                    src={(mem as PhysicalItemMemory).imageDataUrl}
                                    className="w-16 h-16 object-cover rounded-xl border-2 border-white/20 flex-shrink-0"
                                    alt=""
                                />
                            ) : (
                                <Package size={36} strokeWidth={3} className="text-[#F59E0B] flex-shrink-0" />
                            )}
                            <div className="flex-grow overflow-hidden">
                                <p className="text-xl font-black truncate">{mem.title}</p>
                                <p className="text-sm text-[#60A5FA] uppercase tracking-widest">
                                    {mem.location && (mem as any).locationName
                                        ? (mem as any).locationName
                                        : mem.location
                                        ? `${mem.location.latitude.toFixed(4)}, ${mem.location.longitude.toFixed(4)}`
                                        : 'Location unknown'
                                    } • {new Date(mem.date).toLocaleDateString()}
                                </p>
                            </div>
                        </button>
                    ))}
                    {physicalItems.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Package size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">No items tracked yet</p>
                            <p className="text-sm mt-2">Tap the camera button above to start</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Add Physical Item ──────────────────────────────────────────
    // ── Add Physical Item ──────────────────────────────────────────────────────────
    if (subView === 'addItem') {
        return (
            <AddPhysicalItemModal
                onClose={() => navigateTo('physicalItems')}
                onSave={async (mem) => {
                    const locationName = await getLocationName();
                    onSaveMemory({ ...mem, category: 'personal', ...(locationName && { locationName }) } as any);
                    navigateTo('physicalItems');
                }}
            />
        );
    }

    // ── Web Clips list ───────────────────────────────────────────
    // ── Web Clips list ────────────────────────────────────────────────────────────
    if (subView === 'webClips') {
        const sortedClips = [...webClips].sort((a, b) => {
            const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
            return sortOrder === 'newest' ? -diff : diff;
        });
        const filteredClips = filterTag
            ? sortedClips.filter(m => m.tags?.includes(filterTag))
            : sortedClips;

        const addTag = () => {
            const t = newTagInput.trim();
            if (t && !webCategories.includes(t)) {
                onUpdateWebCategories([...webCategories, t]);
            }
            setNewTagInput('');
        };
        const removeTag = (t: string) => {
            onUpdateWebCategories(webCategories.filter(c => c !== t));
            if (filterTag === t) setFilterTag(null);
        };

        return (
            <div className="flex flex-col gap-4">
                {showNotionPicker && notionToken && (
                    <NotionPickerModal
                        token={notionToken}
                        onClose={() => {
                            if (window.history.state?.personalModal === 'notionPicker') window.history.back();
                            setShowNotionPicker(false);
                        }}
                        onImport={page => { handleImportFromNotion(page); }}
                        onImportLinks={handleImportNotionLinks}
                        importedUrls={importedNotionUrls}
                    />
                )}
                {/* Header */}
                <header className="flex items-center gap-3">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">Web Clips</h2>
                    {/* Sort toggle */}
                    <button
                        onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
                        className="h-14 px-3 bg-white/10 rounded-2xl text-xs font-black uppercase tracking-wide flex items-center gap-1"
                        aria-label="Toggle sort order"
                    >
                        {sortOrder === 'newest' ? '↓ New' : '↑ Old'}
                    </button>
                    {/* Tag manager toggle */}
                    <button
                        onClick={() => setShowTagManager(v => !v)}
                        className={`h-14 px-3 rounded-2xl text-xs font-black uppercase tracking-wide flex items-center gap-1 ${showTagManager ? 'bg-[#8B5CF6] text-white' : 'bg-white/10'}`}
                        aria-label="Manage tags"
                    >
                        Tags
                    </button>
                    <button
                        onClick={() => navigateTo('addWebClip')}
                        aria-label="Add web clip"
                        className="btn-primary w-14 h-14"
                    >
                        <Plus size={28} strokeWidth={3} />
                    </button>
                </header>

                {/* Tag manager panel */}
                {showTagManager && (
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-4 flex flex-col gap-3">
                        <p className="text-xs font-black uppercase tracking-widest text-white/50">Your Categories</p>
                        <div className="flex flex-wrap gap-2">
                            {webCategories.map(t => (
                                <span key={t} className="flex items-center gap-1 bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#C4B5FD] rounded-full px-3 py-1 text-sm font-bold">
                                    {t}
                                    <button onClick={() => removeTag(t)} className="ml-1 text-white/40 active:text-white" aria-label={`Remove ${t}`}>×</button>
                                </span>
                            ))}
                            {webCategories.length === 0 && <p className="text-white/30 text-sm">No categories yet</p>}
                        </div>
                        <div className="flex gap-2">
                            <input
                                value={newTagInput}
                                onChange={e => setNewTagInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addTag()}
                                placeholder="New category name..."
                                className="flex-grow bg-white/10 rounded-2xl px-4 py-3 text-sm font-bold text-white placeholder:text-white/30 outline-none"
                            />
                            <button
                                onClick={addTag}
                                disabled={!newTagInput.trim()}
                                className="px-4 py-3 bg-[#8B5CF6] text-white rounded-2xl text-sm font-black disabled:opacity-30"
                            >
                                Add
                            </button>
                        </div>
                        <p className="text-white/30 text-xs">AI will auto-assign these categories when you share links to the app.</p>
                    </div>
                )}

                {/* Notion quick import */}
                {notionToken && (
                    <button
                        onClick={() => { window.history.pushState({ personalModal: 'notionPicker' }, ''); setShowNotionPicker(true); }}
                        className="flex items-center gap-3 px-4 py-3 bg-white/5 rounded-2xl border-2 border-white/10 w-full text-left active:scale-95 transition-transform"
                        aria-label="Import from Notion"
                    >
                        <div className="w-6 h-6 bg-black rounded-md flex items-center justify-center shrink-0">
                            <span className="text-white font-black text-sm leading-none">N</span>
                        </div>
                        <span className="text-xs font-black text-gray-300 uppercase tracking-widest">Import from Notion</span>
                    </button>
                )}

                {/* Tag filter pills */}
                {webCategories.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        <button
                            onClick={() => setFilterTag(null)}
                            className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide ${filterTag === null ? 'bg-[#8B5CF6] text-white' : 'bg-white/10 text-white/60'}`}
                        >
                            All
                        </button>
                        {webCategories.map(t => (
                            <button
                                key={t}
                                onClick={() => setFilterTag(f => f === t ? null : t)}
                                className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide ${filterTag === t ? 'bg-[#8B5CF6] text-white' : 'bg-white/10 text-white/60'}`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                )}

                {/* Clips list */}
                <div className="flex flex-col gap-4">
                    {filteredClips.map(mem => {
                        const w = mem as WebMemory;
                        const clipTags = (mem.tags || []).filter(t => webCategories.includes(t));
                        return (
                            <div key={mem.id} className="card-brutal flex flex-col gap-3">
                                <div className="flex items-start gap-4">
                                    <Globe size={32} strokeWidth={3} className="text-[#8B5CF6] flex-shrink-0 mt-1" />
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-lg font-black leading-tight">{mem.title}</p>
                                        <p className="text-xs text-[#60A5FA] uppercase tracking-widest mt-0.5">
                                            {new Date(mem.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </p>
                                        {w.content && (
                                            <p className="mt-2 text-sm text-white/70 line-clamp-2">{w.content}</p>
                                        )}
                                        {clipTags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {clipTags.map(t => (
                                                    <span key={t} className="bg-[#8B5CF6]/25 text-[#C4B5FD] rounded-full px-2 py-0.5 text-xs font-bold">
                                                        {t}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => onDeleteMemory(mem.id)}
                                        aria-label="Delete clip"
                                        className="p-3 bg-white/10 rounded-xl flex-shrink-0"
                                    >
                                        <Trash2 size={20} strokeWidth={3} />
                                    </button>
                                </div>
                                <WebClipListenButtons memory={w} onUpdateMemory={onUpdateMemory} />
                                <a
                                    href={w.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${mem.title}`}
                                    className="w-full h-12 bg-[#8B5CF6] text-white rounded-2xl flex items-center justify-center font-black uppercase tracking-wide"
                                >
                                    Open Link
                                </a>
                            </div>
                        );
                    })}
                    {filteredClips.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Globe size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">{filterTag ? `No clips tagged "${filterTag}"` : 'No web clips yet'}</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Add Web Clip ───────────────────────────────────────────────
    // ── Add Web Clip ───────────────────────────────────────────────────────────────
    if (subView === 'addWebClip') {
        return (
            <AddWebMemoryModal
                onClose={() => navigateTo('webClips')}
                onSave={(mem) => {
                    onSaveMemory({ ...mem, category: 'personal' });
                    navigateTo('webClips');
                }}
            />
        );
    }

    // ── Podcast Snips list ─────────────────────────────────────────
    // ── Podcast Snips list ─────────────────────────────────────────────────────────
    if (subView === 'podcastSnips') {
        const sortedSnips = [...podcastSnips].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return (
            <div className="flex flex-col gap-4">
                <header className="flex items-center gap-3">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">Podcast Snips</h2>
                </header>
                <p className="text-white/50 text-sm font-bold">
                    Use Spotify's Share menu on an episode → Second Brain to save a moment here.
                </p>
                <div className="flex flex-col gap-4">
                    {sortedSnips.map(mem => {
                        const fromStart = mem.tags?.includes(PODCAST_NO_TIMESTAMP_TAG);
                        return (
                            <div key={mem.id} className="card-brutal flex flex-col gap-3">
                                <div className="flex items-start gap-4">
                                    <Headphones size={32} strokeWidth={3} className="text-[#DB2777] flex-shrink-0 mt-1" />
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-xs text-[#F472B6] uppercase tracking-widest font-black truncate">{mem.showName}</p>
                                        <p className="text-lg font-black leading-tight">{mem.episodeTitle}</p>
                                        <p className="text-xs text-[#60A5FA] uppercase tracking-widest mt-0.5">
                                            {fromStart ? 'From the start (no timestamp shared)' : `At ${formatPodcastTimestamp(mem.timestampSeconds)}`}
                                            {' · '}
                                            {new Date(mem.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onDeleteMemory(mem.id)}
                                        aria-label={`Delete podcast snip: ${mem.episodeTitle}`}
                                        className="p-3 bg-white/10 rounded-xl flex-shrink-0"
                                    >
                                        <Trash2 size={20} strokeWidth={3} />
                                    </button>
                                </div>
                                {mem.transcript && (
                                    <p className="text-sm text-white/70 line-clamp-2">{mem.transcript}</p>
                                )}
                                <PodcastListenButtons memory={mem} />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => openDetail(mem)}
                                        aria-label={`View full transcript and ask AI about ${mem.episodeTitle}`}
                                        className="flex-1 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center font-black text-xs uppercase tracking-wide"
                                    >
                                        View & Ask AI
                                    </button>
                                    <a
                                        href={mem.episodeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Open ${mem.episodeTitle} on Spotify`}
                                        className="flex-1 h-12 bg-[#DB2777] text-white rounded-2xl flex items-center justify-center font-black text-xs uppercase tracking-wide"
                                    >
                                        Open Episode
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                    {sortedSnips.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Headphones size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">No podcast snips yet</p>
                            <p className="text-sm mt-2 max-w-xs mx-auto">Share a moment from Spotify's Share menu to save it here.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Documents list ───────────────────────────────────────────
    // ── Documents list ───────────────────────────────────────────────────────────
    if (subView === 'documents') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">Documents</h2>
                    <button
                        onClick={() => navigateTo('scanning')}
                        aria-label="Scan new document"
                        className="btn-primary w-20 h-14"
                    >
                        <Camera size={32} strokeWidth={3} />
                    </button>
                </header>
                <div className="flex flex-col gap-4">
                    {documents.map(mem => {
                        const d = mem as DocumentMemory;
                        return (
                            <div key={mem.id} className="card-brutal flex flex-col gap-4">
                                <div className="flex items-center gap-4">
                                    <FileText size={36} strokeWidth={3} className="text-[#EF4444] flex-shrink-0" />
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-xl font-black truncate">{mem.title}</p>
                                        <p className="text-sm text-[#60A5FA] uppercase tracking-widest">
                                            {new Date(mem.date).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onDeleteMemory(mem.id)}
                                        aria-label="Delete document"
                                        className="p-3 bg-white/10 rounded-xl"
                                    >
                                        <Trash2 size={24} strokeWidth={3} />
                                    </button>
                                </div>
                                {d.extractedText && (
                                    <ReadAloudButton text={d.extractedText} />
                                )}
                                <button
                                    onClick={() => openDetail(mem)}
                                    className="w-full h-14 bg-white/10 text-white rounded-2xl font-black text-lg uppercase"
                                >
                                    View & Ask AI
                                </button>
                            </div>
                        );
                    })}
                    {documents.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <FileText size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">No documents yet</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Scanning ─────────────────────────────────────────────────
    // ── Scanning ─────────────────────────────────────────────────────────────
    if (subView === 'scanning') {
        return (
            <AddDocumentModal
                onClose={() => navigateTo('documents')}
                onSave={(mem) => {
                    onSaveMemory({ ...mem, category: 'personal' });
                    navigateTo('documents');
                }}
            />
        );
    }

    // ── Transcribe ────────────────────────────────────────────────
    // ── Transcribe ────────────────────────────────────────────────────────────────
    if (subView === 'transcribe') {
        return (
            <div className="flex flex-col h-full p-4 sm:p-6 overflow-y-auto bg-gray-900">
                <button
                    onClick={goBack}
                    className="mb-6 flex items-center gap-2 text-white/70 hover:text-white transition-colors"
                >
                    <ArrowLeft size={24} strokeWidth={3} />
                    <span className="font-bold uppercase">Back</span>
                </button>
                <TranscriptionUploader />
            </div>
        );
    }

    // ── Detail view ───────────────────────────────────────────────
    // ── Detail view ─────────────────────────────────────────────────────────────
    if (subView === 'detail' && selectedItem) {
        const prevView: SubView =
            selectedItem.type === 'voice' ? 'voiceNotes' :
            selectedItem.type === 'item' || selectedItem.type === 'video' ? 'physicalItems' :
            selectedItem.type === 'web' ? 'webClips' :
            selectedItem.type === 'podcast' ? 'podcastSnips' :
            selectedItem.type === 'document' ? 'documents' : 'hub';

        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={() => setSubView(prevView)} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow truncate">{selectedItem.title}</h2>
                    <button
                        onClick={() => { onDeleteMemory(selectedItem.id); setSubView(prevView); }}
                        aria-label="Delete"
                        className="p-3 bg-white/10 rounded-xl border-2 border-white/20"
                    >
                        <Trash2 size={28} strokeWidth={3} />
                    </button>
                </header>

                <div className="card-brutal">
                    {selectedItem.type === 'voice' && (
                        <div className="space-y-5">
                            {(selectedItem as VoiceMemory).audioDataUrl && (
                                <audio src={(selectedItem as VoiceMemory).audioDataUrl} controls className="w-full" />
                            )}
                            {(selectedItem as VoiceMemory).summary && (
                                <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 p-4 rounded-2xl border-2 border-blue-500/30">
                                    <h3 className="font-black text-blue-400 uppercase text-sm tracking-widest mb-3">Summary</h3>
                                    <p className="text-white leading-relaxed whitespace-pre-wrap">{(selectedItem as VoiceMemory).summary}</p>
                                </div>
                            )}
                            {(selectedItem as VoiceMemory).actionItems && (selectedItem as VoiceMemory).actionItems!.length > 0 && (
                                <div className="bg-gradient-to-br from-orange-900/40 to-orange-800/20 p-4 rounded-2xl border-2 border-orange-500/30">
                                    <h3 className="font-black text-orange-400 uppercase text-sm tracking-widest mb-3">Action Items</h3>
                                    <ul className="space-y-2">
                                        {(selectedItem as VoiceMemory).actionItems!.map((item, idx) => (
                                            <li key={idx} className="flex items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={item.done}
                                                    onChange={() => {
                                                        if (selectedItem) {
                                                            onUpdateMemory(selectedItem.id, { actionItems: selectedItem.actionItems?.map((ai, i) => i === idx ? { ...ai, done: !ai.done } : ai) });
                                                        }
                                                    }}
                                                    className="w-5 h-5 rounded accent-orange-400 mt-0.5 cursor-pointer"
                                                />
                                                <span className={item.done ? 'line-through text-gray-400' : 'text-white'}>{item.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div>
                                <h3 className="font-black text-gray-400 uppercase text-sm tracking-widest mb-3">Full Transcript</h3>
                                <p className="text-xl leading-relaxed">{(selectedItem as VoiceMemory).transcript}</p>
                            </div>
                            {(selectedItem as VoiceMemory).transcript && (
                                <ReadAloudButton text={(selectedItem as VoiceMemory).transcript} />
                            )}
                        </div>
                    )}
                    {selectedItem.type === 'item' && (
                        <div className="space-y-5">
                            {(selectedItem as PhysicalItemMemory).imageDataUrl && (
                                <img
                                    src={(selectedItem as PhysicalItemMemory).imageDataUrl}
                                    className="w-full rounded-2xl border-2 border-white/20"
                                    alt={selectedItem.title}
                                />
                            )}
                            <p className="text-xl leading-relaxed">{(selectedItem as PhysicalItemMemory).description}</p>
                            {(selectedItem as any).locationName && (
                                <p className="text-sm text-[#60A5FA] uppercase">
                                    📍 {(selectedItem as any).locationName}
                                </p>
                            )}
                        </div>
                    )}
                    {selectedItem.type === 'web' && (
                        <div className="space-y-5">
                            {(() => {
                                const web = selectedItem as WebMemory;
                                // Show the note separately only when it's actually distinct from
                                // the full text — e.g. Notion page imports set `content` to the
                                // full page already, so showing both would just repeat it.
                                const showNoteSeparately = web.content && web.fullText && web.content !== web.fullText;
                                return (
                                    <>
                                        {showNoteSeparately && (
                                            <p className="text-white/60 text-sm italic leading-relaxed">{web.content}</p>
                                        )}
                                        <p className="text-xl leading-relaxed whitespace-pre-wrap">{web.fullText || web.content}</p>
                                    </>
                                );
                            })()}
                            <WebClipListenButtons memory={selectedItem as WebMemory} onUpdateMemory={onUpdateMemory} />
                            <a
                                href={(selectedItem as WebMemory).url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full h-14 bg-[#8B5CF6] text-white rounded-2xl flex items-center justify-center font-black text-lg uppercase"
                            >
                                Open Link
                            </a>
                        </div>
                    )}
                    {selectedItem.type === 'document' && (
                        <div className="space-y-5">
                            {(selectedItem as DocumentMemory).imageDataUrl && (
                                <img
                                    src={(selectedItem as DocumentMemory).imageDataUrl}
                                    className="w-full rounded-2xl border-2 border-white/20"
                                    alt={selectedItem.title}
                                />
                            )}
                            <p className="text-xl leading-relaxed whitespace-pre-wrap">
                                {(selectedItem as DocumentMemory).extractedText}
                            </p>
                            <ReadAloudButton text={(selectedItem as DocumentMemory).extractedText} />
                        </div>
                    )}
                    {selectedItem.type === 'podcast' && (() => {
                        const p = selectedItem as PodcastSnipMemory;
                        const fromStart = p.tags?.includes(PODCAST_NO_TIMESTAMP_TAG);
                        return (
                            <div className="space-y-5">
                                <div className="space-y-1">
                                    <p className="text-xs text-[#F472B6] uppercase tracking-widest font-black">{p.showName}</p>
                                    <p className="text-sm text-[#60A5FA] uppercase tracking-widest font-bold">
                                        {fromStart
                                            ? 'Captured from the start — the shared link had no specific timestamp'
                                            : `Captured around ${formatPodcastTimestamp(p.timestampSeconds)}`}
                                    </p>
                                    <p className="text-xs text-white/40 uppercase tracking-widest">
                                        Transcribed window: {formatPodcastTimestamp(p.audioWindowStartSeconds)}–{formatPodcastTimestamp(p.audioWindowEndSeconds)}
                                        {p.bitrateEstimated ? ' (approximate)' : ''}
                                    </p>
                                </div>
                                {!p.rangeSupported && (
                                    <p className="text-xs text-yellow-300/80 font-bold bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
                                        The audio host didn't support fetching just this window, so this transcript may cover more of the episode than just this moment.
                                    </p>
                                )}
                                <p className="text-xl leading-relaxed whitespace-pre-wrap">{p.transcript}</p>
                                <PodcastListenButtons memory={p} />
                                <a
                                    href={p.episodeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-full h-14 bg-[#DB2777] text-white rounded-2xl flex items-center justify-center font-black text-lg uppercase"
                                >
                                    Open Episode
                                </a>
                            </div>
                        );
                    })()}
                </div>

                <div className="h-[40vh] card-brutal p-0 overflow-hidden">
                    <QASession memories={[selectedItem]} tasks={[]} />
                </div>
            </div>
        );
    }

    return null;
};

export default PersonalView;

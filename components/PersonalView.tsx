
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
    Mic, Globe, ArrowLeft, Plus, Trash2,
    Volume2, Loader2, X, Package, Camera, FileText,
    ListTodo, StopCircle, Play
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, PhysicalItemMemory, WebMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import AddPhysicalItemModal from './AddPhysicalItemModal';
import AddWebMemoryModal from './AddWebMemoryModal';
import NotionPickerModal from './NotionPickerModal';
import { generateSpeechFromText } from '../services/geminiService';
import { getStoredNotionToken, fetchNotionPageContent } from '../services/notionService';
import type { NotionPage } from '../services/notionService';
import { decode, decodeAudioData } from '../utils/audio';
import { getLocationName } from '../utils/location';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { PlusCircleIcon } from './Icons';

interface PersonalViewProps {
    memories: AnyMemory[];
    tasks: Task[];
    onSaveMemory: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
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
  | 'documents'
  | 'scanning'
  | 'detail';

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

// --- Main Component ---
const PersonalView: React.FC<PersonalViewProps> = ({
    memories, tasks,
    onSaveMemory, onDeleteMemory, onUpdateMemory, bulkDeleteMemories,
    onAddTask, onUpdateTask, onDeleteTask,
    webCategories, onUpdateWebCategories
}) => {
    const [subView, setSubView] = useState<SubView>('hub');
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);
    const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('install_card_dismissed') === '1');
    const { isInstallable, installApp } = useInstallPrompt();
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
    const documents = useMemo(() => memories.filter(m => m.type === 'document'), [memories]);
    const personalTasks = useMemo(() => tasks.filter(t => t.category === 'personal'), [tasks]);

    const goBack = useCallback(() => setSubView('hub'), []);

    // Push a history entry whenever we leave the hub so the phone back button works
    const navigateTo = useCallback((view: SubView) => {
        if (view !== 'hub') window.history.pushState({ personalSubView: view }, '');
        setSubView(view);
    }, []);

    useEffect(() => {
        const handlePop = () => {
            setSubView('hub');
            setSelectedItem(null);
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, []);

    const handleImportFromNotion = async (page: NotionPage) => {
        const token = getStoredNotionToken();
        let content = page.title;
        if (token) {
            const text = await fetchNotionPageContent(token, page.id);
            if (text) content = text;
        }
        onSaveMemory({
            type: 'web',
            title: page.title || 'Untitled Notion Page',
            url: page.url,
            content,
            category: 'personal',
        } as Omit<WebMemory, 'id' | 'date'>);
    };

    const handleSaveVoiceNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSaveMemory({ ...mem, category: 'personal' });
        navigateTo('voiceNotes');
    };

    const openDetail = (item: AnyMemory) => {
        setSelectedItem(item);
        navigateTo('detail');
    };

    // ── Hub ────────────────────────────────────────────
    if (subView === 'hub') {
        return (
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
                        {isInstallable ? (
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

                {/* Scan Document – full width */}
                <button
                    onClick={() => navigateTo('scanning')}
                    aria-label={`Scan Document – ${documents.length} scanned`}
                    className="w-full h-28 bg-[#EF4444] text-white rounded-3xl flex items-center justify-center gap-4"
                >
                    <Camera className="w-14 h-14" strokeWidth={3} />
                    <div className="text-left">
                        <div className="text-xl font-black uppercase">Scan Document / Mail</div>
                        <div className="text-sm opacity-75">{documents.length} scanned • OCR + Read Aloud</div>
                    </div>
                </button>
            </div>
        );
    }

    // ── Record new thought ───────────────────────────────────────
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
                        onClose={() => setShowNotionPicker(false)}
                        onImport={page => { handleImportFromNotion(page); }}
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
                        onClick={() => setShowNotionPicker(true)}
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

    // ── Documents list ───────────────────────────────────────────
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

    // ── Detail view ───────────────────────────────────────────────
    if (subView === 'detail' && selectedItem) {
        const prevView: SubView =
            selectedItem.type === 'voice' ? 'voiceNotes' :
            selectedItem.type === 'item' || selectedItem.type === 'video' ? 'physicalItems' :
            selectedItem.type === 'web' ? 'webClips' :
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
                            <p className="text-xl leading-relaxed">{(selectedItem as VoiceMemory).transcript}</p>
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
                            <p className="text-xl leading-relaxed">{(selectedItem as WebMemory).content}</p>
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

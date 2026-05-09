
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
import { generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getLocationName } from '../utils/location';

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
    onAddTask, onUpdateTask, onDeleteTask
}) => {
    const [subView, setSubView] = useState<SubView>('hub');
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);

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

    const handleSaveVoiceNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSaveMemory({ ...mem, category: 'personal' });
        navigateTo('voiceNotes');
    };

    const openDetail = (item: AnyMemory) => {
        setSelectedItem(item);
        navigateTo('detail');
    };

    // ── Hub ──────────────────────────────────────────────
    if (subView === 'hub') {
        return (
            <div className="flex flex-col gap-6">
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

    // ── Record new thought ───────────────────────────────
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

    // ── Voice Notes list ────────────────────────────────
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

    // ── Personal Kanban ──────────────────────────────────
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

    // ── Physical Items list ─────────────────────────────
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

    // ── Add Physical Item ────────────────────────────────
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

    // ── Web Clips list ───────────────────────────────────
    if (subView === 'webClips') {
        return (
            <div className="flex flex-col gap-6">
                <header className="flex items-center gap-4">
                    <button onClick={goBack} aria-label="Back" className="btn-outline w-20 h-14">
                        <ArrowLeft size={32} strokeWidth={3} />
                    </button>
                    <h2 className="text-2xl font-black uppercase flex-grow">Web Clips</h2>
                    <button
                        onClick={() => navigateTo('addWebClip')}
                        aria-label="Add web clip"
                        className="btn-primary w-20 h-14"
                    >
                        <Plus size={32} strokeWidth={3} />
                    </button>
                </header>
                <div className="flex flex-col gap-4">
                    {webClips.map(mem => {
                        const w = mem as WebMemory;
                        return (
                            <div key={mem.id} className="card-brutal flex flex-col gap-4">
                                <div className="flex items-start gap-4">
                                    <Globe size={36} strokeWidth={3} className="text-[#8B5CF6] flex-shrink-0 mt-1" />
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-xl font-black">{mem.title}</p>
                                        <p className="text-sm text-[#60A5FA] uppercase tracking-widest">
                                            {new Date(mem.date).toLocaleDateString()}
                                        </p>
                                        {w.content && (
                                            <p className="mt-2 text-base text-white/70 line-clamp-2">{w.content}</p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => onDeleteMemory(mem.id)}
                                        aria-label="Delete clip"
                                        className="p-3 bg-white/10 rounded-xl"
                                    >
                                        <Trash2 size={24} strokeWidth={3} />
                                    </button>
                                </div>
                                <a
                                    href={w.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${mem.title}`}
                                    className="w-full h-14 bg-[#8B5CF6] text-white rounded-2xl flex items-center justify-center font-black text-lg uppercase"
                                >
                                    Open Link
                                </a>
                            </div>
                        );
                    })}
                    {webClips.length === 0 && (
                        <div className="py-20 text-center opacity-40">
                            <Globe size={64} className="mx-auto mb-4" strokeWidth={2} />
                            <p className="text-xl uppercase">No web clips yet</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Add Web Clip ─────────────────────────────────────
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

    // ── Documents list ───────────────────────────────────
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

    // ── Scanning ─────────────────────────────────────────
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

    // ── Detail view ──────────────────────────────────────
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

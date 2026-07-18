import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    Folder, Mic, FileText, ArrowLeft, Plus,
    Trash2, X, LayoutGrid, ListTodo, FileStack, Camera,
    Volume2, Loader2, StopCircle, Brain, List, ArrowUpDown
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, FileMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import NotebookViewer from './NotebookViewer';
import SearchBar from './SearchBar';
import { StudyHubOverlay, SummaryFocusModal } from './StudyHub';
import { generateSpeechFromText, generateStudyOverview } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';

interface CollegeViewProps {
    lectures: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDelete: (ids: string[]) => void;
    courses: string[];
    addCourse: (courseName: string) => void;
    deleteCourse: (courseName: string) => void;
    tasks: Task[];
    addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;
    moodleToken: string | null;
    backHandlerRef?: React.MutableRefObject<(() => boolean) | null>;
}

// Read-aloud button reused here
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

const CollegeView: React.FC<CollegeViewProps> = ({
    lectures, onSave, onDelete, onUpdate, bulkDelete,
    courses, addCourse, deleteCourse, tasks, addTask, updateTask, deleteTask, moodleToken,
    backHandlerRef
}) => {
    const [mainTab, setMainTab] = useState<'courses' | 'files' | 'tasks'>('courses');
    const [view, setView] = useState<'list' | 'dashboard' | 'detail' | 'recording' | 'scanning' | 'generalScan'>('list');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');
    const [courseViewMode, setCourseViewMode] = useState<'list' | 'grid'>(() =>
        (localStorage.getItem('college_view_mode') as 'list' | 'grid') || 'list'
    );
    const [courseSortBy, setCourseSortBy] = useState<'alpha' | 'manual' | 'recent'>(() =>
        (localStorage.getItem('college_sort_by') as 'alpha' | 'manual' | 'recent') || 'alpha'
    );
    const [recentAccess, setRecentAccess] = useState<Record<string, number>>(() => {
        try { return JSON.parse(localStorage.getItem('college_recent_access') || '{}'); } catch { return {}; }
    });
    const [fileFilter, setFileFilter] = useState<'all' | 'recordings' | 'docs'>('all');

    // Study Session
    const [showStudyPrompt, setShowStudyPrompt] = useState(false);
    const [isGeneratingStudy, setIsGeneratingStudy] = useState(false);
    const [activeStudyHub, setActiveStudyHub] = useState<{ type: any; content: string; title: string; videoUri?: string } | null>(null);

    const collegeTasks = useMemo(() => tasks.filter(t => t.category === 'college'), [tasks]);
    const courseTasks = useMemo(() => {
        if (!selectedCourse) return [];
        return collegeTasks.filter(t => t.course === selectedCourse);
    }, [collegeTasks, selectedCourse]);

    const memoriesByCourse = useMemo(() => {
        const grouped: { [key: string]: AnyMemory[] } = {};
        lectures.forEach(l => {
            if (l.course) {
                if (!grouped[l.course]) grouped[l.course] = [];
                grouped[l.course].push(l);
            }
        });
        return grouped;
    }, [lectures]);

    const sortedCourses = useMemo(() => {
        const arr = [...courses];
        if (courseSortBy === 'alpha') return arr.sort((a, b) => a.localeCompare(b));
        if (courseSortBy === 'recent') return arr.sort((a, b) => (recentAccess[b] || 0) - (recentAccess[a] || 0));
        return arr; // manual = insertion order
    }, [courses, courseSortBy, recentAccess]);

    // Register hardware back handler with App.tsx so it runs before the tab-level back logic
    useEffect(() => {
        if (!backHandlerRef) return;
        backHandlerRef.current = () => {
            if (activeStudyHub) { setActiveStudyHub(null); return true; }
            if (showStudyPrompt) { setShowStudyPrompt(false); return true; }
            if (view === 'detail') { setView('dashboard'); return true; }
            if (view === 'recording' || view === 'scanning') { setView('dashboard'); return true; }
            if (view === 'generalScan') { setView('list'); return true; }
            if (view === 'dashboard') { setView('list'); setSelectedCourse(null); return true; }
            return false;
        };
        return () => { if (backHandlerRef) backHandlerRef.current = null; };
    }, [view, backHandlerRef, showStudyPrompt, activeStudyHub]);

    const handleSelectCourse = (course: string) => {
        const updated = { ...recentAccess, [course]: Date.now() };
        setRecentAccess(updated);
        localStorage.setItem('college_recent_access', JSON.stringify(updated));
        window.history.pushState({ collegeView: 'dashboard' }, '');
        setSelectedCourse(course);
        setView('dashboard');
    };

    // Route in-app back button through history so state stays in sync with history stack
    const handleBack = () => {
        window.history.back();
    };

    const filteredFiles = useMemo(() => {
        if (fileFilter === 'recordings') return lectures.filter(m => m.type === 'voice');
        if (fileFilter === 'docs') return lectures.filter(m => m.type === 'document' || m.type === 'file');
        return lectures;
    }, [lectures, fileFilter]);

    const handleOpenMemory = (mem: AnyMemory) => {
        window.history.pushState({ collegeView: 'detail' }, '');
        setSelectedItem(mem);
        setView('detail');
        setMainTab('courses');
    };

    const handleGenerateStudy = async (focus: string, type: 'written' | 'audio' | 'video' | 'research') => {
        if (!selectedCourse) return;
        const courseMaterials = memoriesByCourse[selectedCourse] || [];
        if (courseMaterials.length === 0) return;
        setIsGeneratingStudy(true);
        try {
            const result = await generateStudyOverview(courseMaterials, focus || selectedCourse, type);
            setShowStudyPrompt(false);
            window.history.pushState({ collegeModal: 'studyHub' }, '');
            setActiveStudyHub({ ...result, type });
        } catch (e) { console.error(e); }
        finally { setIsGeneratingStudy(false); }
    };

    const renderCourses = () => {
        // ── General Scan (not course-specific) ──────────────────────────────
        if (view === 'generalScan') {
            return (
                <AddDocumentModal
                    onClose={handleBack}
                    onSave={(mem) => {
                        onSave({ ...mem, category: 'college', course: 'General' });
                        window.history.back();
                    }}
                />
            );
        }

        // ── Course List ───────────────────────────────────────────────────
        if (view === 'list') {
            return (
                <div className="flex flex-col gap-6">
                    {/* General scan button */}
                    <button
                        onClick={() => { window.history.pushState({ collegeView: 'generalScan' }, ''); setView('generalScan'); }}
                        aria-label="Scan a general college document"
                        className="w-full h-24 bg-white text-[#001F3F] rounded-3xl flex items-center justify-center gap-4"
                    >
                        <Camera className="w-12 h-12" strokeWidth={3} />
                        <div className="text-left">
                            <div className="text-lg font-black uppercase">Scan College Doc</div>
                            <div className="text-sm opacity-60">Timetable, handouts, etc.</div>
                        </div>
                    </button>

                    {/* New course input */}
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={newCourseName}
                            onChange={(e) => setNewCourseName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newCourseName.trim()) {
                                    addCourse(newCourseName.trim());
                                    setNewCourseName('');
                                }
                            }}
                            placeholder="New Course Name…"
                            className="flex-grow"
                            aria-label="Enter new course name"
                        />
                        <button
                            onClick={() => {
                                if (newCourseName.trim()) {
                                    addCourse(newCourseName.trim());
                                    setNewCourseName('');
                                }
                            }}
                            aria-label="Add course"
                            className="btn-primary w-20"
                        >
                            <Plus size={36} strokeWidth={3} />
                        </button>
                    </div>

                    {/* View & sort controls */}
                    {courses.length > 0 && (
                        <div className="flex items-center gap-2">
                            {/* Sort */}
                            <div className="flex items-center gap-1 flex-grow">
                                <ArrowUpDown size={14} className="text-white/40" strokeWidth={3} />
                                {(['alpha', 'recent', 'manual'] as const).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => { setCourseSortBy(s); localStorage.setItem('college_sort_by', s); }}
                                        className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest transition-colors ${courseSortBy === s ? 'bg-white text-[#001F3F]' : 'text-white/40 hover:text-white/70'}`}
                                    >
                                        {s === 'alpha' ? 'A–Z' : s === 'recent' ? 'Recent' : 'Manual'}
                                    </button>
                                ))}
                            </div>
                            {/* View mode */}
                            <div className="flex gap-1">
                                <button
                                    onClick={() => { setCourseViewMode('list'); localStorage.setItem('college_view_mode', 'list'); }}
                                    className={`p-2 rounded-xl transition-colors ${courseViewMode === 'list' ? 'bg-white/20 text-white' : 'text-white/30 hover:text-white/60'}`}
                                    aria-label="List view"
                                >
                                    <List size={18} strokeWidth={3} />
                                </button>
                                <button
                                    onClick={() => { setCourseViewMode('grid'); localStorage.setItem('college_view_mode', 'grid'); }}
                                    className={`p-2 rounded-xl transition-colors ${courseViewMode === 'grid' ? 'bg-white/20 text-white' : 'text-white/30 hover:text-white/60'}`}
                                    aria-label="Grid view"
                                >
                                    <LayoutGrid size={18} strokeWidth={3} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Course cards */}
                    <div className={courseViewMode === 'grid' ? 'grid grid-cols-2 gap-4' : 'flex flex-col gap-4'}>
                        {sortedCourses.map(course => (
                            courseViewMode === 'grid' ? (
                                // Grid card — compact, square-ish
                                <div key={course} className="card-brutal flex flex-col gap-2 relative p-4">
                                    <button
                                        onClick={() => {
                                            const count = memoriesByCourse[course]?.length || 0;
                                            const msg = count > 0 ? `Delete "${course}" and all ${count} item${count !== 1 ? 's' : ''} inside it?` : `Delete course "${course}"?`;
                                            if (window.confirm(msg)) deleteCourse(course);
                                        }}
                                        className="absolute top-2 right-2 p-1 text-white/20 hover:text-red-400 transition-colors"
                                        aria-label={`Delete ${course}`}
                                    >
                                        <Trash2 size={16} strokeWidth={3} />
                                    </button>
                                    <button onClick={() => handleSelectCourse(course)} className="flex flex-col items-center gap-2 pt-2">
                                        <Folder size={40} className="text-[#60A5FA]" strokeWidth={3} />
                                        <h2 className="text-sm font-black text-center uppercase tracking-tight leading-tight line-clamp-2">{course}</h2>
                                        <p className="text-[#60A5FA] text-xs uppercase tracking-widest">
                                            {memoriesByCourse[course]?.length || 0} items
                                        </p>
                                    </button>
                                </div>
                            ) : (
                                // List card
                                <div key={course} className="card-brutal flex items-center gap-5 text-left hover:bg-white/5">
                                    <button onClick={() => handleSelectCourse(course)} className="flex items-center gap-5 flex-grow min-w-0">
                                        <Folder size={48} className="text-[#60A5FA] flex-shrink-0" strokeWidth={3} />
                                        <div className="flex-grow overflow-hidden">
                                            <h2 className="text-xl truncate">{course}</h2>
                                            <p className="text-[#60A5FA] text-sm uppercase tracking-widest">
                                                {memoriesByCourse[course]?.length || 0} items
                                            </p>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => {
                                            const count = memoriesByCourse[course]?.length || 0;
                                            const msg = count > 0 ? `Delete "${course}" and all ${count} item${count !== 1 ? 's' : ''} inside it?` : `Delete course "${course}"?`;
                                            if (window.confirm(msg)) deleteCourse(course);
                                        }}
                                        className="flex-shrink-0 p-2 text-white/30 hover:text-red-400 transition-colors"
                                        aria-label={`Delete ${course}`}
                                    >
                                        <Trash2 size={22} strokeWidth={3} />
                                    </button>
                                </div>
                            )
                        ))}
                        {courses.length === 0 && (
                            <div className="col-span-2 py-16 text-center opacity-40">
                                <Folder size={64} className="mx-auto mb-4" strokeWidth={2} />
                                <p className="text-xl uppercase">No courses yet</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // ── Course Dashboard ─────────────────────────────────────────────────────────
        if (view === 'dashboard' && selectedCourse) {
            return (
                <div className="flex flex-col gap-6">
                    <header className="flex items-center gap-4">
                        <button onClick={handleBack} aria-label="Back" className="btn-outline w-20 h-14">
                            <ArrowLeft size={32} strokeWidth={3} />
                        </button>
                        <h2 className="text-2xl font-black uppercase flex-grow truncate">{selectedCourse}</h2>
                    </header>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => { window.history.pushState({ collegeView: 'recording' }, ''); setView('recording'); }}
                            className="h-32 bg-white text-[#001F3F] rounded-3xl flex flex-col items-center justify-center gap-2"
                            aria-label="Record lecture"
                        >
                            <Mic size={40} strokeWidth={3} />
                            <span className="font-black uppercase text-base">Record Lecture</span>
                        </button>
                        <button
                            onClick={() => { window.history.pushState({ collegeView: 'scanning' }, ''); setView('scanning'); }}
                            className="h-32 bg-white/10 text-white rounded-3xl flex flex-col items-center justify-center gap-2 border-2 border-white/30"
                            aria-label="Scan document"
                        >
                            <Camera size={40} strokeWidth={3} />
                            <span className="font-black uppercase text-base">Scan Doc</span>
                        </button>
                    </div>

                    {/* Study Session — only shown when course has materials */}
                    {(memoriesByCourse[selectedCourse] || []).length > 0 && (
                        <button
                            onClick={() => { window.history.pushState({ collegeModal: 'studyPrompt' }, ''); setShowStudyPrompt(true); }}
                            className="w-full h-24 bg-purple-700 text-white rounded-3xl flex items-center justify-center gap-4 shadow-xl"
                            aria-label="Generate study session from course materials"
                        >
                            <Brain size={40} strokeWidth={3} />
                            <div className="text-left">
                                <div className="text-lg font-black uppercase">Study Session</div>
                                <div className="text-sm opacity-70">Audio · Video · Written · Research</div>
                            </div>
                        </button>
                    )}

                    {/* Lectures */}
                    <div className="space-y-4">
                        <h3 className="text-xl font-black uppercase tracking-widest border-b-4 border-white pb-2">
                            Lectures ({(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').length})
                        </h3>
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').map(mem => (
                            <button
                                key={mem.id}
                                onClick={() => { window.history.pushState({ collegeView: 'detail' }, ''); setSelectedItem(mem); setView('detail'); }}
                                className="card-brutal flex items-center gap-5 text-left hover:bg-white/5 w-full"
                            >
                                <Mic size={32} strokeWidth={3} className="flex-shrink-0" />
                                <div className="flex-grow overflow-hidden">
                                    <p className="text-xl truncate">{mem.title}</p>
                                    <p className="text-white/50 text-xs uppercase tracking-widest">
                                        {new Date(mem.date).toLocaleDateString()}
                                    </p>
                                </div>
                            </button>
                        ))}
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').length === 0 && (
                            <p className="text-white/40 uppercase text-sm">No lectures yet.</p>
                        )}
                    </div>

                    {/* Scans & Files */}
                    <div className="space-y-4">
                        <h3 className="text-xl font-black uppercase tracking-widest border-b-4 border-white pb-2">
                            Scans ({(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').length})
                        </h3>
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').map(mem => (
                            <div key={mem.id} className="card-brutal flex flex-col gap-4">
                                <button
                                    onClick={() => { window.history.pushState({ collegeView: 'detail' }, ''); setSelectedItem(mem); setView('detail'); }}
                                    className="flex items-center gap-5 text-left w-full"
                                    aria-label={`Open ${mem.title}`}
                                >
                                    <FileText size={32} strokeWidth={3} className="flex-shrink-0" />
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-xl truncate">{mem.title}</p>
                                        <p className="text-white/50 text-xs uppercase tracking-widest">
                                            {new Date(mem.date).toLocaleDateString()}
                                        </p>
                                    </div>
                                </button>
                                {mem.type === 'document' && (mem as DocumentMemory).extractedText && (
                                    <ReadAloudButton text={(mem as DocumentMemory).extractedText} />
                                )}
                            </div>
                        ))}
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').length === 0 && (
                            <p className="text-white/40 uppercase text-sm">No scans yet.</p>
                        )}
                    </div>
                </div>
            );
        }

        // ── Record Lecture ──────────────────────────────────────────────────────
        if (view === 'recording') {
            return (
                <div className="flex flex-col gap-6">
                    <header className="flex justify-between items-center">
                        <h2 className="text-2xl font-black uppercase">Record Lecture</h2>
                        <button onClick={handleBack} aria-label="Cancel" className="btn-outline w-20 h-14">
                            <X size={32} strokeWidth={3} />
                        </button>
                    </header>
                    <Recorder
                        audioOnly
                        onSave={(mem) => {
                            onSave({ ...mem, course: selectedCourse!, category: 'college' });
                            window.history.back();
                        }}
                        onCancel={handleBack}
                        titlePlaceholder={`Lecture – ${selectedCourse} – ${new Date().toLocaleDateString()}`}
                        saveButtonText="Save Lecture"
                    />
                </div>
            );
        }

        // ── Scan for course ───────────────────────────────────────────────────────
        if (view === 'scanning') {
            return (
                <AddDocumentModal
                    onClose={handleBack}
                    onSave={(mem) => {
                        onSave({ ...mem, course: selectedCourse!, category: 'college' });
                        window.history.back();
                    }}
                />
            );
        }

        // ── Detail ────────────────────────────────────────────────────────────────────────
        if (view === 'detail' && selectedItem) {
            return (
                <div className="flex flex-col gap-6">
                    <header className="flex items-center gap-4">
                        <button onClick={handleBack} aria-label="Back" className="btn-outline w-20 h-14">
                            <ArrowLeft size={32} strokeWidth={3} />
                        </button>
                        <h2 className="text-2xl font-black uppercase flex-grow truncate">{selectedItem.title}</h2>
                        <button
                            onClick={() => { onDelete(selectedItem.id); handleBack(); }}
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
                                        <h3 className="font-black text-blue-400 uppercase text-sm tracking-widest mb-3">Lecture Summary</h3>
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
                                                            const updated = { ...selectedItem } as VoiceMemory;
                                                            updated.actionItems![idx].done = !item.done;
                                                            onUpdate(updated);
                                                        }}
                                                        className="w-5 h-5 rounded accent-orange-400 mt-0.5 cursor-pointer"
                                                    />
                                                    <span className={item.done ? 'line-through text-gray-400' : 'text-white'}>{item.text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {(selectedItem as VoiceMemory).notebook && (
                                    <div>
                                        <h3 className="font-black text-purple-400 uppercase text-sm tracking-widest mb-3">My Lecture Notes</h3>
                                        <NotebookViewer
                                            notebook={(selectedItem as VoiceMemory).notebook!}
                                            syncWithAudio={true}
                                        />
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
                        {(selectedItem.type === 'document' || selectedItem.type === 'file') && (
                            <div className="space-y-5">
                                {selectedItem.type === 'document' && (selectedItem as DocumentMemory).imageDataUrl && (
                                    <img
                                        src={(selectedItem as DocumentMemory).imageDataUrl}
                                        className="w-full rounded-2xl border-2 border-white/20"
                                        alt={selectedItem.title}
                                    />
                                )}
                                <p className="text-xl leading-relaxed whitespace-pre-wrap">
                                    {'extractedText' in selectedItem
                                        ? (selectedItem as DocumentMemory).extractedText
                                        : 'No text content available.'}
                                </p>
                                {'extractedText' in selectedItem && (selectedItem as DocumentMemory).extractedText && (
                                    <ReadAloudButton text={(selectedItem as DocumentMemory).extractedText} />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="h-[40vh] card-brutal p-0 overflow-hidden">
                        <QASession memories={[selectedItem]} tasks={[]} />
                    </div>
                </div>
            );
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {showStudyPrompt && (
                <SummaryFocusModal
                    onClose={() => {
                        if (window.history.state?.collegeModal === 'studyPrompt') window.history.back();
                        setShowStudyPrompt(false);
                    }}
                    onGenerate={handleGenerateStudy}
                    isGenerating={isGeneratingStudy}
                    defaultFocus={selectedCourse || ''}
                />
            )}
            {activeStudyHub && (
                <StudyHubOverlay
                    overview={activeStudyHub}
                    memories={memoriesByCourse[selectedCourse || ''] || []}
                    onClose={() => {
                        if (window.history.state?.collegeModal === 'studyHub') window.history.back();
                        setActiveStudyHub(null);
                    }}
                />
            )}

            {/* Main Tabs */}
            <div className="flex gap-2 bg-white/10 rounded-2xl p-2">
                <button
                    onClick={() => { setMainTab('courses'); setView('list'); }}
                    aria-current={mainTab === 'courses' ? 'true' : undefined}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                        mainTab === 'courses' ? 'bg-white text-[#001F3F]' : 'text-white'
                    }`}
                >
                    <LayoutGrid size={22} strokeWidth={3} />
                    <span>Courses</span>
                </button>
                <button
                    onClick={() => setMainTab('files')}
                    aria-current={mainTab === 'files' ? 'true' : undefined}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                        mainTab === 'files' ? 'bg-white text-[#001F3F]' : 'text-white'
                    }`}
                >
                    <FileStack size={22} strokeWidth={3} />
                    <span>Files</span>
                </button>
                <button
                    onClick={() => setMainTab('tasks')}
                    aria-current={mainTab === 'tasks' ? 'true' : undefined}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                        mainTab === 'tasks' ? 'bg-white text-[#001F3F]' : 'text-white'
                    }`}
                >
                    <ListTodo size={22} strokeWidth={3} />
                    <span>Tasks</span>
                </button>
            </div>

            {mainTab === 'courses' && renderCourses()}

            {mainTab === 'files' && (
                <div className="flex flex-col gap-6">
                    <div className="flex gap-2 flex-wrap">
                        {(['all', 'recordings', 'docs'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFileFilter(f)}
                                aria-pressed={fileFilter === f}
                                className={`px-6 py-3 rounded-full text-sm font-black uppercase tracking-widest border-2 ${
                                    fileFilter === f
                                        ? 'bg-[#60A5FA] border-[#60A5FA] text-[#001F3F]'
                                        : 'border-[#60A5FA] text-[#60A5FA]'
                                }`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-col gap-4">
                        {filteredFiles.map(mem => (
                            <div key={mem.id} className="card-brutal flex flex-col gap-4">
                                <button
                                    onClick={() => { window.history.pushState({ collegeView: 'detail' }, ''); setSelectedItem(mem); setView('detail'); setMainTab('courses'); }}
                                    className="flex items-center gap-5 text-left w-full"
                                    aria-label={`Open ${mem.title}`}
                                >
                                    {mem.type === 'voice'
                                        ? <Mic size={32} strokeWidth={3} className="flex-shrink-0" />
                                        : <FileText size={32} strokeWidth={3} className="flex-shrink-0" />
                                    }
                                    <div className="flex-grow overflow-hidden">
                                        <p className="text-xl truncate">{mem.title}</p>
                                        <p className="text-[#60A5FA] text-xs uppercase tracking-widest">
                                            {mem.course} • {new Date(mem.date).toLocaleDateString()}
                                        </p>
                                    </div>
                                </button>
                                {mem.type === 'document' && (mem as DocumentMemory).extractedText && (
                                    <ReadAloudButton text={(mem as DocumentMemory).extractedText} />
                                )}
                            </div>
                        ))}
                        {filteredFiles.length === 0 && (
                            <div className="py-16 text-center opacity-40">
                                <FileStack size={64} className="mx-auto mb-4" strokeWidth={2} />
                                <p className="text-xl uppercase">No files yet</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {mainTab === 'tasks' && (
                <div className="h-[70vh]">
                    <KanbanBoard
                        tasks={collegeTasks}
                        category="college"
                        onUpdateTask={updateTask}
                        onDeleteTask={deleteTask}
                        onAddTask={(task) => addTask({ ...task, category: 'college' })}
                        memories={lectures}
                        onOpenMemory={handleOpenMemory}
                    />
                </div>
            )}
        </div>
    );
};

export default CollegeView;

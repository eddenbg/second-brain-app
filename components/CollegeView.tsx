
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    Folder, Mic, FileText, ArrowLeft, Plus,
    Trash2, X, LayoutGrid, ListTodo, FileStack, Camera,
    Volume2, Loader2, StopCircle
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, FileMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import { generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';

interface CollegeViewProps {
    lectures: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDelete: (ids: string[]) => void;
    courses: string[];
    addCourse: (courseName: string) => void;
    tasks: Task[];
    addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;
    moodleToken: string | null;
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
    courses, addCourse, tasks, addTask, updateTask, deleteTask, moodleToken
}) => {
    const [mainTab, setMainTab] = useState<'courses' | 'files' | 'tasks'>('courses');
    const [view, setView] = useState<'list' | 'dashboard' | 'detail' | 'recording' | 'scanning' | 'generalScan'>('list');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');
    const [fileFilter, setFileFilter] = useState<'all' | 'recordings' | 'docs'>('all');

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

    const handleSelectCourse = (course: string) => {
        setSelectedCourse(course);
        setView('dashboard');
    };

    const handleBack = () => {
        if (view === 'detail') setView('dashboard');
        else if (view === 'recording' || view === 'scanning') setView('dashboard');
        else if (view === 'generalScan') setView('list');
        else if (view === 'dashboard') setView('list');
    };

    const filteredFiles = useMemo(() => {
        if (fileFilter === 'recordings') return lectures.filter(m => m.type === 'voice');
        if (fileFilter === 'docs') return lectures.filter(m => m.type === 'document' || m.type === 'file');
        return lectures;
    }, [lectures, fileFilter]);

    const handleOpenMemory = (mem: AnyMemory) => {
        setSelectedItem(mem);
        setView('detail');
        setMainTab('courses');
    };

    const renderCourses = () => {
        // ── General Scan (not course-specific) ────────────────
        if (view === 'generalScan') {
            return (
                <AddDocumentModal
                    onClose={() => setView('list')}
                    onSave={(mem) => {
                        onSave({ ...mem, category: 'college', course: 'General' });
                        setView('list');
                    }}
                />
            );
        }

        // ── Course List ────────────────────────────────────────
        if (view === 'list') {
            return (
                <div className="flex flex-col gap-6">
                    {/* General scan button */}
                    <button
                        onClick={() => setView('generalScan')}
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

                    {/* Course cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {courses.map(course => (
                            <button
                                key={course}
                                onClick={() => handleSelectCourse(course)}
                                className="card-brutal flex items-center gap-5 text-left hover:bg-white/5"
                            >
                                <Folder size={48} className="text-[#60A5FA] flex-shrink-0" strokeWidth={3} />
                                <div className="flex-grow overflow-hidden">
                                    <h2 className="text-xl truncate">{course}</h2>
                                    <p className="text-[#60A5FA] text-sm uppercase tracking-widest">
                                        {memoriesByCourse[course]?.length || 0} items
                                    </p>
                                </div>
                            </button>
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

        // ── Course Dashboard ───────────────────────────────────
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
                            onClick={() => setView('recording')}
                            className="h-32 bg-white text-[#001F3F] rounded-3xl flex flex-col items-center justify-center gap-2"
                            aria-label="Record lecture"
                        >
                            <Mic size={40} strokeWidth={3} />
                            <span className="font-black uppercase text-base">Record Lecture</span>
                        </button>
                        <button
                            onClick={() => setView('scanning')}
                            className="h-32 bg-white/10 text-white rounded-3xl flex flex-col items-center justify-center gap-2 border-2 border-white/30"
                            aria-label="Scan document"
                        >
                            <Camera size={40} strokeWidth={3} />
                            <span className="font-black uppercase text-base">Scan Doc</span>
                        </button>
                    </div>

                    {/* Lectures */}
                    <div className="space-y-4">
                        <h3 className="text-xl font-black uppercase tracking-widest border-b-4 border-white pb-2">
                            Lectures ({(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').length})
                        </h3>
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').map(mem => (
                            <button
                                key={mem.id}
                                onClick={() => { setSelectedItem(mem); setView('detail'); }}
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

                    {/* Scans */}
                    <div className="space-y-4">
                        <h3 className="text-xl font-black uppercase tracking-widest border-b-4 border-white pb-2">
                            Scans ({(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').length})
                        </h3>
                        {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').map(mem => (
                            <div key={mem.id} className="card-brutal flex flex-col gap-4">
                                <button
                                    onClick={() => { setSelectedItem(mem); setView('detail'); }}
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

        // ── Record Lecture ─────────────────────────────────────
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
                        onSave={(mem) => {
                            onSave({ ...mem, course: selectedCourse!, category: 'college' });
                            setView('dashboard');
                        }}
                        onCancel={handleBack}
                        titlePlaceholder={`Lecture – ${selectedCourse} – ${new Date().toLocaleDateString()}`}
                        saveButtonText="Save Lecture"
                    />
                </div>
            );
        }

        // ── Scan for course ────────────────────────────────────
        if (view === 'scanning') {
            return (
                <AddDocumentModal
                    onClose={handleBack}
                    onSave={(mem) => {
                        onSave({ ...mem, course: selectedCourse!, category: 'college' });
                        setView('dashboard');
                    }}
                />
            );
        }

        // ── Detail ─────────────────────────────────────────────
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
                                <p className="text-xl leading-relaxed">{(selectedItem as VoiceMemory).transcript}</p>
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
                                    onClick={() => { setSelectedItem(mem); setView('detail'); setMainTab('courses'); }}
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

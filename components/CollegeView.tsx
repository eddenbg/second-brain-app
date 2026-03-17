
import React, { useState, useMemo } from 'react';
import { 
    Folder, Mic, FileText, Package, ArrowLeft, Plus, 
    Search, Trash2, Edit3, Globe, Loader2, X, LayoutGrid, ListTodo, FileStack, Camera
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, FileMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';

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

const CollegeView: React.FC<CollegeViewProps> = ({ 
    lectures, onSave, onDelete, onUpdate, bulkDelete, 
    courses, addCourse, tasks, addTask, updateTask, deleteTask, moodleToken 
}) => {
    const [mainTab, setMainTab] = useState<'courses' | 'files' | 'tasks'>('courses');
    const [view, setView] = useState<'list' | 'dashboard' | 'detail' | 'recording' | 'scanning'>('list');
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
        if (view === 'list') {
            return (
                <div className="flex flex-col gap-8">
                    <div className="flex gap-4">
                        <input 
                            type="text" 
                            value={newCourseName}
                            onChange={(e) => setNewCourseName(e.target.value)}
                            placeholder="New Course Name..."
                            className="flex-grow"
                        />
                        <button 
                            onClick={() => { if(newCourseName) { addCourse(newCourseName); setNewCourseName(''); } }}
                            className="btn-primary w-24"
                        >
                            <Plus size={40} strokeWidth={3} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {courses.map(course => (
                            <button 
                                key={course}
                                onClick={() => handleSelectCourse(course)}
                                className="card-brutal flex items-center gap-6 text-left hover:bg-[#60A5FA]/10"
                            >
                                <Folder size={48} className="text-[#60A5FA]" strokeWidth={3} />
                                <div className="flex-grow overflow-hidden">
                                    <h2 className="text-2xl truncate">{course}</h2>
                                    <p className="text-[#60A5FA] text-sm uppercase tracking-widest">
                                        {memoriesByCourse[course]?.length || 0} Items
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            );
        }

        if (view === 'dashboard' && selectedCourse) {
            return (
                <div className="flex flex-col gap-8">
                    <header className="flex items-center gap-6">
                        <button onClick={handleBack} className="btn-outline w-24">
                            <ArrowLeft size={40} strokeWidth={3} />
                        </button>
                        <h1 className="text-3xl truncate">{selectedCourse}</h1>
                    </header>

                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={() => setView('recording')} className="btn-primary h-32 flex flex-col items-center justify-center gap-2">
                            <Mic size={32} />
                            <span>Record</span>
                        </button>
                        <button onClick={() => setView('scanning')} className="btn-primary h-32 flex flex-col items-center justify-center gap-2">
                            <Camera size={32} />
                            <span>Scan</span>
                        </button>
                    </div>

                    <div className="space-y-8">
                        <div className="space-y-4">
                            <h3 className="text-2xl font-black uppercase tracking-widest text-white border-b-4 border-white pb-2">Lectures</h3>
                            <div className="grid grid-cols-1 gap-4">
                                {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').map(mem => (
                                    <button 
                                        key={mem.id}
                                        onClick={() => { setSelectedItem(mem); setView('detail'); }}
                                        className="card-brutal flex items-center gap-6 text-left hover:bg-white/10"
                                    >
                                        <Mic size={32} strokeWidth={3} />
                                        <div className="flex-grow overflow-hidden">
                                            <h3 className="text-xl truncate">{mem.title}</h3>
                                            <p className="text-white/60 text-xs uppercase tracking-widest">
                                                {new Date(mem.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                                {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'voice').length === 0 && (
                                    <p className="text-white/40 uppercase text-sm">No lectures recorded yet.</p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-2xl font-black uppercase tracking-widest text-white border-b-4 border-white pb-2">Scans</h3>
                            <div className="grid grid-cols-1 gap-4">
                                {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').map(mem => (
                                    <button 
                                        key={mem.id}
                                        onClick={() => { setSelectedItem(mem); setView('detail'); }}
                                        className="card-brutal flex items-center gap-6 text-left hover:bg-white/10"
                                    >
                                        <FileText size={32} strokeWidth={3} />
                                        <div className="flex-grow overflow-hidden">
                                            <h3 className="text-xl truncate">{mem.title}</h3>
                                            <p className="text-white/60 text-xs uppercase tracking-widest">
                                                {new Date(mem.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                                {(memoriesByCourse[selectedCourse] || []).filter(m => m.type === 'document' || m.type === 'file').length === 0 && (
                                    <p className="text-white/40 uppercase text-sm">No scans captured yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (view === 'recording') {
            return (
                <div className="flex flex-col gap-8">
                    <header className="flex justify-between items-center">
                        <h1 className="text-3xl">Lecture Record</h1>
                        <button onClick={handleBack} className="btn-outline w-24">
                            <X size={40} strokeWidth={3} />
                        </button>
                    </header>
                    <Recorder 
                        onSave={(mem) => { onSave({ ...mem, course: selectedCourse!, category: 'college' }); setView('dashboard'); }}
                        onCancel={handleBack}
                        titlePlaceholder={`Lecture - ${selectedCourse} - ${new Date().toLocaleDateString()}`}
                        saveButtonText="Save Lecture"
                    />
                </div>
            );
        }

        if (view === 'scanning') {
            return (
                <AddDocumentModal 
                    onClose={handleBack} 
                    onSave={(mem) => { onSave({ ...mem, course: selectedCourse!, category: 'college' }); setView('dashboard'); }} 
                />
            );
        }

        if (view === 'detail' && selectedItem) {
            return (
                <div className="flex flex-col gap-8">
                    <header className="flex items-center gap-6">
                        <button onClick={handleBack} className="btn-outline w-24">
                            <ArrowLeft size={40} strokeWidth={3} />
                        </button>
                        <h1 className="text-3xl truncate">{selectedItem.title}</h1>
                    </header>
                    <div className="card-brutal bg-[#60A5FA]/5">
                        {selectedItem.type === 'voice' && (
                            <div className="space-y-6">
                                <audio src={(selectedItem as VoiceMemory).audioDataUrl} controls className="w-full" />
                                <p className="text-xl leading-relaxed">{(selectedItem as VoiceMemory).transcript}</p>
                            </div>
                        )}
                        {(selectedItem.type === 'document' || selectedItem.type === 'file') && (
                            <div className="space-y-6">
                                {selectedItem.type === 'document' && (selectedItem as DocumentMemory).imageDataUrl && (
                                    <img src={(selectedItem as DocumentMemory).imageDataUrl} className="w-full rounded-xl border-3 border-[#60A5FA]/20" />
                                )}
                                <p className="text-xl leading-relaxed">
                                    {'extractedText' in selectedItem ? selectedItem.extractedText : 'No text content available.'}
                                </p>
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
        <div className="flex flex-col gap-8">
            {/* Main Tabs */}
            <div className="flex gap-2 bg-white/10 rounded-2xl p-2">
                <button 
                    onClick={() => { setMainTab('courses'); setView('list'); }}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${mainTab === 'courses' ? 'bg-white text-[#001F3F]' : 'text-white'}`}
                >
                    <LayoutGrid size={20} />
                    <span className="hidden sm:inline">Courses</span>
                </button>
                <button 
                    onClick={() => setMainTab('files')}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${mainTab === 'files' ? 'bg-white text-[#001F3F]' : 'text-white'}`}
                >
                    <FileStack size={20} />
                    <span className="hidden sm:inline">Files</span>
                </button>
                <button 
                    onClick={() => setMainTab('tasks')}
                    className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${mainTab === 'tasks' ? 'bg-white text-[#001F3F]' : 'text-white'}`}
                >
                    <ListTodo size={20} />
                    <span className="hidden sm:inline">Tasks</span>
                </button>
            </div>

            {mainTab === 'courses' && renderCourses()}

            {mainTab === 'files' && (
                <div className="flex flex-col gap-8">
                    <div className="flex gap-2">
                        {(['all', 'recordings', 'docs'] as const).map(f => (
                            <button 
                                key={f}
                                onClick={() => setFileFilter(f)}
                                className={`px-6 py-2 rounded-full text-sm font-black uppercase tracking-widest border-2 transition-all ${fileFilter === f ? 'bg-[#60A5FA] border-[#60A5FA] text-[#020617]' : 'border-[#60A5FA] text-[#60A5FA]'}`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        {filteredFiles.map(mem => (
                            <button 
                                key={mem.id}
                                onClick={() => { setSelectedItem(mem); setView('detail'); setMainTab('courses'); }}
                                className="card-brutal flex items-center gap-6 text-left hover:bg-[#60A5FA]/10"
                            >
                                {mem.type === 'voice' && <Mic size={32} strokeWidth={3} />}
                                {(mem.type === 'document' || mem.type === 'file') && <FileText size={32} strokeWidth={3} />}
                                <div className="flex-grow overflow-hidden">
                                    <h3 className="text-xl truncate">{mem.title}</h3>
                                    <p className="text-[#60A5FA] text-xs uppercase tracking-widest">
                                        {mem.course} • {new Date(mem.date).toLocaleDateString()}
                                    </p>
                                </div>
                            </button>
                        ))}
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

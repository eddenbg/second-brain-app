import React, { useState, useMemo, useEffect } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, FileMemory, MoodleContent, MoodleCourse } from '../types';
import { fetchCourseContents, fetchMoodleCourses } from '../services/moodleService';
import Recorder from './Recorder';
import QASession from './QASession';
import TemporaryScanView from './TemporaryScanView';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import { 
    FolderIcon, MicIcon, PlusCircleIcon, ArrowLeftIcon, 
    FileTextIcon, Volume2Icon, Loader2Icon, 
    GlobeIcon, XIcon, CheckIcon, EyeIcon 
} from './Icons';

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

const ResourceItem: React.FC<{
    resource: FileMemory;
    onSelect: (r: FileMemory) => void;
    onHide: (id: string) => void;
}> = ({ resource, onSelect, onHide }) => (
    <div className="bg-gray-800 p-6 rounded-[2rem] border-4 border-gray-800 hover:border-indigo-500 transition-all group flex items-center gap-5 relative">
        <button 
            onClick={(e) => { e.stopPropagation(); onHide(resource.id); }} 
            className="absolute top-4 right-4 p-2 bg-gray-900 rounded-full text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            title="Hide from folder"
        >
            <XIcon className="w-4 h-4" />
        </button>
        <div onClick={() => onSelect(resource)} className="bg-indigo-900/30 p-4 rounded-2xl group-hover:scale-110 transition-transform cursor-pointer">
            <FileTextIcon className="w-8 h-8 text-indigo-400" />
        </div>
        <div onClick={() => onSelect(resource)} className="flex-grow overflow-hidden cursor-pointer">
            <h4 className="text-xl font-black text-white truncate uppercase tracking-tight">{resource.title}</h4>
            <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{resource.sourceType === 'moodle' ? 'Moodle Source' : 'Upload'}</span>
                {resource.summary && <span className="text-[10px] text-gray-500 font-bold">• Summarized</span>}
            </div>
        </div>
    </div>
);

const MoodleBrowser: React.FC<{
    token: string;
    courseName: string;
    onImport: (content: MoodleContent) => void;
    onClose: () => void;
}> = ({ token, courseName, onImport, onClose }) => {
    const [courses, setCourses] = useState<MoodleCourse[]>([]);
    const [contents, setContents] = useState<MoodleContent[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadCourses = async () => {
        setLoading(true);
        setError(null);
        try {
            const mc = await fetchMoodleCourses(token);
            if (!mc || mc.length === 0) {
                setError("No courses found. Please check your token or login.");
            } else {
                setCourses(mc);
                const match = mc.find(c => 
                    c.fullname.toLowerCase().includes(courseName.toLowerCase()) || 
                    courseName.toLowerCase().includes(c.shortname.toLowerCase())
                );
                if (match) setActiveCourseId(match.id);
            }
        } catch (err: any) {
            setError(err.message || "Connection Error. The college server may be unreachable.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCourses();
    }, [token, courseName]);

    useEffect(() => {
        if (activeCourseId) {
            setLoading(true);
            setError(null);
            fetchCourseContents(token, activeCourseId)
                .then(c => {
                    setContents(c);
                    if (c.length === 0) setError("This folder appears to be empty.");
                })
                .catch((err: any) => {
                    setError(err.message || "Failed to load contents.");
                })
                .finally(() => setLoading(false));
        }
    }, [activeCourseId, token]);

    return (
        <div className="fixed inset-0 z-[300] bg-black/95 flex flex-col p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-gray-800 w-full max-w-2xl mx-auto my-auto rounded-[3rem] border-4 border-gray-700 flex flex-col max-h-[90vh] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)]" onClick={e => e.stopPropagation()}>
                <header className="p-6 sm:p-8 border-b-4 border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                        <GlobeIcon className="w-8 h-8 text-green-400"/> Moodle Browser
                    </h2>
                    <button onClick={onClose} className="p-3 bg-gray-700 rounded-2xl active:scale-90 transition-transform"><XIcon className="w-6 h-6 text-white"/></button>
                </header>
                
                <div className="flex-grow overflow-y-auto p-6 sm:p-8 space-y-6">
                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center gap-6 text-center">
                            <Loader2Icon className="w-16 h-16 animate-spin text-green-500" />
                            <span className="font-black text-gray-400 uppercase tracking-widest text-sm animate-pulse">Scanning Campus Network...</span>
                        </div>
                    ) : error && !activeCourseId ? (
                        <div className="py-20 text-center space-y-6 px-4">
                             <div className="text-5xl mb-4">⚠️</div>
                             <p className="text-gray-300 font-bold uppercase leading-snug text-xl">{error}</p>
                             <div className="flex flex-col gap-3 pt-6 max-w-xs mx-auto">
                                <button onClick={loadCourses} className="w-full px-8 py-5 bg-blue-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">TRY AGAIN</button>
                                <button onClick={onClose} className="w-full px-8 py-4 text-gray-500 font-black uppercase tracking-widest">CLOSE</button>
                             </div>
                        </div>
                    ) : !activeCourseId ? (
                        <div className="space-y-4">
                            <p className="text-blue-400 font-black uppercase text-[10px] tracking-widest px-2">Choose Course Folder</p>
                            {courses.map(c => (
                                <button key={c.id} onClick={() => setActiveCourseId(c.id)} className="w-full text-left p-6 bg-gray-900 rounded-[2rem] border-2 border-gray-700 hover:border-green-500 hover:bg-gray-850 transition-all group">
                                    <div className="flex justify-between items-center">
                                        <span className="font-black text-white uppercase tracking-tight text-lg truncate pr-4">{c.fullname}</span>
                                        <PlusCircleIcon className="w-6 h-6 text-gray-700 group-hover:text-green-500 shrink-0"/>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-4">
                                <button onClick={() => { setActiveCourseId(null); setContents([]); setError(null); }} className="px-5 py-3 bg-gray-700 text-green-400 font-black text-xs uppercase rounded-xl tracking-widest flex items-center gap-2 hover:bg-gray-600">
                                    <ArrowLeftIcon className="w-5 h-5"/> Back to Folders
                                </button>
                            </div>

                            {error ? (
                                <div className="py-10 text-center opacity-50 px-4">
                                    <p className="font-black text-gray-400 uppercase leading-snug">{error}</p>
                                </div>
                            ) : (
                                contents.map(item => (
                                    <button 
                                        key={item.id} 
                                        onClick={() => { onImport(item); onClose(); }} 
                                        className="w-full flex items-center justify-between p-6 bg-gray-900 rounded-[2rem] border-2 border-gray-700 hover:border-blue-500 group transition-all"
                                    >
                                        <div className="flex items-center gap-5 text-left overflow-hidden">
                                            <div className="bg-gray-800 p-3 rounded-xl group-hover:bg-blue-900/30 transition-colors">
                                                {item.type === 'url' ? <GlobeIcon className="w-6 h-6 text-teal-400"/> : <FileTextIcon className="w-6 h-6 text-indigo-400"/>}
                                            </div>
                                            <span className="font-black text-white uppercase tracking-tight truncate text-base">{item.name}</span>
                                        </div>
                                        <div className="bg-blue-600/10 text-blue-400 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase opacity-0 group-hover:opacity-100 transition-opacity">Import</div>
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdate, bulkDelete, courses, addCourse, tasks, addTask, updateTask, deleteTask, moodleToken }) => {
    type View = 'courses' | 'lectures' | 'lectureDetail' | 'documentDetail' | 'qa' | 'record' | 'temporaryScan';
    const [view, setView] = useState<View>('courses');
    const [showAddDocModal, setShowAddDocModal] = useState(false);
    const [showMoodleBrowser, setShowMoodleBrowser] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedLecture, setSelectedLecture] = useState<VoiceMemory | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<DocumentMemory | FileMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');
    const [activeTab, setActiveTab] = useState<'lectures' | 'resources' | 'tasks'>('lectures'); 

    // --- INTERNAL BACK BUTTON HANDLING ---
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (showAddDocModal) {
                setShowAddDocModal(false);
                return;
            }
            if (showMoodleBrowser) {
                setShowMoodleBrowser(false);
                return;
            }

            if (view === 'lectureDetail' || view === 'documentDetail') {
                setView('lectures');
            } else if (view === 'lectures') {
                setView('courses');
                setSelectedCourse(null);
            } else if (view === 'record') {
                setView('lectures');
            } else if (view === 'temporaryScan') {
                setView('courses');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [view, showAddDocModal, showMoodleBrowser]);

    const navigateTo = (nextView: View) => {
        window.history.pushState({ folderView: nextView }, '');
        setView(nextView);
    };

    const handleAddCourse = () => {
        if (newCourseName.trim()) {
            addCourse(newCourseName.trim());
            setNewCourseName('');
        }
    };

    const handleSelectCourse = (course: string) => {
        setSelectedCourse(course);
        navigateTo('lectures');
    };

    const memoriesByCourse = useMemo(() => {
        const grouped: { [key: string]: AnyMemory[] } = {};
        lectures.forEach(l => {
            if (l.category === 'college' && l.course) {
                if (!grouped[l.course]) grouped[l.course] = [];
                grouped[l.course].push(l);
            }
        });
        Object.values(grouped).forEach(arr => arr.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        return grouped;
    }, [lectures]);

    const handleMoodleImport = async (content: MoodleContent) => {
        if (!selectedCourse) return;
        onSave({
            type: 'file',
            title: content.name,
            fileUrl: content.fileurl || '',
            mimeType: content.mimetype || 'application/pdf',
            sourceType: 'moodle',
            moodleId: content.id.toString(),
            category: 'college',
            course: selectedCourse
        } as Omit<FileMemory, 'id' | 'date'>);
    };

    const handleSelectItem = (item: AnyMemory) => {
        if (item.type === 'voice') {
            setSelectedLecture(item as VoiceMemory);
            navigateTo('lectureDetail');
        } else if (item.type === 'document' || item.type === 'file') {
            setSelectedDocument(item as DocumentMemory);
            navigateTo('documentDetail');
        }
    };

    const handleHideItem = (id: string) => {
        onUpdate(id, { isHidden: true });
    };
    
    if (view === 'temporaryScan') return <TemporaryScanView onClose={() => { if(window.history.state?.folderView) window.history.back(); else setView('courses'); }} />;
    if (view === 'record') return <Recorder onSave={(mem) => { onSave({ ...mem, category: 'college', course: selectedCourse || 'General' }); setView('lectures'); }} onCancel={() => setView('lectures')} titlePlaceholder={`${selectedCourse} - ${new Date().toLocaleDateString()}`} saveButtonText="Save Lecture" />;
    
    if (view === 'lectureDetail' && selectedLecture) {
        return (
            <div className="flex flex-col h-full max-w-5xl mx-auto">
                <header className="flex items-center mb-6 flex-shrink-0">
                    <button onClick={() => window.history.back()} className="p-3 mr-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white transition-colors">
                        <ArrowLeftIcon className="w-8 h-8" />
                    </button>
                    <h2 className="text-2xl md:text-3xl font-black truncate uppercase tracking-tighter">{selectedLecture.title}</h2>
                </header>
                <div className="flex-grow overflow-hidden flex flex-col lg:flex-row gap-8">
                    <div className="flex-grow overflow-y-auto space-y-6">
                        <div className="bg-gray-800 p-8 rounded-[3rem] border-4 border-gray-700">
                             <h3 className="text-blue-400 font-black text-xs uppercase tracking-widest mb-4">AI Summary</h3>
                             <p className="text-xl text-gray-200 font-bold italic leading-relaxed">{selectedLecture.summary || 'Summary generating...'}</p>
                        </div>
                        <div className="bg-gray-800 p-8 rounded-[3rem] border-4 border-gray-700">
                             <h3 className="text-gray-500 font-black text-xs uppercase tracking-widest mb-4">Transcript</h3>
                             <p className="text-lg text-gray-300 whitespace-pre-wrap leading-relaxed">{selectedLecture.transcript}</p>
                        </div>
                    </div>
                    <div className="w-full lg:w-96 bg-gray-900 border-4 border-gray-800 rounded-[3rem] overflow-hidden flex flex-col">
                        <QASession memories={[selectedLecture]} tasks={[]} />
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'documentDetail' && selectedDocument) {
        const doc = selectedDocument as any;
        return (
            <div className="flex flex-col h-full max-w-7xl mx-auto">
                <header className="flex items-center mb-6 flex-shrink-0">
                    <button onClick={() => window.history.back()} className="p-3 mr-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white transition-colors"><ArrowLeftIcon className="w-8 h-8" /></button>
                    <h2 className="text-2xl md:text-3xl font-black truncate uppercase tracking-tighter">{doc.title}</h2>
                </header>
                <div className="flex-grow overflow-hidden flex flex-col lg:flex-row gap-8">
                    <div className="flex-grow bg-gray-800 p-8 rounded-[3rem] border-4 border-gray-700 flex flex-col items-center">
                        {doc.imageDataUrl ? (
                            <img src={doc.imageDataUrl} className="max-w-full max-h-[60vh] object-contain rounded-2xl shadow-2xl"/>
                        ) : (
                            <div className="flex flex-col items-center gap-6 py-20 text-center">
                                <FileTextIcon className="w-32 h-32 text-indigo-400"/>
                                <a href={doc.fileUrl} target="_blank" className="px-10 py-5 bg-indigo-600 text-white font-black rounded-3xl text-xl shadow-xl">OPEN ORIGINAL DOCUMENT</a>
                            </div>
                        )}
                        <div className="mt-8 w-full">
                            <h3 className="text-indigo-400 font-black text-xs uppercase tracking-widest mb-4">Content Summary</h3>
                            <p className="text-lg text-gray-300 leading-relaxed">{doc.extractedText || doc.summary || 'Processing content...'}</p>
                        </div>
                    </div>
                    <div className="w-full lg:w-96 bg-gray-900 border-4 border-gray-800 rounded-[3rem] overflow-hidden flex flex-col">
                        <QASession memories={[doc]} tasks={[]} />
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'lectures' && selectedCourse) {
        const courseMemories = memoriesByCourse[selectedCourse] || [];
        const resourceMemories = courseMemories.filter(m => (m.type === 'file' || m.type === 'document') && !m.isHidden);
        const lectureMemories = courseMemories.filter(m => m.type === 'voice');

        const openScan = () => {
            window.history.pushState({ modal: 'scan' }, '');
            setShowAddDocModal(true);
        };

        const openMoodle = () => {
            window.history.pushState({ modal: 'moodle' }, '');
            setShowMoodleBrowser(true);
        };

        return (
            <div className="flex flex-col h-full max-w-7xl mx-auto">
                 {showAddDocModal && <AddDocumentModal course={selectedCourse} onSave={(m) => { onSave(m); setShowAddDocModal(false); if(window.history.state?.modal === 'scan') window.history.back(); }} onClose={() => { setShowAddDocModal(false); if(window.history.state?.modal === 'scan') window.history.back(); }} />}
                 {showMoodleBrowser && moodleToken && <MoodleBrowser token={moodleToken} courseName={selectedCourse} onImport={handleMoodleImport} onClose={() => { setShowMoodleBrowser(false); if(window.history.state?.modal === 'moodle') window.history.back(); }} />}
                 
                 <header className="flex items-center justify-between mb-6 flex-shrink-0">
                    <div className="flex items-center">
                        <button onClick={() => window.history.back()} className="p-3 mr-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white transition-colors"><ArrowLeftIcon className="w-8 h-8" /></button>
                        <h2 className="text-3xl md:text-4xl font-black truncate uppercase tracking-tighter">{selectedCourse}</h2>
                    </div>
                 </header>

                 <div className="flex mb-8 bg-gray-800/50 p-1.5 rounded-2xl flex-shrink-0 max-w-2xl overflow-x-auto scrollbar-hide">
                    <button onClick={() => setActiveTab('lectures')} className={`flex-1 py-3 px-6 rounded-xl font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'lectures' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}>
                        Lectures
                    </button>
                    <button onClick={() => setActiveTab('resources')} className={`flex-1 py-3 px-6 rounded-xl font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'resources' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}>
                        Resources
                    </button>
                    <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-3 px-6 rounded-xl font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'tasks' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}>
                        Kanban
                    </button>
                 </div>

                {activeTab === 'lectures' ? (
                    <div className="flex-1 min-h-0 space-y-6 overflow-y-auto pr-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button onClick={() => navigateTo('record')} className="flex items-center justify-center gap-4 p-8 bg-blue-600 rounded-[2rem] hover:bg-blue-700 shadow-xl transition-all hover:-translate-y-1 active:scale-95 group">
                                <MicIcon className="w-10 h-10 text-white group-hover:scale-110 transition-transform"/>
                                <span className="text-2xl font-black text-white uppercase">New Recording</span>
                            </button>
                            <button onClick={openScan} className="flex items-center justify-center gap-4 p-8 bg-indigo-600 rounded-[2rem] text-white shadow-xl hover:-translate-y-1 transition-all active:scale-95">
                                <FileTextIcon className="w-10 h-10" /> <span className="text-2xl font-black uppercase text-center">Scan Handout</span>
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                            {lectureMemories.map(mem => (
                                <div key={mem.id} onClick={() => handleSelectItem(mem)} className="bg-gray-800 p-6 rounded-[2rem] border-4 border-gray-800 cursor-pointer hover:border-blue-500 hover:-translate-y-1 transition-all group">
                                    <h3 className="text-xl font-black text-white truncate mb-1 uppercase tracking-tight">{mem.title}</h3>
                                    <p className="text-sm text-gray-500 font-bold mb-4">{new Date(mem.date).toLocaleDateString()}</p>
                                    <div className="flex items-center gap-2">
                                        <div className="p-3 bg-gray-900 rounded-xl"><MicIcon className="w-6 h-6 text-blue-400"/></div>
                                        {(mem as VoiceMemory).summary && <p className="text-xs text-gray-400 italic line-clamp-1">{(mem as VoiceMemory).summary}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : activeTab === 'resources' ? (
                    <div className="flex-1 min-h-0 space-y-6 overflow-y-auto pr-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button onClick={openScan} className="flex items-center justify-center gap-4 p-6 bg-indigo-600 rounded-[2rem] text-white shadow-xl hover:-translate-y-1 transition-all active:scale-95">
                                <FileTextIcon className="w-8 h-8" /> <span className="text-xl font-black uppercase text-center">Scan Document</span>
                            </button>
                            <button onClick={openMoodle} disabled={!moodleToken} className="flex items-center justify-center gap-4 p-6 bg-green-600 rounded-[2rem] text-white shadow-xl hover:-translate-y-1 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale">
                                <GlobeIcon className="w-8 h-8" /> <span className="text-xl font-black uppercase text-center">{moodleToken ? 'Browse Moodle' : 'No Token'}</span>
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                            {resourceMemories.map(mem => (
                                <ResourceItem key={mem.id} resource={mem as FileMemory} onSelect={() => handleSelectItem(mem)} onHide={handleHideItem} />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex-grow min-h-0 overflow-hidden">
                        <KanbanBoard tasks={tasks} category="college" courseFilter={selectedCourse} onUpdateTask={updateTask} onDeleteTask={deleteTask} onAddTask={addTask} memories={lectures} onOpenMemory={handleSelectItem} />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
             <div className="flex mb-6 bg-gray-800/50 p-1.5 rounded-2xl shrink-0 max-w-lg">
                <button onClick={() => setView('courses')} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest transition-all ${activeTab === 'lectures' ? 'bg-gray-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>
                    Folders
                </button>
                <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest transition-all ${activeTab === 'tasks' ? 'bg-gray-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}>
                    Tasks
                </button>
             </div>

             {activeTab === 'tasks' ? (
                 <div className="flex-grow min-h-0 overflow-hidden">
                    <KanbanBoard tasks={tasks} category="college" courseFilter={null} onUpdateTask={updateTask} onDeleteTask={deleteTask} onAddTask={addTask} memories={lectures} onOpenMemory={handleSelectItem} />
                 </div>
             ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div className="flex gap-4 mb-8 flex-shrink-0">
                        <input type="text" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAddCourse()} placeholder="New Folder..." className="flex-grow bg-gray-800 text-white text-xl p-5 rounded-2xl border-4 border-gray-800 focus:border-blue-500 outline-none shadow-inner uppercase font-black"/>
                        <button onClick={handleAddCourse} className="p-5 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-50 shadow-xl transition-all active:scale-95" disabled={!newCourseName.trim()}><PlusCircleIcon className="w-10 h-10" /></button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto space-y-10 pr-1 pb-10">
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {courses.map(course => (
                                <div key={course} onClick={() => handleSelectCourse(course)} className="bg-gray-800 p-8 rounded-[2.5rem] shadow-xl border-4 border-gray-800 cursor-pointer hover:border-blue-500 hover:-translate-y-2 transition-all flex flex-col items-center justify-center aspect-square group">
                                    <FolderIcon className="w-16 h-16 text-blue-400 mb-4 group-hover:scale-110 transition-transform"/>
                                    <span className="text-xl font-black text-center text-white truncate w-full px-2 uppercase tracking-tight">{course}</span>
                                    <span className="text-sm text-gray-500 font-black mt-1">{(memoriesByCourse[course]?.length || 0)} ITEMS</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             )}
        </div>
    );
};

export default CollegeView;
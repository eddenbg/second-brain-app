
import React, { useState, useMemo, useEffect } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task } from '../types';
import { generateSummaryForContent, generateSpeechFromText } from '../services/geminiService';
import { generatePDF } from '../services/pdfService';
import { decode, decodeAudioData } from '../utils/audio';
import Recorder from './Recorder';
import QASession from './QASession';
import TemporaryScanView from './TemporaryScanView';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import { FolderIcon, MicIcon, PlusCircleIcon, ArrowLeftIcon, BrainCircuitIcon, FileTextIcon, CameraIcon, Volume2Icon, Loader2Icon, DownloadIcon } from './Icons';

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
}


const LectureDetailView: React.FC<{
    lecture: VoiceMemory;
    onBack: () => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ lecture, onBack, onUpdate }) => {
    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4">
                <button onClick={onBack} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h2 className="text-xl font-bold truncate">{lecture.title}</h2>
            </header>
            
            <div className="mb-4 bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Summary:</h3>
                <p className="text-gray-200 italic">
                    {lecture.summary ? lecture.summary : 'Summary is being generated...'}
                </p>
            </div>
            <div className="flex-grow overflow-y-auto bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Full Transcript:</h3>
                <p className="text-gray-200 whitespace-pre-wrap">{lecture.transcript}</p>
            </div>
            <div className="flex-shrink-0">
                 <h3 className="text-lg font-semibold text-gray-300 mb-2 text-center">Ask about this lecture:</h3>
                <div className="h-[30vh] border border-gray-700 rounded-lg">
                   <QASession memories={[lecture]} tasks={[]} />
                </div>
            </div>
        </div>
    );
};

const DocumentDetailView: React.FC<{
    doc: DocumentMemory;
    onBack: () => void;
}> = ({ doc, onBack }) => {
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioContextRef = React.useRef<AudioContext | null>(null);
    const audioSourceRef = React.useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        return () => {
            audioSourceRef.current?.stop();
            audioContextRef.current?.close();
        };
    }, []);

    const handleReadAloud = async () => {
        if (isLoadingAudio || isPlaying) return;
        setIsLoadingAudio(true);
        try {
            const audioB64 = await generateSpeechFromText(doc.extractedText);
            if (audioB64 && audioContextRef.current) {
                const audioData = decode(audioB64);
                const audioBuffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
                
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                source.onended = () => setIsPlaying(false);
                source.start(0);
                audioSourceRef.current = source;
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Failed to play audio", error);
        } finally {
            setIsLoadingAudio(false);
        }
    };
    
    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4">
                <button onClick={onBack} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button>
                <h2 className="text-xl font-bold truncate">{doc.title}</h2>
            </header>
            <div className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto mb-4">
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex justify-center items-center"><img src={doc.imageDataUrl} alt="Scanned document" className="max-w-full max-h-full object-contain rounded-md"/></div>
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-y-auto">
                    <div className="flex flex-col gap-2 mb-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-gray-300">Extracted Text:</h3>
                            <button onClick={handleReadAloud} disabled={isLoadingAudio || isPlaying} className="flex items-center gap-2 px-3 py-1 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:bg-gray-500 text-sm">
                                {isLoadingAudio ? <Loader2Icon className="w-4 h-4 animate-spin"/> : <Volume2Icon className="w-4 h-4"/>}
                                {isLoadingAudio ? '...' : isPlaying ? 'Stop' : 'Read'}
                            </button>
                        </div>
                        <button 
                            onClick={() => generatePDF(doc.title, doc.extractedText, doc.imageDataUrl)}
                            className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-500 text-sm w-full"
                        >
                            <DownloadIcon className="w-4 h-4" /> Download PDF
                        </button>
                    </div>
                    <p className="text-gray-200 whitespace-pre-wrap">{doc.extractedText}</p>
                </div>
            </div>
             <div className="flex-shrink-0">
                 <h3 className="text-lg font-semibold text-gray-300 mb-2 text-center">Ask about this document:</h3>
                <div className="h-[30vh] border border-gray-700 rounded-lg">
                   <QASession memories={[doc]} tasks={[]} />
                </div>
            </div>
        </div>
    );
};

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdate, bulkDelete, courses, addCourse, tasks, addTask, updateTask, deleteTask }) => {
    type View = 'courses' | 'lectures' | 'lectureDetail' | 'documentDetail' | 'qa' | 'record' | 'temporaryScan';
    const [view, setView] = useState<View>('courses');
    const [showAddDocModal, setShowAddDocModal] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedLecture, setSelectedLecture] = useState<VoiceMemory | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<DocumentMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');
    const [activeTab, setActiveTab] = useState<'content' | 'tasks'>('content'); 

    const allCourses = useMemo(() => {
        const coursesFromMemories = lectures.map(l => l.course).filter(Boolean) as string[];
        return [...new Set([...coursesFromMemories, ...courses])].sort();
    }, [lectures, courses]);
    
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

    useEffect(() => {
        const lecturesWithoutSummary = lectures.filter(
            l => l.type === 'voice' && l.category === 'college' && !l.summary && l.transcript
        );

        if (lecturesWithoutSummary.length > 0) {
            lecturesWithoutSummary.forEach(async lecture => {
                if (lecture.type === 'voice') {
                    const summary = await generateSummaryForContent(lecture.transcript);
                    if (summary) onUpdate(lecture.id, { summary });
                }
            });
        }
    }, [lectures, onUpdate]);

    const handleAddCourse = () => {
        if (newCourseName.trim() && !allCourses.includes(newCourseName.trim())) {
            addCourse(newCourseName.trim());
            setNewCourseName('');
        }
    };
    
    const handleSaveMemory = (mem: Omit<AnyMemory, 'id'|'date'|'category'>) => {
        // Category and Course are handled inside AddDocumentModal for documents, but need ensuring here for Recorder
        // Recorder returns Omit<VoiceMemory...>, we assume 'college' category.
        onSave({ ...mem, category: 'college', course: selectedCourse || 'General' });
        setView('lectures');
    };
    
    const handleSaveDocument = (mem: Omit<DocumentMemory, 'id'|'date'>) => {
        // AddDocumentModal already sets category/course
        onSave(mem); 
        setShowAddDocModal(false);
    }

    const handleSelectCourse = (course: string) => {
        setSelectedCourse(course);
        setView('lectures');
        setActiveTab('content'); // Default to content
    };

    const handleSelectItem = (item: AnyMemory) => {
        if (item.type === 'voice') {
            setSelectedLecture(item as VoiceMemory);
            setView('lectureDetail');
        } else if (item.type === 'document') {
            setSelectedDocument(item as DocumentMemory);
            setView('documentDetail');
        }
    };
    
    if (view === 'temporaryScan') {
        return <TemporaryScanView onClose={() => setView('courses')} />;
    }

    if (view === 'record') {
        return <Recorder onSave={(mem) => handleSaveMemory(mem as Omit<VoiceMemory, 'id'|'date'|'category'>)} onCancel={() => setView('lectures')} titlePlaceholder={`${selectedCourse} - ${new Date().toLocaleDateString()}`} saveButtonText="Save Lecture" />;
    }
    
    if (view === 'lectureDetail' && selectedLecture) {
        return <LectureDetailView lecture={selectedLecture} onBack={() => setView('lectures')} onUpdate={onUpdate} />;
    }
    
    if (view === 'documentDetail' && selectedDocument) {
        return <DocumentDetailView doc={selectedDocument} onBack={() => setView('lectures')} />;
    }

    if (view === 'qa') {
        return (
            <div className="flex flex-col h-full">
                <header className="flex items-center mb-4"><button onClick={() => setView('courses')} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button><h2 className="text-xl font-bold">Ask About All College Notes</h2></header>
                <div className="flex-grow border border-gray-700 rounded-lg"><QASession memories={lectures} tasks={[]} /></div>
            </div>
        );
    }

    // --- Course Detail View (Includes Kanban) ---
    if (view === 'lectures' && selectedCourse) {
        const courseMemories = memoriesByCourse[selectedCourse] || [];
        
        return (
            <div className="flex flex-col h-full">
                 {showAddDocModal && (
                    <AddDocumentModal 
                        course={selectedCourse} 
                        onSave={handleSaveDocument} 
                        onClose={() => setShowAddDocModal(false)}
                    />
                 )}
                 <header className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                        <button onClick={() => setView('courses')} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button>
                        <h2 className="text-2xl font-bold truncate">{selectedCourse}</h2>
                    </div>
                 </header>

                 {/* Tab Switcher */}
                 <div className="flex mb-4 bg-gray-800 rounded-lg p-1">
                    <button onClick={() => setActiveTab('content')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'content' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                        Lectures & Docs
                    </button>
                    <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'tasks' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                        Tasks (Kanban)
                    </button>
                 </div>

                {activeTab === 'content' ? (
                    <div className="space-y-4 overflow-y-auto">
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => setView('record')} className="w-full flex items-center justify-center gap-2 p-4 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"><MicIcon className="w-6 h-6 text-white"/><span className="text-lg font-semibold text-white">Record Lecture</span></button>
                            <button onClick={() => setShowAddDocModal(true)} className="w-full flex items-center justify-center gap-2 p-4 bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"><FileTextIcon className="w-6 h-6 text-white"/><span className="text-lg font-semibold text-white">Scan Document</span></button>
                        </div>
                        {courseMemories.length === 0 ? <p className="text-center text-gray-400 py-8">No lectures or documents for this course yet.</p>
                        : courseMemories.map(mem => (
                                <div key={mem.id} onClick={() => handleSelectItem(mem)} className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 cursor-pointer hover:border-blue-500 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-1">{mem.type === 'voice' ? <MicIcon className="w-5 h-5 text-blue-400"/> : <FileTextIcon className="w-5 h-5 text-indigo-400"/>}</div>
                                        <div className="flex-grow">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-semibold text-white">{mem.title}</h3>
                                                {mem.type === 'document' && <span className="bg-indigo-900 text-indigo-200 text-[10px] font-bold px-1.5 py-0.5 rounded">OCR</span>}
                                            </div>
                                            <p className="text-sm text-gray-400 mb-2">{new Date(mem.date).toLocaleString()}</p>
                                            {mem.type === 'voice' && (mem as VoiceMemory).summary && (
                                                <div className="border-t border-gray-700 pt-2 mt-2">
                                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Summary</h4>
                                                    <p className="text-sm text-gray-300 italic">{(mem as VoiceMemory).summary || "Generating summary..."}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                ) : (
                    <div className="flex-grow overflow-hidden">
                        <KanbanBoard 
                            tasks={tasks} 
                            category="college"
                            courseFilter={selectedCourse} 
                            onUpdateTask={updateTask} 
                            onDeleteTask={deleteTask}
                            onAddTask={addTask}
                            memories={lectures}
                            onOpenMemory={handleSelectItem}
                        />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Top Level Tabs */}
             <div className="flex mb-4 bg-gray-800 rounded-lg p-1 shrink-0">
                <button onClick={() => setActiveTab('content')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'content' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    Courses
                </button>
                <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'tasks' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    All Tasks
                </button>
             </div>

             {activeTab === 'tasks' ? (
                 <div className="flex-grow overflow-hidden">
                    <KanbanBoard 
                        tasks={tasks} 
                        category="college"
                        courseFilter={null} 
                        onUpdateTask={updateTask} 
                        onDeleteTask={deleteTask}
                        onAddTask={addTask}
                        memories={lectures}
                        onOpenMemory={handleSelectItem}
                    />
                 </div>
             ) : (
                <div className="space-y-6 overflow-y-auto">
                    <div className="space-y-4">
                        <div className="flex gap-2">
                            <input type="text" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAddCourse()} placeholder="Create a new course folder" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"/>
                            <button onClick={handleAddCourse} className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={!newCourseName.trim()}><PlusCircleIcon className="w-6 h-6" /></button>
                        </div>
                        {allCourses.length === 0 ? <div className="text-center py-10 px-6 bg-gray-800 rounded-lg"><FolderIcon className="w-12 h-12 mx-auto text-gray-500"/><p className="mt-2 text-gray-400">Create your first course folder above.</p></div>
                        : <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">{allCourses.map(course => (<div key={course} onClick={() => handleSelectCourse(course)} className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 cursor-pointer hover:border-blue-500 transition-colors flex flex-col items-center justify-center aspect-square"><FolderIcon className="w-12 h-12 text-blue-400 mb-2"/><span className="text-lg font-semibold text-center text-white">{course}</span><span className="text-sm text-gray-400">{(memoriesByCourse[course]?.length || 0)} items</span></div>))}</div>}
                    </div>
                    <div className="border-t border-gray-700 pt-6 space-y-4">
                        <h2 className="text-2xl font-bold text-white">Tools</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button onClick={() => setView('qa')} className="text-left p-4 bg-purple-800 bg-opacity-50 rounded-lg hover:bg-opacity-70 transition-colors flex flex-col justify-between h-32">
                                <div>
                                    <BrainCircuitIcon className="w-8 h-8 text-purple-300 mb-2"/>
                                    <span className="text-xl font-semibold text-white">Ask AI about College</span>
                                </div>
                                <p className="text-sm font-normal text-purple-200">Chat with all your saved notes.</p>
                            </button>
                            <button onClick={() => setView('temporaryScan')} className="text-left p-4 bg-cyan-800 bg-opacity-50 rounded-lg hover:bg-opacity-70 transition-colors flex flex-col justify-between h-32">
                                <div>
                                    <CameraIcon className="w-8 h-8 text-cyan-300 mb-2"/>
                                    <span className="text-xl font-semibold text-white">Quick Scan</span>
                                </div>
                                <p className="text-sm font-normal text-cyan-200">Scan, listen, and chat without saving.</p>
                            </button>
                        </div>
                    </div>
                </div>
             )}
        </div>
    );
};

export default CollegeView;

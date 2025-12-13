
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, TaskStatus } from '../types';
import { generateSummaryForContent, extractTextFromImage, generateTitleForContent, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import Recorder from './Recorder';
import QASession from './QASession';
import TemporaryScanView from './TemporaryScanView';
import { FolderIcon, MicIcon, PlusCircleIcon, ArrowLeftIcon, BrainCircuitIcon, BookOpenIcon, TrashIcon, FileTextIcon, CameraIcon, UploadIcon, Volume2Icon, Loader2Icon, SaveIcon, CheckIcon, ListIcon, EditIcon, LinkIcon, XIcon, PlusIcon } from './Icons';
import { getCurrentLocation } from '../utils/location';

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

// --- SUB-COMPONENTS FOR KANBAN ---

const AddTaskModal: React.FC<{
    course: string;
    onClose: () => void;
    onSave: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    availableMemories: AnyMemory[];
}> = ({ course, onClose, onSave, availableMemories }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedMemories, setSelectedMemories] = useState<Set<string>>(new Set());

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        
        onSave({
            title,
            description,
            status: 'todo',
            course: course === 'All' ? 'General' : course,
            linkedMemoryIds: Array.from(selectedMemories)
        });
        onClose();
    };

    const toggleMemory = (id: string) => {
        setSelectedMemories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600 max-h-[90vh] flex flex-col">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold text-white">Add Task to {course === 'All' ? 'General' : course}</h2>
                    <button onClick={onClose}><XIcon className="w-6 h-6 text-gray-400" /></button>
                </header>
                <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-gray-300 text-sm font-bold mb-2">Title</label>
                        <input className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-blue-500" value={title} onChange={e => setTitle(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-gray-300 text-sm font-bold mb-2">Description</label>
                        <textarea className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                    
                    {availableMemories.length > 0 && (
                        <div>
                             <label className="block text-gray-300 text-sm font-bold mb-2">Link Documents</label>
                             <div className="bg-gray-700 rounded p-2 max-h-40 overflow-y-auto space-y-2">
                                 {availableMemories.map(mem => (
                                     <div key={mem.id} onClick={() => toggleMemory(mem.id)} className={`p-2 rounded cursor-pointer border flex items-center justify-between ${selectedMemories.has(mem.id) ? 'bg-blue-900 border-blue-500' : 'border-gray-600 hover:bg-gray-600'}`}>
                                         <span className="text-sm truncate">{mem.title}</span>
                                         {selectedMemories.has(mem.id) && <CheckIcon className="w-4 h-4 text-blue-400"/>}
                                     </div>
                                 ))}
                             </div>
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-600 rounded text-white">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 rounded text-white font-bold">Add Task</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const TaskCard: React.FC<{
    task: Task;
    onUpdate: (id: string, updates: Partial<Task>) => void;
    onDelete: (id: string) => void;
    memories: AnyMemory[];
    onOpenMemory: (mem: AnyMemory) => void;
}> = ({ task, onUpdate, onDelete, memories, onOpenMemory }) => {
    
    const linkedDocs = useMemo(() => {
        if (!task.linkedMemoryIds) return [];
        return memories.filter(m => task.linkedMemoryIds?.includes(m.id));
    }, [task.linkedMemoryIds, memories]);

    const moveNext = () => {
        if (task.status === 'todo') onUpdate(task.id, { status: 'in-progress' });
        else if (task.status === 'in-progress') onUpdate(task.id, { status: 'done' });
    }

    const movePrev = () => {
        if (task.status === 'done') onUpdate(task.id, { status: 'in-progress' });
        else if (task.status === 'in-progress') onUpdate(task.id, { status: 'todo' });
    }

    return (
        <div className="bg-gray-700 p-3 rounded-lg shadow-sm border border-gray-600 mb-3 hover:border-blue-400 transition-colors">
            <div className="flex justify-between items-start mb-1">
                <h4 className="font-semibold text-white text-sm">{task.title}</h4>
                <button onClick={() => onDelete(task.id)} className="text-gray-400 hover:text-red-400"><XIcon className="w-4 h-4"/></button>
            </div>
            {task.description && <p className="text-xs text-gray-300 mb-2">{task.description}</p>}
            
            {task.course && task.course !== 'General' && (
                <span className="inline-block bg-gray-800 text-gray-400 text-[10px] px-2 py-0.5 rounded-full mb-2">
                    {task.course}
                </span>
            )}

            {linkedDocs.length > 0 && (
                <div className="mb-2 space-y-1">
                    {linkedDocs.map(doc => (
                        <button key={doc.id} onClick={() => onOpenMemory(doc)} className="flex items-center gap-1 text-[10px] text-blue-300 hover:underline w-full text-left truncate">
                            <LinkIcon className="w-3 h-3 flex-shrink-0" /> {doc.title}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex justify-between items-center mt-2 border-t border-gray-600 pt-2">
                <button 
                    onClick={movePrev} 
                    disabled={task.status === 'todo'}
                    className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-2"
                >
                    ←
                </button>
                <span className="text-[10px] text-gray-500 uppercase font-bold">{task.status.replace('-', ' ')}</span>
                <button 
                    onClick={moveNext} 
                    disabled={task.status === 'done'}
                    className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-2"
                >
                    →
                </button>
            </div>
        </div>
    );
};

const KanbanBoard: React.FC<{
    tasks: Task[];
    courseFilter: string | null;
    onUpdateTask: (id: string, updates: Partial<Task>) => void;
    onDeleteTask: (id: string) => void;
    onAddTask: () => void;
    memories: AnyMemory[];
    onOpenMemory: (mem: AnyMemory) => void;
}> = ({ tasks, courseFilter, onUpdateTask, onDeleteTask, onAddTask, memories, onOpenMemory }) => {
    
    const filteredTasks = useMemo(() => {
        if (!courseFilter || courseFilter === 'All') return tasks;
        return tasks.filter(t => t.course === courseFilter);
    }, [tasks, courseFilter]);

    const columns: { id: TaskStatus; label: string; color: string }[] = [
        { id: 'todo', label: 'To Do', color: 'border-red-500' },
        { id: 'in-progress', label: 'In Progress', color: 'border-yellow-500' },
        { id: 'done', label: 'Done', color: 'border-green-500' }
    ];

    return (
        <div className="h-full flex flex-col">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-200">
                    {courseFilter === 'All' || !courseFilter ? 'All Tasks' : `${courseFilter} Tasks`}
                </h3>
                <button onClick={onAddTask} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700">
                    <PlusIcon className="w-4 h-4"/> Add Task
                </button>
            </div>
            
            <div className="flex-grow overflow-x-auto">
                <div className="flex gap-4 min-w-[600px] h-full">
                    {columns.map(col => (
                        <div key={col.id} className="flex-1 bg-gray-800 rounded-lg border border-gray-700 flex flex-col min-w-[200px]">
                            <div className={`p-3 border-b-2 ${col.color} bg-gray-800 rounded-t-lg`}>
                                <h4 className="font-bold text-gray-300">{col.label}</h4>
                            </div>
                            <div className="p-2 flex-grow overflow-y-auto">
                                {filteredTasks.filter(t => t.status === col.id).map(task => (
                                    <TaskCard 
                                        key={task.id} 
                                        task={task} 
                                        onUpdate={onUpdateTask} 
                                        onDelete={onDeleteTask}
                                        memories={memories}
                                        onOpenMemory={onOpenMemory}
                                    />
                                ))}
                                {filteredTasks.filter(t => t.status === col.id).length === 0 && (
                                    <p className="text-center text-gray-600 text-xs mt-4">No tasks</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};


// --- EXISTING COMPONENT LOGIC ---

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
            
             {/* Audio Player Added to Detail View as well */}
             {lecture.audioDataUrl && (
                <div className="mb-4 bg-gray-800 rounded-lg p-3 border border-gray-700">
                     <h4 className="text-sm font-bold text-gray-400 mb-2 uppercase tracking-wide">Playback</h4>
                     <audio controls src={lecture.audioDataUrl} className="w-full h-10" />
                </div>
             )}

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
                   <QASession memories={[lecture]} />
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
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

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
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-semibold text-gray-300">Extracted Text:</h3>
                        <button onClick={handleReadAloud} disabled={isLoadingAudio || isPlaying} className="flex items-center gap-2 px-3 py-1 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:bg-gray-500">
                            {isLoadingAudio ? <Loader2Icon className="w-5 h-5 animate-spin"/> : <Volume2Icon className="w-5 h-5"/>}
                            {isLoadingAudio ? 'Generating...' : isPlaying ? 'Playing...' : 'Read Aloud'}
                        </button>
                    </div>
                    <p className="text-gray-200 whitespace-pre-wrap">{doc.extractedText}</p>
                </div>
            </div>
             <div className="flex-shrink-0">
                 <h3 className="text-lg font-semibold text-gray-300 mb-2 text-center">Ask about this document:</h3>
                <div className="h-[30vh] border border-gray-700 rounded-lg">
                   <QASession memories={[doc]} />
                </div>
            </div>
        </div>
    );
};

const AddDocumentView: React.FC<{
    course: string;
    onSave: (memory: Omit<DocumentMemory, 'id'|'date'|'category'>) => void;
    onCancel: () => void;
}> = ({ course, onSave, onCancel }) => {
    const [title, setTitle] = useState('');
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [extractedText, setExtractedText] = useState('');
    const [isLoading, setIsLoading] = useState<'camera'|'ocr'|'title'|null>(null);
    const [error, setError] = useState<string|null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => { return () => { stopCamera(); }; }, [stopCamera]);

    const startCamera = async () => {
        stopCamera();
        setImageDataUrl(null);
        setError(null);
        setIsLoading('camera');
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            setStream(mediaStream);
        } catch (err) { setError("Could not access camera. Please check permissions."); }
        finally { setIsLoading(null); }
    };

    useEffect(() => { if (stream && videoRef.current) { videoRef.current.srcObject = stream; } }, [stream]);

    const takePicture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d')?.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
            const dataUrl = canvas.toDataURL('image/jpeg');
            setImageDataUrl(dataUrl);
            stopCamera();
        }
    };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImageDataUrl(e.target?.result as string);
                stopCamera();
            };
            reader.readAsDataURL(file);
        } else {
            setError('Please select a valid image file.');
        }
    };

    const handleExtractText = async () => {
        if (!imageDataUrl) return;
        setIsLoading('ocr');
        setError(null);
        try {
            const base64Data = imageDataUrl.split(',')[1];
            const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
            const text = await extractTextFromImage(base64Data, mimeType);
            setExtractedText(text);
        } catch (e) { setError("Failed to extract text."); }
        finally { setIsLoading(null); }
    };
    
    const handleGenerateTitle = async () => {
        if (!extractedText.trim()) return;
        setIsLoading('title');
        setTitle(await generateTitleForContent(extractedText));
        setIsLoading(null);
    };

    const handleSave = async () => {
        if (!imageDataUrl || !title.trim() || !extractedText.trim()) return;
        const location = await getCurrentLocation();
        onSave({ type: 'document', title, imageDataUrl, extractedText, course, ...(location && { location }) });
    };

    const renderContent = () => {
        if (extractedText) {
             return (
                <div className="space-y-4">
                     <div className="w-full bg-gray-800 rounded-lg p-2 border border-gray-700 flex justify-center items-center">
                        <img src={imageDataUrl || ''} alt="Scanned document source" className="max-h-60 object-contain rounded-md"/>
                     </div>
                     
                     <div className="flex gap-2">
                           <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter a title for the document" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600"/>
                           <button onClick={handleGenerateTitle} disabled={isLoading === 'title'} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2 flex-shrink-0">
                               <BrainCircuitIcon className="w-5 h-5"/> {isLoading === 'title' ? '...' : 'Generate'}
                           </button>
                    </div>
                     <textarea value={extractedText} onChange={e => setExtractedText(e.target.value)} rows={8} className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600"/>
                </div>
            )
        }
        if (imageDataUrl) {
            return (
                <div className="space-y-4 text-center">
                    <img src={imageDataUrl} alt="Preview" className="max-h-96 w-full object-contain rounded-md" />
                    <div className="flex gap-4 justify-center">
                        <button onClick={() => setImageDataUrl(null)} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Retake</button>
                        <button onClick={handleExtractText} disabled={isLoading === 'ocr'} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-500">
                             {isLoading === 'ocr' ? 'Extracting...' : 'Extract Text'}
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="space-y-4 text-center">
                <div className="w-full aspect-video bg-gray-900 rounded-md flex items-center justify-center relative overflow-hidden border border-gray-700">
                    <canvas ref={canvasRef} className="hidden" />
                    {stream ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                        : <CameraIcon className="w-16 h-16 mx-auto text-gray-500" />
                    }
                </div>
                {stream ? (
                    <button onClick={takePicture} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto">
                        <CameraIcon className="w-5 h-5"/> Take Picture
                    </button>
                ) : (
                     <div className="flex gap-4 justify-center">
                        <button onClick={startCamera} disabled={isLoading==='camera'} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                           {isLoading==='camera' ? <Loader2Icon className="animate-spin w-5 h-5"/> : <CameraIcon className="w-5 h-5"/>} Open Camera
                        </button>
                         <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 flex items-center gap-2">
                            <UploadIcon className="w-5 h-5"/> Upload Image
                        </button>
                         <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                    </div>
                )}
            </div>
        )
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center mb-4">
                <button onClick={onCancel} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <h2 className="text-xl font-bold truncate">Add Document to {course}</h2>
            </header>
            <div className="flex-grow overflow-y-auto bg-gray-800 rounded-lg p-4 border border-gray-700">
                {renderContent()}
            </div>
            {extractedText && (
                 <div className="mt-4 flex justify-end border-t border-gray-700 pt-4">
                    <button onClick={handleSave} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2">
                        <SaveIcon className="w-6 h-6"/> Save Document
                    </button>
                </div>
            )}
        </div>
    );
};

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdate, bulkDelete, courses, addCourse, tasks, addTask, updateTask, deleteTask }) => {
    type View = 'courses' | 'lectures' | 'lectureDetail' | 'documentDetail' | 'qa' | 'record' | 'addDocument' | 'temporaryScan';
    const [view, setView] = useState<View>('courses');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedLecture, setSelectedLecture] = useState<VoiceMemory | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<DocumentMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');
    const [activeTab, setActiveTab] = useState<'content' | 'tasks'>('content'); // Toggle between lectures/docs and kanban
    const [showAddTask, setShowAddTask] = useState(false);

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
        onSave({ ...mem, category: 'college', course: selectedCourse || 'General' });
        setView('lectures');
    };

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
    
    // --- Render Logic ---

    if (view === 'temporaryScan') {
        return <TemporaryScanView onClose={() => setView('courses')} />;
    }
    
    if (view === 'addDocument' && selectedCourse) {
        return <AddDocumentView course={selectedCourse} onSave={handleSaveMemory} onCancel={() => setView('lectures')} />;
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
                <div className="flex-grow border border-gray-700 rounded-lg"><QASession memories={lectures} /></div>
            </div>
        );
    }

    // --- Course Detail View (Includes Kanban) ---
    if (view === 'lectures' && selectedCourse) {
        const courseMemories = memoriesByCourse[selectedCourse] || [];
        
        return (
            <div className="flex flex-col h-full">
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
                            <button onClick={() => setView('addDocument')} className="w-full flex items-center justify-center gap-2 p-4 bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"><FileTextIcon className="w-6 h-6 text-white"/><span className="text-lg font-semibold text-white">Scan Document</span></button>
                        </div>
                        {courseMemories.length === 0 ? <p className="text-center text-gray-400 py-8">No lectures or documents for this course yet.</p>
                        : courseMemories.map(mem => (
                                <div key={mem.id} onClick={() => handleSelectItem(mem)} className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 cursor-pointer hover:border-blue-500 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-1">{mem.type === 'voice' ? <MicIcon className="w-5 h-5 text-blue-400"/> : <FileTextIcon className="w-5 h-5 text-indigo-400"/>}</div>
                                        <div className="flex-grow">
                                            <h3 className="text-lg font-semibold text-white">{mem.title}</h3>
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
                        {showAddTask && (
                            <AddTaskModal 
                                course={selectedCourse} 
                                onClose={() => setShowAddTask(false)} 
                                onSave={addTask} 
                                availableMemories={courseMemories} 
                            />
                        )}
                        <KanbanBoard 
                            tasks={tasks} 
                            courseFilter={selectedCourse} 
                            onUpdateTask={updateTask} 
                            onDeleteTask={deleteTask}
                            onAddTask={() => setShowAddTask(true)}
                            memories={lectures}
                            onOpenMemory={handleSelectItem}
                        />
                    </div>
                )}
            </div>
        );
    }

    // --- Main Dashboard View ---
    
    // We want to show "All Tasks" here too maybe?
    // Let's modify the top section to have tabs too if the user wants a "Bird's Eye View" of tasks

    return (
        <div className="flex flex-col h-full">
            {/* Top Level Tabs */}
             <div className="flex mb-4 bg-gray-800 rounded-lg p-1 shrink-0">
                <button onClick={() => setActiveTab('content')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'content' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    Courses
                </button>
                <button onClick={() => setActiveTab('tasks')} className={`flex-1 py-2 rounded-md font-semibold transition-colors ${activeTab === 'tasks' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                    All Tasks (Bird's Eye)
                </button>
             </div>

             {activeTab === 'tasks' ? (
                 <div className="flex-grow overflow-hidden">
                    {showAddTask && (
                        <AddTaskModal 
                            course="All" 
                            onClose={() => setShowAddTask(false)} 
                            onSave={addTask} 
                            availableMemories={lectures} 
                        />
                    )}
                    <KanbanBoard 
                        tasks={tasks} 
                        courseFilter={null} 
                        onUpdateTask={updateTask} 
                        onDeleteTask={deleteTask}
                        onAddTask={() => setShowAddTask(true)}
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

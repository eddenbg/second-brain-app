import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { AnyMemory, VoiceMemory, DocumentMemory } from '../types';
import { generateSummaryForContent, extractTextFromImage, generateTitleForContent, generateSpeechFromText } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import Recorder from './Recorder';
import QASession from './QASession';
import TemporaryScanView from './TemporaryScanView';
import { FolderIcon, MicIcon, PlusCircleIcon, ArrowLeftIcon, BrainCircuitIcon, BookOpenIcon, TrashIcon, FileTextIcon, CameraIcon, UploadIcon, Volume2Icon, Loader2Icon } from './Icons';
import { getCurrentLocation } from '../utils/location';

interface CollegeViewProps {
    lectures: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDelete: (ids: string[]) => void;
    courses: string[];
    addCourse: (courseName: string) => void;
}

const LectureDetailView: React.FC<{
    lecture: VoiceMemory;
    onBack: () => void;
    onUpdate: (id: string, updates: Partial<AnyMemory>) => void;
}> = ({ lecture, onBack, onUpdate }) => {
    const [editingSpeakerId, setEditingSpeakerId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');

    const handleEditSpeakerName = (speakerId: number, currentName: string) => {
        setEditingSpeakerId(speakerId);
        setEditText(currentName);
    };

    const handleSaveSpeakerName = () => {
        if (editingSpeakerId === null || !lecture.structuredTranscript || !lecture.speakerMappings) return;

        const newName = editText.trim();
        if (!newName) { // Don't save empty names
            setEditingSpeakerId(null);
            return;
        }

        const newMappings = {
            ...lecture.speakerMappings,
            [editingSpeakerId]: newName,
        };
        
        const newTranscript = lecture.structuredTranscript.map((segment, index) => {
            const speakerLabel = newMappings[segment.speakerId] || `Speaker ${segment.speakerId}`;
            const prevSegment = index > 0 ? lecture.structuredTranscript[index - 1] : null;
            
            if (!prevSegment || segment.speakerId !== prevSegment.speakerId) {
                return `${index > 0 ? '\n\n' : ''}${speakerLabel}: ${segment.text}`;
            }
            return segment.text;
        }).join('');

        onUpdate(lecture.id, {
            speakerMappings: newMappings,
            transcript: newTranscript,
        });

        setEditingSpeakerId(null);
        setEditText('');
    };
    
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
                 {lecture.structuredTranscript && lecture.speakerMappings ? (
                    <div className="text-gray-200 space-y-4">
                        {lecture.structuredTranscript.map((segment, index) => {
                            const speakerLabel = lecture.speakerMappings?.[segment.speakerId] || `Speaker ${segment.speakerId}`;
                            const isEditingCurrent = editingSpeakerId === segment.speakerId;
                            return (
                                <div key={index} className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                                    <div className="font-bold text-blue-400 w-full sm:w-32 flex-shrink-0 sm:text-right">
                                        {isEditingCurrent ? (
                                            <input
                                                type="text"
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                                onBlur={handleSaveSpeakerName}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveSpeakerName();
                                                    if (e.key === 'Escape') setEditingSpeakerId(null);
                                                }}
                                                className="bg-gray-700 text-white p-1 rounded-md w-full sm:w-auto focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                                autoFocus
                                            />
                                        ) : (
                                            <button 
                                                onClick={() => handleEditSpeakerName(segment.speakerId, speakerLabel)} 
                                                className="text-left sm:text-right hover:text-blue-300 w-full text-blue-400 font-bold px-1"
                                                aria-label={`Edit name for ${speakerLabel}`}
                                            >
                                                {speakerLabel}:
                                            </button>
                                        )}
                                    </div>
                                    <p className="flex-grow whitespace-pre-wrap">{segment.text}</p>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-gray-200 whitespace-pre-wrap">{lecture.transcript}</p>
                )}
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
                     <textarea value={extractedText} onChange={e => setExtractedText(e.target.value)} rows={10} className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600"/>
                     <div className="flex gap-2">
                           <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Enter a title for the document" className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600"/>
                           <button onClick={handleGenerateTitle} disabled={isLoading === 'title'} className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 flex items-center gap-2">
                               <BrainCircuitIcon className="w-5 h-5"/> {isLoading === 'title' ? '...' : 'Generate'}
                           </button>
                    </div>
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
        <div>
            <header className="flex items-center mb-4">
                <button onClick={onCancel} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button>
                <h2 className="text-2xl font-bold">Add Document to {course}</h2>
            </header>
            <div className="space-y-4">
                {renderContent()}
                {error && <p className="text-center text-red-400">{error}</p>}
            </div>
            {extractedText && <button onClick={handleSave} disabled={!title.trim()} className="mt-6 w-full p-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-500">Save Document</button>}
        </div>
    )
};

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdate, bulkDelete, courses, addCourse }) => {
    type View = 'courses' | 'lectures' | 'lectureDetail' | 'documentDetail' | 'qa' | 'record' | 'addDocument' | 'temporaryScan';
    const [view, setView] = useState<View>('courses');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedLecture, setSelectedLecture] = useState<VoiceMemory | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<DocumentMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');

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
    
    if (view === 'addDocument' && selectedCourse) {
        return <AddDocumentView course={selectedCourse} onSave={handleSaveMemory} onCancel={() => setView('lectures')} />;
    }

    if (view === 'record') {
        return <Recorder onSave={(mem) => handleSaveMemory(mem as Omit<VoiceMemory, 'id'|'date'|'category'>)} onCancel={() => setView('lectures')} titlePlaceholder={`${selectedCourse} - ${new Date().toLocaleDateString()}`} saveButtonText="Save Lecture" enableDiarization={true}/>;
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

    if (view === 'lectures' && selectedCourse) {
        const courseMemories = memoriesByCourse[selectedCourse] || [];
        return (
            <div className="space-y-4">
                 <header className="flex items-center mb-4"><button onClick={() => setView('courses')} className="p-2 mr-2 rounded-full hover:bg-gray-700"><ArrowLeftIcon className="w-6 h-6" /></button><h2 className="text-2xl font-bold">{selectedCourse}</h2></header>
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
                )}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white">My Courses</h2>
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
    );
};

export default CollegeView;

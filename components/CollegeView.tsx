import React, { useState, useMemo, useEffect } from 'react';
import type { AnyMemory, VoiceMemory } from '../types';
import { generateSummaryForContent } from '../services/geminiService';
import Recorder from './Recorder';
import QASession from './QASession';
import { FolderIcon, MicIcon, PlusCircleIcon, ArrowLeftIcon, BrainCircuitIcon, BookOpenIcon, TrashIcon } from './Icons';

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
        
        // Regenerate flat transcript with new speaker names
        const newTranscript = lecture.structuredTranscript.map((segment, index) => {
            const speakerLabel = newMappings[segment.speakerId] || `Speaker ${segment.speakerId}`;
            const prevSegment = index > 0 ? lecture.structuredTranscript[index - 1] : null;
            
            // Add speaker label only if it's different from the previous one
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

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdate, bulkDelete, courses, addCourse }) => {
    type View = 'courses' | 'lectures' | 'lectureDetail' | 'qa' | 'record';
    const [view, setView] = useState<View>('courses');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [selectedLecture, setSelectedLecture] = useState<VoiceMemory | null>(null);
    const [newCourseName, setNewCourseName] = useState('');

    const allCourses = useMemo(() => {
        const coursesFromLectures = lectures.map(l => l.course).filter(Boolean) as string[];
        return [...new Set([...coursesFromLectures, ...courses])].sort();
    }, [lectures, courses]);
    
    const lecturesByCourse = useMemo(() => {
        const grouped: { [key: string]: VoiceMemory[] } = {};
        lectures.forEach(l => {
            if (l.type === 'voice' && l.category === 'college' && l.course) {
                if (!grouped[l.course]) {
                    grouped[l.course] = [];
                }
                grouped[l.course].push(l as VoiceMemory);
            }
        });
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
                    if (summary) {
                        onUpdate(lecture.id, { summary });
                    }
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
    
    const handleSaveLecture = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSave({
            ...mem,
            category: 'college',
            course: selectedCourse || 'General'
        });
        setView('lectures');
    };

    const handleSelectCourse = (course: string) => {
        setSelectedCourse(course);
        setView('lectures');
    };

    const handleSelectLecture = (lecture: VoiceMemory) => {
        setSelectedLecture(lecture);
        setView('lectureDetail');
    };
    
    if (view === 'record') {
        return <Recorder 
            onSave={handleSaveLecture} 
            onCancel={() => setView('lectures')} 
            titlePlaceholder={`${selectedCourse} - ${new Date().toLocaleDateString()}`}
            saveButtonText="Save Lecture"
            enableDiarization={true}
        />;
    }
    
    if (view === 'lectureDetail' && selectedLecture) {
        return <LectureDetailView lecture={selectedLecture} onBack={() => setView('lectures')} onUpdate={onUpdate} />;
    }
    
    if (view === 'qa') {
        return (
            <div className="flex flex-col h-full">
                <header className="flex items-center mb-4">
                    <button onClick={() => setView('courses')} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h2 className="text-xl font-bold">Ask About All Lectures</h2>
                </header>
                <div className="flex-grow border border-gray-700 rounded-lg">
                   <QASession memories={lectures} />
                </div>
            </div>
        );
    }

    if (view === 'lectures' && selectedCourse) {
        const courseLectures = lecturesByCourse[selectedCourse] || [];
        return (
            <div className="space-y-4">
                 <header className="flex items-center mb-4">
                    <button onClick={() => setView('courses')} className="p-2 mr-2 rounded-full hover:bg-gray-700">
                        <ArrowLeftIcon className="w-6 h-6" />
                    </button>
                    <h2 className="text-2xl font-bold">{selectedCourse}</h2>
                </header>
                <button onClick={() => setView('record')} className="w-full flex items-center justify-center gap-2 p-4 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
                    <MicIcon className="w-6 h-6 text-white"/>
                    <span className="text-lg font-semibold text-white">Record New Lecture</span>
                </button>
                 {courseLectures.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No lectures recorded for this course yet.</p>
                ) : (
                    courseLectures.map(lec => (
                        <div key={lec.id} onClick={() => handleSelectLecture(lec)} className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 cursor-pointer hover:border-blue-500 transition-colors">
                            <h3 className="text-lg font-semibold text-white">{lec.title}</h3>
                            <p className="text-sm text-gray-400 mb-2">{new Date(lec.date).toLocaleString()}</p>
                            <div className="border-t border-gray-700 pt-2 mt-2">
                                <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Summary</h4>
                                <p className="text-sm text-gray-300 italic">
                                    {lec.summary ? lec.summary : "Generating summary..."}
                                </p>
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
                    <input 
                        type="text"
                        value={newCourseName}
                        onChange={(e) => setNewCourseName(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddCourse()}
                        placeholder="Create a new course folder"
                        className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                    />
                    <button onClick={handleAddCourse} className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={!newCourseName.trim()}>
                        <PlusCircleIcon className="w-6 h-6" />
                    </button>
                </div>
                
                {allCourses.length === 0 ? (
                    <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                        <FolderIcon className="w-12 h-12 mx-auto text-gray-500"/>
                        <p className="mt-2 text-gray-400">Create your first course folder above.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {allCourses.map(course => (
                             <div key={course} onClick={() => handleSelectCourse(course)} className="bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 cursor-pointer hover:border-blue-500 transition-colors flex flex-col items-center justify-center aspect-square">
                                <FolderIcon className="w-12 h-12 text-blue-400 mb-2"/>
                                <span className="text-lg font-semibold text-center text-white">{course}</span>
                                <span className="text-sm text-gray-400">{(lecturesByCourse[course]?.length || 0)} lectures</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
             <div className="border-t border-gray-700 pt-6">
                 <button onClick={() => setView('qa')} className="w-full flex flex-col items-center justify-center gap-2 p-4 bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors">
                    <BrainCircuitIcon className="w-10 h-10 text-white"/>
                    <span className="text-xl font-semibold text-white">Ask AI about College</span>
                </button>
            </div>
        </div>
    );
};

export default CollegeView;
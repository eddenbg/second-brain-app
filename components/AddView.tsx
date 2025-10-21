import React, { useState, useMemo } from 'react';
import Recorder from './Recorder';
import type { AnyMemory, VoiceMemory } from '../types';
import { TrashIcon, EditIcon, CheckIcon, XIcon, ChevronDownIcon, MicIcon, MapPinIcon, PlusIcon } from './Icons';


interface CollegeViewProps {
    lectures: AnyMemory[];
    onSave: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDelete: (id: string) => void;
    onUpdateTitle: (id: string, newTitle: string) => void;
}

const LectureItem: React.FC<{ memory: AnyMemory; onDelete: (id: string) => void; onUpdateTitle: (id: string, newTitle: string) => void; }> = ({ memory, onDelete, onUpdateTitle }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(memory.title);

    const handleUpdate = () => {
        if (title.trim()) {
            onUpdateTitle(memory.id, title.trim());
            setIsEditing(false);
        }
    };
    
    const handleCancel = () => {
        setTitle(memory.title);
        setIsEditing(false);
    };

    return (
        <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700">
            <div className="p-4 flex justify-between items-center cursor-pointer gap-4" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-shrink-0"><MicIcon className="w-6 h-6 text-blue-400"/></div>
                <div className="flex-grow">
                    {isEditing ? (
                        <input
                           type="text"
                           value={title}
                           onChange={(e) => setTitle(e.target.value)}
                           onClick={(e) => e.stopPropagation()}
                           className="w-full bg-gray-700 text-white text-lg p-2 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                           autoFocus
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') handleUpdate();
                               if (e.key === 'Escape') handleCancel();
                           }}
                        />
                    ) : (
                        <h3 className="text-xl font-semibold text-white">{memory.title}</h3>
                    )}
                    <p className="text-sm text-gray-400">{new Date(memory.date).toLocaleString()}</p>
                </div>
                <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
            {isExpanded && (
                <div className="p-4 border-t border-gray-700 space-y-4">
                    <div className="flex items-center justify-end space-x-2">
                         {isEditing ? (
                             <>
                                <button onClick={handleUpdate} aria-label="Save title" className="p-2 text-green-400 hover:text-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 rounded-full"><CheckIcon className="w-6 h-6"/></button>
                                <button onClick={handleCancel} aria-label="Cancel edit" className="p-2 text-gray-400 hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded-full"><XIcon className="w-6 h-6"/></button>
                            </>
                        ) : (
                            <button onClick={() => setIsEditing(true)} aria-label="Edit title" className="p-2 text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"><EditIcon className="w-6 h-6"/></button>
                        )}
                        <button onClick={() => onDelete(memory.id)} aria-label="Delete memory" className="p-2 text-red-500 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 rounded-full"><TrashIcon className="w-6 h-6"/></button>
                    </div>

                    {memory.location && (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <MapPinIcon className="w-5 h-5" />
                            <a href={`https://www.google.com/maps?q=${memory.location.latitude},${memory.location.longitude}`} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 underline">
                                View Location
                            </a>
                        </div>
                    )}
                    <div className="bg-gray-900 p-4 rounded-md max-h-60 overflow-y-auto border border-gray-600">
                        <h4 className="text-lg font-semibold text-gray-300 mb-2">Transcript:</h4>
                        <p className="text-gray-200 whitespace-pre-wrap">{(memory as VoiceMemory).transcript}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

const CourseSelectionModal: React.FC<{
    courses: string[];
    onSelect: (course: string) => void;
    onClose: () => void;
}> = ({ courses, onSelect, onClose }) => {
    const [newCourse, setNewCourse] = useState('');

    const handleSelect = (course: string) => {
        if (course.trim()) {
            onSelect(course.trim());
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600">
                 <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Select a Course</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><XIcon className="w-6 h-6"/></button>
                </header>
                <div className="p-6 space-y-4">
                    {courses.map(course => (
                        <button key={course} onClick={() => handleSelect(course)} className="w-full text-left p-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-lg">
                            {course}
                        </button>
                    ))}
                    <div className="flex items-center gap-2 pt-4">
                        <input 
                            type="text"
                            value={newCourse}
                            onChange={(e) => setNewCourse(e.target.value)}
                            placeholder="Or create a new course..."
                            className="w-full bg-gray-700 text-white text-lg p-3 rounded-md border border-gray-600 focus:ring-2 focus:ring-blue-500"
                        />
                         <button onClick={() => handleSelect(newCourse)} className="p-3 bg-blue-600 rounded-lg hover:bg-blue-700">
                            <PlusIcon className="w-6 h-6 text-white" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const CollegeView: React.FC<CollegeViewProps> = ({ lectures, onSave, onDelete, onUpdateTitle }) => {
    const [view, setView] = useState<'list'|'record'|'select_course'>('list');
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
    const [activeCourseFilter, setActiveCourseFilter] = useState<string>('All');
    
    const courses = useMemo(() => ['All', ...new Set(lectures.map(l => l.course).filter(Boolean) as string[])], [lectures]);
    
    const filteredLectures = useMemo(() => {
        if (activeCourseFilter === 'All') return lectures;
        return lectures.filter(l => l.course === activeCourseFilter);
    }, [lectures, activeCourseFilter]);

    const handleSaveLecture = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSave({
            ...mem,
            category: 'college',
            course: selectedCourse || 'General'
        });
        setView('list');
        setSelectedCourse(null);
    }

    const startRecordingForCourse = (course: string) => {
        setSelectedCourse(course);
        setView('record');
    }
    
    if (view === 'select_course') {
        return <CourseSelectionModal courses={courses.filter(c => c !== 'All')} onSelect={startRecordingForCourse} onClose={() => setView('list')} />
    }

    if (view === 'record') {
        return <Recorder 
            onSave={handleSaveLecture} 
            onCancel={() => setView('list')} 
            titlePlaceholder={`${selectedCourse} - ${new Date().toLocaleDateString()}`}
            saveButtonText="Save Lecture"
        />;
    }

    return (
        <div className="space-y-8">
            <button onClick={() => setView('select_course')} className="w-full flex flex-col items-center justify-center gap-2 p-6 bg-blue-600 rounded-lg hover:bg-blue-700 border-2 border-dashed border-blue-400 hover:border-blue-300 transition-colors">
                <MicIcon className="w-10 h-10 text-white"/>
                <span className="text-xl font-semibold text-white">Record New Lecture</span>
            </button>
            <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white border-b border-gray-700 pb-2">My Lectures</h2>
                
                <div className="flex space-x-2 sm:space-x-4 pb-2 overflow-x-auto pt-2">
                    {courses.map(course => (
                         <button key={course} onClick={() => setActiveCourseFilter(course)} className={`px-4 py-2 text-lg font-semibold rounded-md transition-colors flex-shrink-0 ${activeCourseFilter === course ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                            {course}
                        </button>
                    ))}
                </div>

                {filteredLectures.length === 0 ? (
                    <div className="text-center py-10 px-6 bg-gray-800 rounded-lg">
                        <p className="mt-2 text-gray-400">
                            {activeCourseFilter === 'All' 
                                ? "Tap the button above to record your first lecture."
                                : `No lectures found for ${activeCourseFilter}.`
                            }
                        </p>
                    </div>
                ) : (
                    filteredLectures.map(lec => (
                        <LectureItem key={lec.id} memory={lec} onDelete={onDelete} onUpdateTitle={onUpdateTitle} />
                    ))
                )}
            </div>
        </div>
    );
};

export default CollegeView;
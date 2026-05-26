import React, { useState, useEffect } from 'react';
import type { MoodleCourse, MoodleContent } from '../types';
import { fetchMoodleCourses, fetchCourseContents } from '../services/moodleService';
import { XIcon, Loader2Icon, ArrowLeftIcon, FileTextIcon } from './Icons';

interface MoodlePickerModalProps {
    token: string;
    onClose: () => void;
    onImport: (content: MoodleContent, courseId: number, courseName: string) => void;
    importedUrls: Set<string>;
}

const MoodlePickerModal: React.FC<MoodlePickerModalProps> = ({ token, onClose, onImport, importedUrls }) => {
    const [view, setView] = useState<'courses' | 'files'>('courses');
    const [courses, setCourses] = useState<MoodleCourse[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<MoodleCourse | null>(null);
    const [contents, setContents] = useState<MoodleContent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        fetchMoodleCourses(token)
            .then(setCourses)
            .catch(() => setError('Could not load courses. Check your Moodle connection in Settings.'))
            .finally(() => setIsLoading(false));
    }, [token]);

    const openCourse = async (course: MoodleCourse) => {
        setSelectedCourse(course);
        setView('files');
        setIsLoading(true);
        setError(null);
        try {
            const items = await fetchCourseContents(token, course.id);
            setContents(items);
        } catch {
            setError('Could not load course files. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const goBack = () => {
        setView('courses');
        setSelectedCourse(null);
        setContents([]);
        setError(null);
    };

    const mimeColor = (mime?: string): string => {
        if (!mime) return 'text-gray-400';
        if (mime.includes('pdf')) return 'text-red-400';
        if (mime.includes('word') || mime.includes('document')) return 'text-blue-400';
        if (mime.includes('presentation') || mime.includes('powerpoint')) return 'text-orange-400';
        if (mime.includes('spreadsheet') || mime.includes('excel')) return 'text-green-400';
        return 'text-gray-400';
    };

    const mimeLabel = (mime?: string): string => {
        if (!mime) return 'File';
        if (mime.includes('pdf')) return 'PDF';
        if (mime.includes('word') || mime.includes('document')) return 'Doc';
        if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PPT';
        if (mime.includes('spreadsheet') || mime.includes('excel')) return 'XLS';
        return 'File';
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                <header className="flex items-center gap-3 px-4 py-3 border-b-2 border-gray-700 shrink-0">
                    {view === 'files' ? (
                        <button onClick={goBack} className="p-2 bg-gray-700 rounded-xl shrink-0">
                            <ArrowLeftIcon className="w-5 h-5 text-white" />
                        </button>
                    ) : (
                        <div className="w-9 h-9 bg-[#f98012] rounded-xl flex items-center justify-center shrink-0">
                            <span className="text-white font-black text-base leading-none">M</span>
                        </div>
                    )}
                    <div className="flex-grow min-w-0">
                        <div className="flex items-center gap-1">
                            <button
                                onClick={view === 'files' ? goBack : undefined}
                                dir="auto"
                                className={`text-xs font-black shrink-0 ${view === 'courses' ? 'text-white' : 'text-gray-400'}`}
                            >
                                My Courses
                            </button>
                            {view === 'files' && selectedCourse && (
                                <>
                                    <span className="text-gray-500 text-xs shrink-0">›</span>
                                    <span dir="auto" className="text-xs font-black text-white truncate max-w-[150px]">
                                        {selectedCourse.shortname || selectedCourse.fullname}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-700 rounded-xl shrink-0">
                        <XIcon className="w-5 h-5 text-white" />
                    </button>
                </header>

                <div className="flex-grow overflow-y-auto px-4 py-3 space-y-2 min-h-0">
                    {isLoading && (
                        <div className="flex justify-center py-12">
                            <Loader2Icon className="w-8 h-8 animate-spin text-orange-400" />
                        </div>
                    )}
                    {error && <p className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>}

                    {!isLoading && !error && view === 'courses' && (
                        <>
                            {courses.length === 0 && (
                                <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                                    No enrolled courses found
                                </p>
                            )}
                            {courses.map(course => (
                                <button
                                    key={course.id}
                                    onClick={() => openCourse(course)}
                                    className="w-full flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700 active:scale-98 transition-all text-left"
                                >
                                    <div className="w-10 h-10 bg-[#f98012]/20 rounded-xl flex items-center justify-center shrink-0">
                                        <span className="text-[#f98012] font-black text-base leading-none">M</span>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <p dir="auto" className="font-black text-white text-sm truncate">{course.fullname}</p>
                                        <p className="text-[10px] text-gray-500 font-bold mt-0.5 uppercase tracking-wide">
                                            {course.shortname}
                                        </p>
                                    </div>
                                    <span className="text-gray-500 text-lg shrink-0">›</span>
                                </button>
                            ))}
                        </>
                    )}

                    {!isLoading && !error && view === 'files' && (
                        <>
                            {contents.length === 0 && (
                                <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                                    No files in this course
                                </p>
                            )}
                            {contents.map(item => {
                                const url = item.fileurl || '';
                                const isImported = importedUrls.has(url);
                                return (
                                    <div key={item.id} className="flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700">
                                        <div className="shrink-0">
                                            <div className={`text-[10px] font-black uppercase tracking-wider ${mimeColor(item.mimetype)}`}>
                                                {mimeLabel(item.mimetype)}
                                            </div>
                                            <FileTextIcon className={`w-8 h-8 ${mimeColor(item.mimetype)}`} />
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <p dir="auto" className="font-black text-white text-sm truncate">{item.name}</p>
                                            <p className="text-[10px] text-gray-500 font-bold mt-0.5 uppercase tracking-wide">
                                                {item.type}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => !isImported && url && onImport(item, selectedCourse!.id, selectedCourse!.fullname)}
                                            disabled={isImported || !url}
                                            className={`px-4 py-2 rounded-xl font-black text-xs uppercase shrink-0 transition-all ${
                                                isImported
                                                    ? 'bg-green-800 text-green-400'
                                                    : !url
                                                    ? 'bg-gray-700 text-gray-500'
                                                    : 'bg-orange-600 text-white active:scale-95'
                                            }`}
                                        >
                                            {isImported ? 'Added ✓' : !url ? 'No URL' : 'Import'}
                                        </button>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MoodlePickerModal;

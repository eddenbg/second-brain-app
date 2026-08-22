import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Check, AlertTriangle, GraduationCap } from 'lucide-react';
import type { MoodleCourse } from '../types';
import { fetchMoodleCourses, deriveMoodleTermLabel } from '../services/moodleService';

interface MoodleSemesterImportModalProps {
    token: string;
    /** Local course names that already exist, so a re-run never duplicates one. */
    existingCourseNames: string[];
    onClose: () => void;
    /** Maps directly to useRecordings' addCourse(courseName, term). */
    onImportCourse: (courseName: string, term: string) => Promise<{ ok: boolean; reason?: string } | void> | void;
}

type RowStatus = 'pending' | 'importing' | 'done' | 'skipped' | 'error';

interface Group {
    key: string;          // stable identity for the group, independent of the editable label
    label: string;        // editable term label used on import
    courses: MoodleCourse[];
}

const normalize = (s: string) => s.trim().toLowerCase();

const MoodleSemesterImportModal: React.FC<MoodleSemesterImportModalProps> = ({
    token, existingCourseNames, onClose, onImportCourse,
}) => {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [moodleCourses, setMoodleCourses] = useState<MoodleCourse[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [status, setStatus] = useState<Record<number, { state: RowStatus; reason?: string }>>({});
    const [isImporting, setIsImporting] = useState(false);
    const [done, setDone] = useState(false);

    const existingNormalized = useMemo(() => new Set(existingCourseNames.map(normalize)), [existingCourseNames]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError(null);
        fetchMoodleCourses(token)
            .then(list => {
                if (cancelled) return;
                setMoodleCourses(list);

                const byTerm = new Map<string, MoodleCourse[]>();
                list.forEach(c => {
                    const term = deriveMoodleTermLabel(c);
                    if (!byTerm.has(term)) byTerm.set(term, []);
                    byTerm.get(term)!.push(c);
                });
                const orderedTerms = Array.from(byTerm.keys()).sort((a, b) => {
                    if (a === 'General') return 1;
                    if (b === 'General') return -1;
                    return b.localeCompare(a); // newest term first — most relevant for "this semester"
                });
                setGroups(orderedTerms.map(term => ({ key: term, label: term, courses: byTerm.get(term)! })));

                // Pre-select everything not already present locally, by name.
                const preselected = new Set<number>();
                list.forEach(c => {
                    if (!existingNormalized.has(normalize(c.fullname))) preselected.add(c.id);
                });
                setSelected(preselected);
            })
            .catch(e => { if (!cancelled) setError(e?.message || 'Moodle did not respond.'); })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const toggle = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const setGroupLabel = (key: string, label: string) => {
        setGroups(prev => prev.map(g => g.key === key ? { ...g, label } : g));
    };

    const selectedCount = selected.size;

    const runImport = async () => {
        setIsImporting(true);
        // Grows as we go so a name that appears more than once (unlikely, but
        // Moodle course renames can collide) is only ever added once per run.
        const addedThisRun = new Set<string>(existingNormalized);
        for (const group of groups) {
            for (const course of group.courses) {
                if (!selected.has(course.id)) continue;
                const key = normalize(course.fullname);
                if (addedThisRun.has(key)) {
                    setStatus(prev => ({ ...prev, [course.id]: { state: 'skipped', reason: 'Already added' } }));
                    continue;
                }
                setStatus(prev => ({ ...prev, [course.id]: { state: 'importing' } }));
                try {
                    const result = await onImportCourse(course.fullname, group.label.trim() || 'General');
                    if (result && (result as any).ok === false) {
                        setStatus(prev => ({ ...prev, [course.id]: { state: 'error', reason: (result as any).reason || 'Could not create the course.' } }));
                    } else {
                        addedThisRun.add(key);
                        setStatus(prev => ({ ...prev, [course.id]: { state: 'done' } }));
                    }
                } catch (e: any) {
                    setStatus(prev => ({ ...prev, [course.id]: { state: 'error', reason: e?.message || 'Could not create the course.' } }));
                }
            }
        }
        setIsImporting(false);
        setDone(true);
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex flex-col animate-fade-in" onClick={isImporting ? undefined : onClose}>
            <div
                className="bg-gray-800 rounded-t-[2.5rem] w-full max-h-[92vh] flex flex-col border-t-4 border-gray-700 mt-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="w-12 h-1.5 bg-gray-600 rounded-full mx-auto mt-4 shrink-0" />

                <header className="flex items-center gap-3 px-4 py-3 border-b-2 border-gray-700 shrink-0">
                    <div className="w-9 h-9 bg-[#f98012] rounded-xl flex items-center justify-center shrink-0">
                        <GraduationCap className="w-5 h-5 text-white" strokeWidth={3} />
                    </div>
                    <div className="flex-grow min-w-0">
                        <h2 className="text-sm font-black text-white">Import Semester Courses</h2>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wide">
                            {done ? 'Done — review results below' : 'Review, then confirm what gets added'}
                        </p>
                    </div>
                    <button
                        onClick={isImporting ? undefined : onClose}
                        disabled={isImporting}
                        aria-label="Close"
                        className="p-2 bg-gray-700 rounded-xl shrink-0 disabled:opacity-40"
                    >
                        <X className="w-5 h-5 text-white" strokeWidth={3} />
                    </button>
                </header>

                <div className="flex-grow overflow-y-auto px-4 py-4 space-y-6 min-h-0">
                    {isLoading && (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="text-red-400 font-bold text-center py-6 text-sm">{error}</p>
                    )}

                    {!isLoading && !error && moodleCourses.length === 0 && (
                        <p className="text-gray-500 font-black text-center py-12 text-xs uppercase tracking-widest">
                            No Moodle courses found for this account.
                        </p>
                    )}

                    {!isLoading && !error && groups.map(group => (
                        <div key={group.key} className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wide shrink-0" htmlFor={`term-${group.key}`}>
                                    Import as term
                                </label>
                                <input
                                    id={`term-${group.key}`}
                                    type="text"
                                    value={group.label}
                                    disabled={isImporting || done}
                                    onChange={e => setGroupLabel(group.key, e.target.value)}
                                    className="flex-grow bg-gray-900 border-2 border-gray-700 rounded-xl px-3 py-2 text-sm font-black text-white uppercase tracking-widest disabled:opacity-60"
                                    aria-label={`Term label for ${group.key} group`}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                {group.courses.map(course => {
                                    const already = existingNormalized.has(normalize(course.fullname));
                                    const rowStatus = status[course.id]?.state;
                                    const isChecked = selected.has(course.id);
                                    return (
                                        <div
                                            key={course.id}
                                            className="w-full flex items-center gap-4 p-4 bg-gray-900 rounded-2xl border-2 border-gray-700"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                disabled={already || isImporting || done}
                                                onChange={() => toggle(course.id)}
                                                className="w-6 h-6 rounded accent-orange-500 shrink-0"
                                                aria-label={`Select ${course.fullname} for import`}
                                            />
                                            <div className="flex-grow min-w-0">
                                                <p dir="auto" className="font-black text-white text-sm truncate">{course.fullname}</p>
                                                <p className="text-[10px] text-gray-500 font-bold mt-0.5 uppercase tracking-wide">
                                                    {course.shortname}
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-[10px] font-black uppercase tracking-wide">
                                                {already && <span className="text-gray-500">Already added</span>}
                                                {!already && rowStatus === 'importing' && <Loader2 className="w-5 h-5 animate-spin text-orange-400" />}
                                                {!already && rowStatus === 'done' && <span className="text-green-400 flex items-center gap-1"><Check size={14} strokeWidth={3} /> Added</span>}
                                                {!already && rowStatus === 'skipped' && <span className="text-gray-500">Skipped</span>}
                                                {!already && rowStatus === 'error' && (
                                                    <span className="text-red-400 flex items-center gap-1" title={status[course.id]?.reason}>
                                                        <AlertTriangle size={14} strokeWidth={3} /> Failed
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {!isLoading && !error && moodleCourses.length > 0 && (
                    <div className="px-4 py-4 border-t-2 border-gray-700 shrink-0">
                        {done ? (
                            <button
                                onClick={onClose}
                                className="w-full py-4 rounded-2xl font-black text-sm uppercase bg-white text-[#001F3F]"
                            >
                                Close
                            </button>
                        ) : (
                            <button
                                onClick={runImport}
                                disabled={isImporting || selectedCount === 0}
                                className="w-full py-4 rounded-2xl font-black text-sm uppercase bg-orange-600 text-white disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {isImporting
                                    ? <><Loader2 className="w-5 h-5 animate-spin" /> Importing…</>
                                    : `Import ${selectedCount} Course${selectedCount === 1 ? '' : 's'}`
                                }
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MoodleSemesterImportModal;

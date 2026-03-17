
import React, { useState, useMemo } from 'react';
import type { Task, AnyMemory, TaskStatus } from '../types';
import { XIcon, CheckIcon, PlusIcon, LinkIcon } from './Icons';

interface KanbanBoardProps {
    tasks: Task[];
    category: 'personal' | 'college';
    // If filtering by course (for College)
    courseFilter?: string | null;
    onUpdateTask: (id: string, updates: Partial<Task>) => void;
    onDeleteTask: (id: string) => void;
    onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    memories: AnyMemory[];
    onOpenMemory: (mem: AnyMemory) => void;
}

const AddTaskModal: React.FC<{
    category: 'personal' | 'college';
    courseFilter?: string | null;
    existingProjects: string[];
    onClose: () => void;
    onSave: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    availableMemories: AnyMemory[];
}> = ({ category, courseFilter, existingProjects, onClose, onSave, availableMemories }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<TaskStatus>(category === 'personal' ? 'idea' : 'todo');
    const [project, setProject] = useState('');
    const [newProject, setNewProject] = useState('');
    const [selectedMemories, setSelectedMemories] = useState<Set<string>>(new Set());

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        
        const finalProject = newProject.trim() || project;

        onSave({
            title,
            description,
            status,
            category,
            course: category === 'college' ? (courseFilter || 'General') : undefined,
            project: finalProject || undefined,
            linkedMemoryIds: Array.from(selectedMemories),
            subtasks: []
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
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[500] p-4 animate-fade-in">
            <div className="bg-[#001f3f] rounded-[3rem] shadow-2xl w-full max-w-md border-4 border-white/10 max-h-[90vh] flex flex-col overflow-hidden">
                <header className="flex justify-between items-center p-8 border-b-4 border-white/10 bg-black/20">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Add {category === 'personal' ? 'Task / Idea' : 'Task'}</h2>
                    <button onClick={onClose} aria-label="Close modal" className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"><XIcon className="w-6 h-6 text-white" /></button>
                </header>
                <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
                    <div>
                        <label className="block text-yellow-500 text-xs font-black uppercase tracking-widest mb-2">Title</label>
                        <input className="w-full bg-white/5 text-white p-4 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-bold" value={title} onChange={e => setTitle(e.target.value)} required autoFocus placeholder="What needs to be done?"/>
                    </div>
                    <div>
                        <label className="block text-yellow-500 text-xs font-black uppercase tracking-widest mb-2">Description</label>
                        <textarea className="w-full bg-white/5 text-white p-4 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-bold" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add more details..." />
                    </div>
                    
                    <div>
                        <label className="block text-yellow-500 text-xs font-black uppercase tracking-widest mb-2">Status</label>
                        <select 
                            value={status} 
                            onChange={(e) => setStatus(e.target.value as TaskStatus)} 
                            className="w-full bg-white/5 text-white p-4 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-bold appearance-none"
                        >
                            {category === 'personal' && <option value="idea" className="bg-[#001f3f]">Idea</option>}
                            <option value="todo" className="bg-[#001f3f]">To Do</option>
                            <option value="in-progress" className="bg-[#001f3f]">In Progress</option>
                            <option value="done" className="bg-[#001f3f]">Done</option>
                        </select>
                    </div>

                    <div>
                         <label className="block text-yellow-500 text-xs font-black uppercase tracking-widest mb-2">Project</label>
                         {existingProjects.length > 0 && (
                             <select 
                                value={project} 
                                onChange={(e) => setProject(e.target.value)} 
                                className="w-full bg-white/5 text-white p-4 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-bold appearance-none mb-3"
                             >
                                 <option value="" className="bg-[#001f3f]">-- Select Existing Project --</option>
                                 {existingProjects.map(p => <option key={p} value={p} className="bg-[#001f3f]">{p}</option>)}
                             </select>
                         )}
                         <input 
                            className="w-full bg-white/5 text-white p-4 rounded-2xl border-2 border-white/10 focus:border-yellow-500 outline-none font-bold" 
                            placeholder="Or create new project..."
                            value={newProject}
                            onChange={(e) => setNewProject(e.target.value)}
                         />
                    </div>
                    
                    {availableMemories.length > 0 && (
                        <div>
                             <label className="block text-yellow-500 text-xs font-black uppercase tracking-widest mb-2">Link Notes/Docs</label>
                             <div className="bg-black/20 rounded-2xl p-3 max-h-40 overflow-y-auto space-y-2 border-2 border-white/5">
                                 {availableMemories.map(mem => (
                                     <div key={mem.id} onClick={() => toggleMemory(mem.id)} className={`p-3 rounded-xl cursor-pointer border-2 flex items-center justify-between transition-all ${selectedMemories.has(mem.id) ? 'bg-yellow-500/20 border-yellow-500' : 'border-white/10 hover:bg-white/5'}`}>
                                         <span className="text-sm font-bold text-white truncate">{mem.title}</span>
                                         {selectedMemories.has(mem.id) && <CheckIcon className="w-4 h-4 text-yellow-500"/>}
                                     </div>
                                 ))}
                             </div>
                        </div>
                    )}

                    <div className="pt-6 flex gap-4">
                        <button type="button" onClick={onClose} className="flex-1 py-4 bg-white/10 rounded-2xl text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors">Cancel</button>
                        <button type="submit" className="flex-1 py-4 bg-yellow-500 rounded-2xl text-[#001f3f] font-black uppercase tracking-widest hover:bg-yellow-600 transition-colors shadow-xl">Add</button>
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

    const handleSubtaskToggle = (subtaskId: string) => {
        const newSubtasks = task.subtasks?.map(st => 
            st.id === subtaskId ? { ...st, done: !st.done } : st
        );
        onUpdate(task.id, { subtasks: newSubtasks });
    };

    const addSubtask = () => {
        const title = prompt("New subtask title:");
        if (title) {
            const newSubtask = { id: Date.now().toString(), title, done: false };
            onUpdate(task.id, { subtasks: [...(task.subtasks || []), newSubtask] });
        }
    };

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div 
            draggable
            onDragStart={handleDragStart}
            aria-label={`Task: ${task.title}`}
            className="bg-white/5 p-4 rounded-2xl shadow-lg border-2 border-white/10 mb-3 hover:border-yellow-500 transition-all group cursor-grab active:cursor-grabbing"
        >
            <div className="flex justify-between items-start mb-2">
                <h4 className="font-black text-white text-sm uppercase tracking-tight">{task.title}</h4>
                <div className="flex gap-1">
                    <button onClick={() => onDelete(task.id)} aria-label="Delete task" className="text-gray-500 hover:text-red-400 p-1"><XIcon className="w-4 h-4"/></button>
                </div>
            </div>
            {task.description && <p className="text-xs text-gray-400 mb-3 font-medium leading-relaxed">{task.description}</p>}
            
            <div className="flex flex-wrap gap-1.5 mb-3">
                {task.project && (
                    <span className="inline-block bg-yellow-500/10 text-yellow-500 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-yellow-500/20">
                        {task.project}
                    </span>
                )}
                {task.course && task.course !== 'General' && (
                    <span className="inline-block bg-white/10 text-gray-300 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/10">
                        {task.course}
                    </span>
                )}
            </div>

            {/* Subtasks */}
            <div className="mb-3 space-y-1.5">
                {task.subtasks && task.subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2">
                        <button 
                            onClick={() => handleSubtaskToggle(st.id)}
                            aria-label={st.done ? `Mark subtask ${st.title} as incomplete` : `Mark subtask ${st.title} as complete`}
                            className={`w-5 h-5 border-2 rounded-lg flex items-center justify-center transition-colors ${st.done ? 'bg-yellow-500 border-yellow-400' : 'border-white/20 hover:border-white/40'}`}
                        >
                            {st.done && <CheckIcon className="w-3.5 h-3.5 text-[#001f3f]"/>}
                        </button>
                        <span className={`text-xs font-bold ${st.done ? 'line-through text-gray-500' : 'text-gray-200'}`}>{st.title}</span>
                    </div>
                ))}
                <button onClick={addSubtask} aria-label="Add subtask" className="text-[10px] text-yellow-500/60 hover:text-yellow-500 font-black uppercase tracking-widest flex items-center gap-1.5 mt-2 transition-colors">
                    <PlusIcon className="w-3.5 h-3.5"/> Subtask
                </button>
            </div>

            {linkedDocs.length > 0 && (
                <div className="mb-1 space-y-1.5 border-t-2 border-white/5 pt-3">
                    {linkedDocs.map(doc => (
                        <button key={doc.id} onClick={() => onOpenMemory(doc)} aria-label={`Open linked note ${doc.title}`} className="flex items-center gap-2 text-[10px] text-yellow-500/80 hover:text-yellow-500 font-black uppercase tracking-widest w-full text-left truncate transition-colors">
                            <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" /> {doc.title}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, category, courseFilter, onUpdateTask, onDeleteTask, onAddTask, memories, onOpenMemory }) => {
    const [projectFilter, setProjectFilter] = useState('All');
    const [showAddModal, setShowAddModal] = useState(false);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

    const availableProjects = useMemo(() => {
        const projects = new Set(tasks.map(t => t.project).filter(Boolean) as string[]);
        return Array.from(projects).sort();
    }, [tasks]);

    const filteredTasks = useMemo(() => {
        let t = tasks.filter(task => task.category === category);
        
        if (courseFilter && courseFilter !== 'All') {
            t = t.filter(task => task.course === courseFilter);
        }
        
        if (projectFilter !== 'All') {
            t = t.filter(task => task.project === projectFilter);
        }
        return t;
    }, [tasks, category, courseFilter, projectFilter]);

    const handleDragOver = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        if (dragOverColumn !== colId) {
            setDragOverColumn(colId);
        }
    };

    const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
        e.preventDefault();
        setDragOverColumn(null);
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
            onUpdateTask(taskId, { status });
        }
    };

    const handleDragLeave = () => {
        setDragOverColumn(null);
    }

    // Define columns based on category
    const columns: { id: TaskStatus; label: string; color: string }[] = [];
    if (category === 'personal') {
        columns.push({ id: 'idea', label: 'Ideas', color: 'border-purple-500' });
    }
    columns.push(
        { id: 'todo', label: 'To Do', color: 'border-red-500' },
        { id: 'in-progress', label: 'In Progress', color: 'border-yellow-500' },
        { id: 'done', label: 'Done', color: 'border-green-500' }
    );

    return (
        <div className="h-full flex flex-col bg-[#001f3f]">
            {showAddModal && (
                <AddTaskModal 
                    category={category}
                    courseFilter={courseFilter}
                    existingProjects={availableProjects}
                    onClose={() => setShowAddModal(false)}
                    onSave={onAddTask}
                    availableMemories={memories}
                />
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div className="flex items-center gap-3 overflow-x-auto w-full sm:w-auto pb-1 scrollbar-hide">
                    <span className="text-gray-400 text-xs font-black uppercase tracking-widest whitespace-nowrap">Project:</span>
                    <select 
                        value={projectFilter} 
                        onChange={(e) => setProjectFilter(e.target.value)}
                        aria-label="Filter by project"
                        className="bg-white/5 text-white text-xs font-black uppercase tracking-widest p-3 rounded-xl border-2 border-white/10 focus:border-yellow-500 outline-none appearance-none min-w-[140px]"
                    >
                        <option value="All" className="bg-[#001f3f]">All Projects</option>
                        {availableProjects.map(p => <option key={p} value={p} className="bg-[#001f3f]">{p}</option>)}
                    </select>
                </div>
                <button onClick={() => setShowAddModal(true)} aria-label="Add new task or idea" className="flex items-center gap-2 px-6 py-4 bg-yellow-500 text-[#001f3f] text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-yellow-600 w-full sm:w-auto justify-center shadow-xl transition-all active:scale-95">
                    <PlusIcon className="w-5 h-5"/> Add Task / Idea
                </button>
            </div>
            
            <div className="flex-grow overflow-x-auto scrollbar-hide">
                <div className="flex gap-6 min-w-[900px] h-full pb-6">
                    {columns.map(col => (
                        <div 
                            key={col.id} 
                            className={`flex-1 bg-black/20 rounded-[2.5rem] border-4 flex flex-col min-w-[250px] transition-all ${dragOverColumn === col.id ? 'border-yellow-500 bg-black/40 scale-[1.02]' : 'border-white/5'}`}
                            onDragOver={(e) => handleDragOver(e, col.id)}
                            onDrop={(e) => handleDrop(e, col.id)}
                            onDragLeave={handleDragLeave}
                            aria-label={`Column: ${col.label}`}
                        >
                            <div className={`p-5 border-b-4 ${col.color} bg-black/10 rounded-t-[2.5rem]`}>
                                <h4 className="font-black text-white uppercase tracking-tighter text-lg">{col.label}</h4>
                            </div>
                            <div className="p-4 flex-grow overflow-y-auto space-y-1">
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
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default KanbanBoard;

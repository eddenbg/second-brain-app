
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md border border-gray-600 max-h-[90vh] flex flex-col">
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <h2 className="text-xl font-bold text-white">Add {category === 'personal' ? 'Task / Idea' : 'Task'}</h2>
                    <button onClick={onClose}><XIcon className="w-6 h-6 text-gray-400" /></button>
                </header>
                <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-gray-300 text-sm font-bold mb-2">Title</label>
                        <input className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-blue-500" value={title} onChange={e => setTitle(e.target.value)} required autoFocus/>
                    </div>
                    <div>
                        <label className="block text-gray-300 text-sm font-bold mb-2">Description</label>
                        <textarea className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                    
                    <div>
                        <label className="block text-gray-300 text-sm font-bold mb-2">Status</label>
                        <select 
                            value={status} 
                            onChange={(e) => setStatus(e.target.value as TaskStatus)} 
                            className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600"
                        >
                            {category === 'personal' && <option value="idea">Idea</option>}
                            <option value="todo">To Do</option>
                            <option value="in-progress">In Progress</option>
                            <option value="done">Done</option>
                        </select>
                    </div>

                    <div>
                         <label className="block text-gray-300 text-sm font-bold mb-2">Project</label>
                         {existingProjects.length > 0 && (
                             <select 
                                value={project} 
                                onChange={(e) => setProject(e.target.value)} 
                                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 mb-2"
                             >
                                 <option value="">-- Select Existing Project --</option>
                                 {existingProjects.map(p => <option key={p} value={p}>{p}</option>)}
                             </select>
                         )}
                         <input 
                            className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600" 
                            placeholder="Or create new project..."
                            value={newProject}
                            onChange={(e) => setNewProject(e.target.value)}
                         />
                    </div>
                    
                    {availableMemories.length > 0 && (
                        <div>
                             <label className="block text-gray-300 text-sm font-bold mb-2">Link Notes/Docs</label>
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
                        <button type="submit" className="px-4 py-2 bg-blue-600 rounded text-white font-bold">Add</button>
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
        // Add a slight transparency to the drag image if possible, 
        // though browser default is usually fine.
    };

    return (
        <div 
            draggable
            onDragStart={handleDragStart}
            className="bg-gray-700 p-3 rounded-lg shadow-sm border border-gray-600 mb-3 hover:border-blue-400 transition-colors group cursor-grab active:cursor-grabbing"
        >
            <div className="flex justify-between items-start mb-1">
                <h4 className="font-semibold text-white text-sm">{task.title}</h4>
                <div className="flex gap-1">
                    <button onClick={() => onDelete(task.id)} className="text-gray-500 hover:text-red-400"><XIcon className="w-4 h-4"/></button>
                </div>
            </div>
            {task.description && <p className="text-xs text-gray-300 mb-2">{task.description}</p>}
            
            <div className="flex flex-wrap gap-1 mb-2">
                {task.project && (
                    <span className="inline-block bg-purple-900 text-purple-200 text-[10px] px-2 py-0.5 rounded-full">
                        {task.project}
                    </span>
                )}
                {task.course && task.course !== 'General' && (
                    <span className="inline-block bg-blue-900 text-blue-200 text-[10px] px-2 py-0.5 rounded-full">
                        {task.course}
                    </span>
                )}
            </div>

            {/* Subtasks */}
            <div className="mb-2">
                {task.subtasks && task.subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 mb-1">
                        <button 
                            onClick={() => handleSubtaskToggle(st.id)}
                            className={`w-4 h-4 border rounded flex items-center justify-center ${st.done ? 'bg-green-600 border-green-600' : 'border-gray-500'}`}
                        >
                            {st.done && <CheckIcon className="w-3 h-3 text-white"/>}
                        </button>
                        <span className={`text-xs ${st.done ? 'line-through text-gray-500' : 'text-gray-300'}`}>{st.title}</span>
                    </div>
                ))}
                <button onClick={addSubtask} className="text-[10px] text-gray-500 hover:text-blue-300 flex items-center gap-1 mt-1">
                    <PlusIcon className="w-3 h-3"/> Subtask
                </button>
            </div>

            {linkedDocs.length > 0 && (
                <div className="mb-2 space-y-1 border-t border-gray-600 pt-1">
                    {linkedDocs.map(doc => (
                        <button key={doc.id} onClick={() => onOpenMemory(doc)} className="flex items-center gap-1 text-[10px] text-blue-300 hover:underline w-full text-left truncate">
                            <LinkIcon className="w-3 h-3 flex-shrink-0" /> {doc.title}
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
        <div className="h-full flex flex-col">
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

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
                    <span className="text-gray-400 text-sm whitespace-nowrap">Project:</span>
                    <select 
                        value={projectFilter} 
                        onChange={(e) => setProjectFilter(e.target.value)}
                        className="bg-gray-700 text-white text-sm p-2 rounded border border-gray-600"
                    >
                        <option value="All">All Projects</option>
                        {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700 w-full sm:w-auto justify-center">
                    <PlusIcon className="w-4 h-4"/> Add Task / Idea
                </button>
            </div>
            
            <div className="flex-grow overflow-x-auto">
                <div className="flex gap-4 min-w-[800px] h-full pb-4">
                    {columns.map(col => (
                        <div 
                            key={col.id} 
                            className={`flex-1 bg-gray-800 rounded-lg border flex flex-col min-w-[200px] transition-colors ${dragOverColumn === col.id ? 'border-blue-500 bg-gray-750' : 'border-gray-700'}`}
                            onDragOver={(e) => handleDragOver(e, col.id)}
                            onDrop={(e) => handleDrop(e, col.id)}
                            onDragLeave={handleDragLeave}
                        >
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
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default KanbanBoard;

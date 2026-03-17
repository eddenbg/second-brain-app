
import React, { useState, useMemo } from 'react';
import { 
    Mic, FileText, Globe, ArrowLeft, Plus, 
    Trash2, Edit3, Volume2, Download, Loader2, X,
    Brain, Link as LinkIcon, File as FileIcon, Package, Camera
} from 'lucide-react';
import type { AnyMemory, VoiceMemory, DocumentMemory, Task, PhysicalItemMemory } from '../types';
import Recorder from './Recorder';
import QASession from './QASession';
import KanbanBoard from './KanbanBoard';
import AddDocumentModal from './AddDocumentModal';
import AddPhysicalItemModal from './AddPhysicalItemModal';

interface PersonalViewProps {
    memories: AnyMemory[]; 
    tasks: Task[];
    onSaveMemory: (memory: Omit<AnyMemory, 'id'|'date'>) => void;
    onDeleteMemory: (id: string) => void;
    onUpdateMemory: (id: string, updates: Partial<AnyMemory>) => void;
    bulkDeleteMemories: (ids: string[]) => void;
    onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
    onUpdateTask: (id: string, updates: Partial<Task>) => void;
    onDeleteTask: (id: string) => void;
}

const PersonalView: React.FC<PersonalViewProps> = ({ 
    memories, tasks, 
    onSaveMemory, onDeleteMemory, onUpdateMemory, bulkDeleteMemories,
    onAddTask, onUpdateTask, onDeleteTask
}) => {
    const [view, setView] = useState<'hub' | 'detail' | 'recording' | 'scanning' | 'addingItem'>('hub');
    const [activeTab, setActiveTab] = useState<'items' | 'thoughts' | 'web' | 'files'>('items');
    const [selectedItem, setSelectedItem] = useState<AnyMemory | null>(null);

    const filteredMemories = useMemo(() => {
        const personal = memories.filter(m => m.category === 'personal');
        if (activeTab === 'items') return personal.filter(m => m.type === 'item');
        if (activeTab === 'thoughts') return personal.filter(m => m.type === 'voice');
        if (activeTab === 'web') return personal.filter(m => m.type === 'web');
        if (activeTab === 'files') return personal.filter(m => m.type === 'document' || m.type === 'file');
        return [];
    }, [memories, activeTab]);

    const handleBack = () => {
        if (view === 'detail') setView('hub');
        else if (view === 'recording' || view === 'scanning' || view === 'addingItem') setView('hub');
    };

    const handleSaveVoiceNote = (mem: Omit<VoiceMemory, 'id'|'date'|'category'>) => {
        onSaveMemory({ ...mem, category: 'personal' });
        setView('hub');
    };

    if (view === 'recording') {
        return (
            <div className="flex flex-col gap-8">
                <header className="flex justify-between items-center">
                    <h1 className="text-3xl">Quick Capture</h1>
                    <button onClick={handleBack} className="btn-outline w-24">
                        <X size={40} strokeWidth={3} />
                    </button>
                </header>
                <Recorder 
                    onSave={handleSaveVoiceNote}
                    onCancel={handleBack}
                    titlePlaceholder={`Thought - ${new Date().toLocaleDateString()}`}
                    saveButtonText="Save Thought"
                />
            </div>
        );
    }

    if (view === 'scanning') {
        return (
            <AddDocumentModal 
                onClose={handleBack} 
                onSave={(mem) => { onSaveMemory({ ...mem, category: 'personal' }); setView('hub'); }} 
            />
        );
    }

    if (view === 'addingItem') {
        return (
            <AddPhysicalItemModal 
                onClose={handleBack} 
                onSave={(mem) => { onSaveMemory({ ...mem, category: 'personal' }); setView('hub'); }} 
            />
        );
    }

    if (view === 'hub') {
        return (
            <div className="flex flex-col gap-8">
                {/* Hub Tabs */}
                <div className="flex gap-2 bg-[#60A5FA]/10 rounded-2xl p-2 overflow-x-auto no-scrollbar">
                    {(['items', 'thoughts', 'web', 'files'] as const).map(tab => (
                        <button 
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 min-w-[100px] py-4 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeTab === tab ? 'bg-[#60A5FA] text-[#020617]' : 'text-[#60A5FA]'}`}
                        >
                            {tab === 'items' && <Package size={20} />}
                            {tab === 'thoughts' && <Brain size={20} />}
                            {tab === 'web' && <LinkIcon size={20} />}
                            {tab === 'files' && <FileIcon size={20} />}
                            <span>{tab}</span>
                        </button>
                    ))}
                </div>

                {/* Quick Actions based on tab */}
                {activeTab === 'items' && (
                    <button 
                        onClick={() => setView('addingItem')}
                        className="btn-primary w-full h-32 flex flex-col items-center justify-center gap-2"
                    >
                        <Package size={48} strokeWidth={3} />
                        <span className="text-2xl">Track Physical Item</span>
                    </button>
                )}

                {activeTab === 'thoughts' && (
                    <button 
                        onClick={() => setView('recording')}
                        className="btn-primary w-full h-32 flex flex-col items-center justify-center gap-2"
                    >
                        <Mic size={48} strokeWidth={3} />
                        <span className="text-2xl">Record Thought</span>
                    </button>
                )}

                {activeTab === 'files' && (
                    <button 
                        onClick={() => setView('scanning')}
                        className="btn-primary w-full h-32 flex flex-col items-center justify-center gap-2"
                    >
                        <Camera size={48} strokeWidth={3} />
                        <span className="text-2xl">Scan Document / Mail</span>
                    </button>
                )}

                {/* List */}
                <div className="grid grid-cols-1 gap-4">
                    {filteredMemories.map(mem => (
                        <button 
                            key={mem.id}
                            onClick={() => { setSelectedItem(mem); setView('detail'); }}
                            className="card-brutal flex items-center gap-6 text-left hover:bg-[#60A5FA]/10"
                        >
                            {activeTab === 'items' && <Package size={32} strokeWidth={3} />}
                            {activeTab === 'thoughts' && <Brain size={32} strokeWidth={3} />}
                            {activeTab === 'web' && <LinkIcon size={32} strokeWidth={3} />}
                            {activeTab === 'files' && <FileIcon size={32} strokeWidth={3} />}
                            <div className="flex-grow overflow-hidden">
                                <h3 className="text-xl truncate">{mem.title}</h3>
                                <p className="text-[#60A5FA] text-xs uppercase tracking-widest">
                                    {new Date(mem.date).toLocaleDateString()}
                                </p>
                            </div>
                        </button>
                    ))}
                    {filteredMemories.length === 0 && (
                        <div className="py-20 text-center opacity-50">
                            <p className="text-2xl uppercase">No {activeTab} yet</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (view === 'detail' && selectedItem) {
        return (
            <div className="flex flex-col gap-8">
                <header className="flex items-center gap-6">
                    <button onClick={handleBack} className="btn-outline w-24">
                        <ArrowLeft size={40} strokeWidth={3} />
                    </button>
                    <h1 className="text-3xl truncate">{selectedItem.title}</h1>
                </header>

                <div className="card-brutal bg-[#60A5FA]/5">
                    {selectedItem.type === 'voice' && (
                        <div className="space-y-6">
                            <audio src={(selectedItem as VoiceMemory).audioDataUrl} controls className="w-full" />
                            <p className="text-xl leading-relaxed">{(selectedItem as VoiceMemory).transcript}</p>
                        </div>
                    )}
                    {selectedItem.type === 'web' && (
                        <div className="space-y-6">
                            <a href={(selectedItem as any).url} target="_blank" rel="noreferrer" className="text-[#60A5FA] underline text-xl break-all">
                                {(selectedItem as any).url}
                            </a>
                            <p className="text-xl leading-relaxed">{(selectedItem as any).summary}</p>
                        </div>
                    )}
                    {selectedItem.type === 'item' && (
                        <div className="space-y-6">
                            <p className="text-xl leading-relaxed">{(selectedItem as PhysicalItemMemory).description}</p>
                            {(selectedItem as PhysicalItemMemory).imageDataUrl && (
                                <img src={(selectedItem as PhysicalItemMemory).imageDataUrl} className="w-full rounded-xl border-3 border-[#60A5FA]/20" />
                            )}
                        </div>
                    )}
                    {(selectedItem.type === 'document' || selectedItem.type === 'file') && (
                        <div className="space-y-6">
                            {'imageDataUrl' in selectedItem && (selectedItem as any).imageDataUrl && (
                                <img src={(selectedItem as any).imageDataUrl} className="w-full rounded-xl border-3 border-[#60A5FA]/20" />
                            )}
                            <p className="text-xl leading-relaxed">
                                {'extractedText' in selectedItem ? (selectedItem as any).extractedText : 'No text content available.'}
                            </p>
                        </div>
                    )}
                </div>

                <div className="h-[40vh] card-brutal p-0 overflow-hidden">
                    <QASession memories={[selectedItem]} tasks={[]} />
                </div>
            </div>
        );
    }

    return null;
};

export default PersonalView;

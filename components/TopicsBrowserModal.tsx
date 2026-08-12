import React, { useMemo, useState } from 'react';
import { X, BookOpen, ArrowLeft, Plus, Loader2 } from 'lucide-react';
import type { AnyMemory } from '../types';
import ClaudeResearchPanel from './ClaudeResearchPanel';
import { askQuestion } from '../services/geminiService';

interface TopicsBrowserModalProps {
  memories: AnyMemory[];
  onSaveMemory: (memory: Omit<AnyMemory, 'id' | 'date'>) => void;
  onUpdateMemory?: (id: string, updates: Partial<AnyMemory>) => void;
  onClose: () => void;
}

const TopicsBrowserModal: React.FC<TopicsBrowserModalProps> = ({ memories, onSaveMemory, onUpdateMemory, onClose }) => {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [showResearch, setShowResearch] = useState(false);
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [newTopicInput, setNewTopicInput] = useState('');
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);

  const topicMap = useMemo(() => {
    const map = new Map<string, AnyMemory[]>();
    for (const mem of memories) {
      if (!mem.topics?.length) continue;
      for (const topic of mem.topics) {
        if (!map.has(topic)) map.set(topic, []);
        map.get(topic)!.push(mem);
      }
    }
    return map;
  }, [memories]);

  const sortedTopics = useMemo(() =>
    [...topicMap.entries()].sort((a, b) => b[1].length - a[1].length),
    [topicMap]
  );

  const filteredMemories = selectedTopic ? (topicMap.get(selectedTopic) ?? []) : [];

  const createNewTopic = async () => {
    if (!newTopicInput.trim() || !onUpdateMemory) return;

    setIsCreatingTopic(true);
    const topicName = newTopicInput.trim();
    let updatedCount = 0;

    try {
      for (const memory of memories) {
        const memoryText = (memory as any).transcript || (memory as any).summary || (memory as any).content || memory.title || '';

        if (!memoryText) continue;

        const question = `Is this memory related to the topic "${topicName}"? Consider the title, content, and context.

Memory: ${memoryText.slice(0, 500)}

Answer with only "yes" or "no".`;

        try {
          const response = await askQuestion(question, '');

          if (response.toLowerCase().includes('yes')) {
            const existingTopics = memory.topics || [];
            if (!existingTopics.includes(topicName)) {
              onUpdateMemory(memory.id, { topics: [...existingTopics, topicName] });
              updatedCount++;
            }
          }
        } catch (err) {
          console.error('Error categorizing memory:', err);
        }
      }

      setNewTopicInput('');
      setShowCreateTopic(false);
    } finally {
      setIsCreatingTopic(false);
    }
  };

  const handleBack = () => {
    if (showResearch) { setShowResearch(false); return; }
    if (selectedTopic) { setSelectedTopic(null); return; }
    if (showCreateTopic) { setShowCreateTopic(false); return; }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#001F3F] flex flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b-2 border-white/20 flex-shrink-0">
        <button onClick={handleBack} className="btn-icon p-2">
          {selectedTopic || showResearch || showCreateTopic ? <ArrowLeft className="w-6 h-6" /> : <X className="w-6 h-6" />}
        </button>
        <h2 className="text-xl font-black uppercase tracking-tight flex-1">
          {showResearch ? `Research` : showCreateTopic ? 'Create Topic' : selectedTopic ?? 'My Topics'}
        </h2>
        {!selectedTopic && !showResearch && !showCreateTopic && (
          <button
            onClick={() => setShowCreateTopic(true)}
            aria-label="Create new topic"
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 no-scrollbar">
        {/* Create Topic Form */}
        {showCreateTopic && (
          <div className="flex flex-col gap-4">
            <div className="bg-white/5 border border-white/20 rounded-2xl p-4 flex flex-col gap-4">
              <p className="text-sm text-white/70 font-bold">
                Enter a topic name. AI will scan your memories and auto-assign this topic to relevant ones.
              </p>
              <input
                type="text"
                placeholder="e.g., Claude, Python, Travel..."
                value={newTopicInput}
                onChange={e => setNewTopicInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isCreatingTopic && createNewTopic()}
                className="w-full px-4 py-3 bg-white/10 rounded-xl border border-white/20 text-white placeholder:text-white/40 outline-none focus:border-white/40 transition-colors"
                disabled={isCreatingTopic}
              />
              <button
                onClick={createNewTopic}
                disabled={!newTopicInput.trim() || isCreatingTopic}
                className="w-full py-3 bg-[#0891B2] text-white rounded-xl font-black uppercase disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
              >
                {isCreatingTopic ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating & Categorizing...
                  </>
                ) : (
                  'Create Topic'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Topic list */}
        {!selectedTopic && !showCreateTopic && (
          <>
            {sortedTopics.length === 0 ? (
              <div className="text-center py-16 opacity-50 flex flex-col gap-3 items-center">
                <p className="font-black uppercase text-lg">No Topics Yet</p>
                <p className="text-sm leading-relaxed max-w-xs">
                  Topics are auto-generated by AI when you save new memories. Tap the + button to manually create one, or save a voice note or web clip to get started.
                </p>
              </div>
            ) : (
              sortedTopics.map(([topic, mems]) => (
                <button
                  key={topic}
                  onClick={() => setSelectedTopic(topic)}
                  className="w-full flex items-center justify-between px-5 py-4 bg-white/10 rounded-2xl text-left"
                >
                  <span className="font-black uppercase">{topic}</span>
                  <span className="text-sm opacity-60 font-bold">
                    {mems.length} {mems.length === 1 ? 'memory' : 'memories'}
                  </span>
                </button>
              ))
            )}
          </>
        )}

        {/* Selected topic — memory list + research button */}
        {selectedTopic && !showResearch && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setShowResearch(true)}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-[#0891B2] text-white"
            >
              <BookOpen className="w-6 h-6" strokeWidth={2.5} />
              <span className="font-black uppercase tracking-wide">Research with Claude</span>
            </button>

            {filteredMemories.length === 0 ? (
              <p className="text-center opacity-50 text-sm font-bold py-6">No memories in this topic</p>
            ) : (
              filteredMemories.map(mem => (
                <div key={mem.id} className="card-brutal flex flex-col gap-1">
                  <span className="font-black text-sm uppercase leading-tight">{mem.title || 'Untitled'}</span>
                  <span className="text-xs opacity-50 font-bold capitalize">
                    {new Date(mem.date).toLocaleDateString()} · {mem.type}
                  </span>
                  {((mem as any).summary || (mem as any).transcript) && (
                    <p className="text-xs opacity-70 mt-1 leading-relaxed line-clamp-3">
                      {((mem as any).summary || (mem as any).transcript || '').slice(0, 200)}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Research panel */}
        {selectedTopic && showResearch && (
          <ClaudeResearchPanel
            topic={selectedTopic}
            onSaveMemory={onSaveMemory}
            onClose={() => setShowResearch(false)}
          />
        )}
      </div>
    </div>
  );
};

export default TopicsBrowserModal;

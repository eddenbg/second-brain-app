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
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  // Topics the user made by hand. Kept separately because the topic list is
  // otherwise derived purely from memories — so a topic that matched nothing
  // would vanish the moment it was created.
  const [customTopics, setCustomTopics] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('custom_topics') || '[]'); } catch { return []; }
  });

  const rememberCustomTopic = (topic: string) => {
    setCustomTopics(prev => {
      if (prev.includes(topic)) return prev;
      const next = [...prev, topic];
      try { localStorage.setItem('custom_topics', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const topicMap = useMemo(() => {
    const map = new Map<string, AnyMemory[]>();
    // Seed with hand-made topics so they show up even before anything matches.
    for (const topic of customTopics) map.set(topic, []);
    for (const mem of memories) {
      if (!mem.topics?.length) continue;
      for (const topic of mem.topics) {
        if (!map.has(topic)) map.set(topic, []);
        map.get(topic)!.push(mem);
      }
    }
    return map;
  }, [memories, customTopics]);

  const sortedTopics = useMemo(() =>
    [...topicMap.entries()].sort((a, b) => b[1].length - a[1].length),
    [topicMap]
  );

  const filteredMemories = selectedTopic ? (topicMap.get(selectedTopic) ?? []) : [];

  /** Pull the first JSON array out of a model reply, tolerating ``` fences and prose. */
  const parseIndexList = (reply: string): number[] => {
    const match = reply.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed.filter((n: unknown) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  };

  const createNewTopic = async () => {
    const topicName = newTopicInput.trim();
    if (!topicName || isCreatingTopic) return;

    setIsCreatingTopic(true);
    setCreateStatus(null);

    // Register it up front so the topic exists no matter how matching goes.
    rememberCustomTopic(topicName);

    try {
      if (!onUpdateMemory) {
        setCreateStatus(`Created "${topicName}". Memories can't be tagged from here.`);
        return;
      }

      const candidates = memories
        .map(mem => ({
          mem,
          text: ((mem as any).transcript || (mem as any).summary || (mem as any).content || '') as string,
        }))
        .filter(c => (c.mem.title || c.text) && !c.mem.topics?.includes(topicName));

      if (candidates.length === 0) {
        setCreateStatus(`Created "${topicName}". No memories to scan yet.`);
        return;
      }

      // One request per batch instead of one per memory. The old version fired a
      // sequential call for every single memory, which was slow enough to look
      // like a hang and fell over well before it finished.
      const BATCH = 25;
      let tagged = 0;
      let failedBatches = 0;

      for (let start = 0; start < candidates.length; start += BATCH) {
        const batch = candidates.slice(start, start + BATCH);
        const listing = batch
          .map((c, i) => `${i}. ${c.mem.title || 'Untitled'} — ${c.text.slice(0, 200).replace(/\s+/g, ' ')}`)
          .join('\n');

        const question =
          `Which of these items relate to the topic "${topicName}"?\n\n` +
          `${listing}\n\n` +
          `Reply with ONLY a JSON array of the matching numbers, e.g. [0,3,7]. ` +
          `Reply with [] if none match. No other text.`;

        try {
          const reply = await askQuestion(question, '');
          for (const idx of parseIndexList(reply)) {
            const hit = batch[idx];
            if (!hit) continue;
            onUpdateMemory(hit.mem.id, { topics: [...(hit.mem.topics || []), topicName] });
            tagged++;
          }
        } catch (err) {
          console.error('Topic categorization batch failed', err);
          failedBatches++;
        }
      }

      if (failedBatches > 0 && tagged === 0) {
        setCreateStatus(`Created "${topicName}", but auto-tagging failed — check your Gemini API key in Settings.`);
      } else {
        setCreateStatus(
          `Created "${topicName}" and tagged ${tagged} ${tagged === 1 ? 'memory' : 'memories'}.` +
          (failedBatches > 0 ? ' Some memories could not be scanned.' : '')
        );
      }
      setNewTopicInput('');
    } catch (err) {
      console.error('Topic creation failed', err);
      setCreateStatus(`Created "${topicName}", but something went wrong while scanning.`);
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

              {/* Result stays on screen instead of silently bouncing back to the
                  list, which made a successful run look like nothing happened. */}
              {createStatus && (
                <div className="flex flex-col gap-3" role="status" aria-live="polite">
                  <p className="text-sm font-bold text-green-300 leading-relaxed">{createStatus}</p>
                  <button
                    onClick={() => { setCreateStatus(null); setShowCreateTopic(false); }}
                    className="w-full py-3 bg-white/10 text-white rounded-xl font-black uppercase"
                  >
                    Back to Topics
                  </button>
                </div>
              )}
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

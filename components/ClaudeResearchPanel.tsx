import React, { useState } from 'react';
import { Search, Loader2, ExternalLink, Download, X } from 'lucide-react';
import type { AnyMemory, WebMemory } from '../types';

interface Resource {
  title: string;
  url: string;
  summary: string;
  type: string;
}

interface ResearchResult {
  overview: string;
  resources: Resource[];
}

interface ClaudeResearchPanelProps {
  topic: string;
  onSaveMemory: (memory: Omit<AnyMemory, 'id' | 'date'>) => void;
  onClose: () => void;
}

const ClaudeResearchPanel: React.FC<ClaudeResearchPanelProps> = ({ topic, onSaveMemory, onClose }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  const research = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const storedKey = typeof localStorage !== 'undefined' ? (localStorage.getItem('anthropic_api_key') || '') : '';
      const res = await fetch('/.netlify/functions/claudeProxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedKey ? { 'X-Anthropic-Key': storedKey } : {}),
        },
        body: JSON.stringify({ topic, query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Research failed');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const importResource = (resource: Resource) => {
    onSaveMemory({
      type: 'web',
      title: resource.title,
      category: 'personal',
      url: resource.url,
      content: resource.summary,
      tags: [topic],
    } as Omit<WebMemory, 'id' | 'date'>);
    setImported(prev => new Set([...prev, resource.url]));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-black uppercase tracking-wide">Research: {topic}</h3>
        <button onClick={onClose} className="btn-icon p-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && research()}
          placeholder={`What do you want to learn about ${topic}?`}
          className="flex-1 !text-sm !py-3 !px-4"
        />
        <button
          onClick={research}
          disabled={loading || !query.trim()}
          className="px-4 bg-white text-[#001F3F] disabled:opacity-40 flex items-center justify-center"
          style={{ minWidth: 56 }}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm font-bold border-2 border-red-400 rounded-xl p-3">{error}</p>
      )}

      {loading && (
        <div className="flex items-center gap-3 py-8 justify-center opacity-70">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-black uppercase tracking-wide">Claude is searching the web…</span>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {result.overview && (
            <p className="text-sm opacity-80 leading-relaxed border-l-4 border-white/30 pl-3">{result.overview}</p>
          )}
          {result.resources.length === 0 && (
            <p className="text-sm opacity-50 font-bold text-center py-4">No resources found. Try a different query.</p>
          )}
          {result.resources.map((res, i) => (
            <div key={i} className="card-brutal flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <a
                  href={res.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-black text-sm flex items-center gap-1 hover:opacity-70 transition-opacity"
                >
                  {res.title}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                <span className="text-xs opacity-50 uppercase font-bold flex-shrink-0 bg-white/10 rounded px-2 py-0.5">{res.type}</span>
              </div>
              <p className="text-xs opacity-75 leading-relaxed">{res.summary}</p>
              <button
                onClick={() => importResource(res)}
                disabled={imported.has(res.url)}
                className="w-full !py-2 !text-xs bg-white text-[#001F3F] disabled:opacity-40 flex items-center justify-center gap-1"
                style={{ minHeight: 36 }}
              >
                <Download className="w-3 h-3" />
                {imported.has(res.url) ? 'Saved to Web Clips' : 'Import to Web Clips'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClaudeResearchPanel;

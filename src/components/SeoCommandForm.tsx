import React, { useState, useEffect } from 'react';
import { Search, Play, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SEO_COMMANDS } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { apiService } from '../services/api';
import type { ModelOption } from '../types';

interface SeoCommandFormProps {
  onRun: (commandKey: string, target: string, model?: string) => void;
  isLoading: boolean;
}

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'default', label: 'Default (recommended)', description: 'Account default model' },
  { id: 'sonnet', label: 'Sonnet', description: 'Latest Sonnet' },
  { id: 'sonnet[1m]', label: 'Sonnet (1M context)', description: 'Long context' },
  { id: 'opus', label: 'Opus', description: 'Most capable' },
  { id: 'opus[1m]', label: 'Opus (1M context)', description: 'Long context Opus' },
  { id: 'haiku', label: 'Haiku', description: 'Fast / efficient' }
];

export default function SeoCommandForm({ onRun, isLoading }: SeoCommandFormProps) {
  const [selectedKey, setSelectedKey] = useState(SEO_COMMANDS[0].key);
  const [target, setTarget] = useState('');
  const [model, setModel] = useState('default');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);

  const selectedCommand = SEO_COMMANDS.find(c => c.key === selectedKey)!;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.getModels();
        if (!cancelled && list.length) setModels(list);
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setError(null);
  }, [selectedKey, target]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!target.trim()) {
      setError('Target input is required');
      return;
    }

    if (selectedCommand.requiresUrl && !target.startsWith('https://')) {
      setError('Target must be a valid URL starting with https://');
      return;
    }

    onRun(selectedKey, target, model);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Command Runner</h2>
          <p className="text-sm text-gray-500">Select an SEO tool and provide the target input.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.description ? `${m.label} — ${m.description}` : m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 block">SEO Command</label>
            <div className="relative">
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={isLoading}
                className="w-full pl-3 pr-10 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none appearance-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                {SEO_COMMANDS.map((cmd) => (
                  <option key={cmd.key} value={cmd.key}>
                    {cmd.label}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-400">
                <Search size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 block">Target</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={isLoading}
              placeholder={selectedCommand.placeholder}
              className={`w-full px-4 py-2.5 bg-white border rounded-xl text-sm focus:ring-2 transition-all outline-none disabled:bg-gray-50 disabled:text-gray-400 ${
                error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-indigo-500'
              }`}
            />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-100"
            >
              <AlertCircle size={18} />
              <span className="text-sm font-medium">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle2 size={14} className="text-green-500" />
            <span>Command: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-indigo-600 font-mono">{selectedCommand.command} {target || '<target>'}</code></span>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-sm ${
              isLoading 
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
            }`}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                <span>Run Command</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

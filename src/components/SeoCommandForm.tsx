import React, { useState, useEffect, useRef } from 'react';
import { Search, Play, AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { BLOG_COMMAND_GROUPS, BLOG_COMMANDS, BLOG_SKILL_VERSION } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { apiService } from '../services/api';
import type { ModelOption } from '../types';

interface SeoCommandFormProps {
  onRun: (commandKey: string, target: string, model?: string) => void;
  /** Fired when command or target draft changes so Pretty Output can switch conversation threads. */
  onSessionChange?: (commandKey: string, target: string) => void;
  isLoading: boolean;
}

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Latest highest-capability Claude' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', description: 'Latest Opus; 1M context' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Latest Sonnet; 1M context' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Latest Haiku; fast and efficient' },
  { id: 'default', label: 'Account default', description: 'Clears CLI model override (tier default)' },
];

export default function SeoCommandForm({ onRun, onSessionChange, isLoading }: SeoCommandFormProps) {
  const [selectedKey, setSelectedKey] = useState(BLOG_COMMANDS[0].key);
  const [target, setTarget] = useState('');
  const [model, setModel] = useState('claude-fable-5');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCommand = BLOG_COMMANDS.find(c => c.key === selectedKey)!;

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

  useEffect(() => {
    onSessionChange?.(selectedKey, target);
  }, [selectedKey, target, onSessionChange]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCommand.targetOptional && !target.trim()) {
      setError('Target input is required for this command');
      return;
    }

    onRun(selectedKey, target, model);
  };

  const onPickFile = () => {
    if (isLoading || uploadBusy) return;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    setError(null);
    try {
      const { relativePath } = await apiService.uploadTargetFile(file);
      setTarget(relativePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Upload failed');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Command Runner</h2>
          <p className="text-sm text-gray-500">
            Select a claude-blog v{BLOG_SKILL_VERSION} command and optional target (topic, path under{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_WORKDIR</code>, or <strong>Upload</strong> to save into{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">ui-uploads/</code> and fill Target).
          </p>
        </div>
        
        <div className="w-full sm:w-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full sm:w-auto sm:max-w-[min(42rem,60vw)] min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.description ? `${m.label} — ${m.description}` : m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 block">Blog command</label>
            <div className="relative">
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={isLoading}
                className="w-full pl-3 pr-10 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none appearance-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                {BLOG_COMMAND_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {BLOG_COMMANDS.filter((cmd) => cmd.group === group).map((cmd) => (
                      <option key={cmd.key} value={cmd.key}>
                        {cmd.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-400">
                <Search size={16} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 block">
              Target{selectedCommand.targetOptional ? ' (optional)' : ''}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".md,.markdown,.txt,.json,.html,.htm,.csv,.xml,.yaml,.yml,.rst,text/*"
              aria-hidden
              tabIndex={-1}
              onChange={onFileChosen}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={isLoading || uploadBusy}
                placeholder={selectedCommand.placeholder}
                className={`min-w-0 flex-1 px-4 py-2.5 bg-white border rounded-xl text-sm focus:ring-2 transition-all outline-none disabled:bg-gray-50 disabled:text-gray-400 ${
                  error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-indigo-500'
                }`}
              />
              <button
                type="button"
                onClick={onPickFile}
                disabled={isLoading || uploadBusy}
                title="Upload a file to the server workspace (ui-uploads) and set Target to that path"
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload size={16} aria-hidden />
                {uploadBusy ? '…' : 'Upload'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 leading-snug">
              Upload stores a copy next to your project on the API host so skills like <em>analyze</em> / <em>rewrite</em> can read it by path.
            </p>
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
          <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
            <CheckCircle2 size={14} className="text-green-500" />
            <span>
              Command:{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-indigo-600 font-mono">
                {selectedCommand.targetOptional && !target.trim()
                  ? selectedCommand.command
                  : `${selectedCommand.command} ${target || '…'}`.trim()}
              </code>
            </span>
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

import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { BLOG_COMMANDS, GroupedHistory, HistoryItem, historyCommandLine, isLikelyHttpUrl } from '../types';
import { formatChatThreadKey } from '../lib/dashboardChatHistory';
import { 
  ChevronDown, 
  ChevronRight, 
  ExternalLink, 
  Search, 
  Filter,
  ArrowLeft,
  Calendar,
  Clock,
  Globe,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ResultsView from './ResultsView';

export default function HistoryView() {
  const [history, setHistory] = useState<GroupedHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const data = await apiService.getHistory();
        setHistory(data);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setIsLoading(false);
      }
    };
    void fetchHistory();
    const onFocus = () => {
      void fetchHistory();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const toggleGroup = (target: string) => {
    const next = new Set(expandedGroups);
    if (next.has(target)) next.delete(target);
    else next.add(target);
    setExpandedGroups(next);
  };

  const filteredHistory = history.map(group => ({
    ...group,
    items: (group.items || []).filter(item => 
      filter === 'all' || item.commandKey === filter
    )
  })).filter(group => group.items && group.items.length > 0);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (selectedItem) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button 
            onClick={() => setSelectedItem(null)}
            className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-indigo-600 transition-colors group"
          >
            <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            Back to History
          </button>
          
          <div className="flex items-center gap-4 text-xs font-medium text-gray-400">
            <div className="flex items-center gap-1.5">
              <Calendar size={14} />
              {formatDate(selectedItem.timestamp)}
            </div>
            <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
            <div className="flex items-center gap-1.5">
              <Globe size={14} />
              {selectedItem.target}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selectedItem.commandLabel}</h2>
              <p className="text-sm text-gray-500 mt-1">Historical run output</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              selectedItem.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {selectedItem.status}
            </div>
          </div>

          <ResultsView
            result={{
              success: selectedItem.status === 'success',
              commandExecuted: historyCommandLine(selectedItem),
              rawOutput: selectedItem.rawOutput,
              parsedReport: selectedItem.parsedReport,
              stats: {
                durationMs: selectedItem.durationMs,
                startedAt: selectedItem.timestamp,
                finishedAt: selectedItem.timestamp // Approximation
              }
            }}
            isLoading={false}
            chatThreadKey={formatChatThreadKey(selectedItem.commandKey, selectedItem.target)}
            chatHistoryTick={0}
            embedMode="history"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search targets or commands..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <Filter size={18} className="text-gray-400" />
          <select 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
          >
            <option value="all">All commands</option>
            {BLOG_COMMANDS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-200 border-dashed">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-500 font-medium">Loading analysis history...</p>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-200 border-dashed">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <History size={32} className="text-gray-300" />
          </div>
          <p className="text-gray-500 font-medium">No history found matching your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHistory.map((group) => (
            <div key={group.target} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
              {/* Group Header */}
              <div 
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleGroup(group.target)}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 shrink-0">
                    <Globe size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900 truncate">{group.target}</h3>
                      {isLikelyHttpUrl(group.target) ? (
                        <a
                          href={group.target}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-indigo-600 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500 font-medium">
                        {group.items.length} {group.items.length === 1 ? 'analysis' : 'analyses'}
                      </span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-xs text-gray-400">
                        Latest: {formatDate(group.latestTimestamp)}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <button 
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem(group.items[0]);
                    }}
                  >
                    View Latest Report
                  </button>
                  <div className="text-gray-400">
                    {expandedGroups.has(group.target) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                  </div>
                </div>
              </div>

              {/* Group Sub-items */}
              <AnimatePresence>
                {expandedGroups.has(group.target) && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-gray-100 bg-gray-50/30"
                  >
                    <div className="p-2 space-y-1">
                      {group.items.map((item, idx) => (
                        <div 
                          key={item.id} 
                          className="flex items-center justify-between p-3 rounded-xl hover:bg-white hover:shadow-sm transition-all group"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-8 text-xs font-bold text-gray-300 text-center">
                              #{group.items.length - idx}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-gray-700">{item.commandLabel}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Clock size={12} className="text-gray-400" />
                                <span className="text-[11px] text-gray-500 font-medium">
                                  {formatDate(item.timestamp)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <div className="flex items-center gap-4">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                item.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {item.status}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono w-16 text-right">{item.durationMs}ms</span>
                            </div>
                            <button 
                              className="px-3 py-1.5 bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50 rounded-lg text-xs font-bold transition-colors shadow-sm"
                              onClick={() => setSelectedItem(item)}
                            >
                              View Report
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import Layout from './components/Layout';
import SeoCommandForm from './components/SeoCommandForm';
import ResultsView from './components/ResultsView';
import HistoryView from './components/HistoryView';
import UsageView from './components/UsageView';
import { apiService } from './services/api';
import { RunResponse } from './types';
import { AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'history' | 'usage'>('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (commandKey: string, target: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiService.runSeoCommand(commandKey, target);
      setResult(response);
    } catch (err) {
      console.error('Failed to run SEO command:', err);
      setError('The backend terminal environment is currently unreachable or returned an error. Please check system status.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Layout activeView={activeView} onViewChange={setActiveView}>
      <AnimatePresence mode="wait">
        {activeView === 'dashboard' ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10 pb-20"
          >
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">SEO Command Center</h2>
                <p className="text-gray-500 mt-1">Execute professional SEO audits and technical analysis via Claude Code.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Terminal: AlmaLinux 9 / Docker
              </div>
            </div>

            {/* Error Alert */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-4"
                >
                  <div className="bg-red-100 p-2 rounded-lg">
                    <AlertCircle className="text-red-600" size={20} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-red-900">Execution Failed</h4>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                  </div>
                  <button 
                    onClick={() => setError(null)}
                    className="text-red-400 hover:text-red-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Form */}
            <SeoCommandForm onRun={handleRun} isLoading={isLoading} />

            {/* Results Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Audit Results</h3>
                <div className="flex-1 h-px bg-gray-100"></div>
              </div>
              <ResultsView result={result} isLoading={isLoading} />
            </div>
          </motion.div>
        ) : activeView === 'history' ? (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <HistoryView />
          </motion.div>
        ) : (
          <motion.div
            key="usage"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <UsageView />
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}

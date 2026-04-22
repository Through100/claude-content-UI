import React from 'react';
import { LayoutDashboard, Terminal, History, BarChart3, UserCircle, ShieldCheck, LogIn, RotateCcw } from 'lucide-react';
import ClaudeTerminalView from './ClaudeTerminalView';

/** Live-ish snapshot from GET /api/health + GET /api/account (/status parse). */
export type HeaderSessionSnapshot = {
  /** null until first health check completes */
  apiReachable: boolean | null;
  /** Parsed Status email when present (implies signed in for header UX). */
  claudeEmail: string | null;
  accountLoading: boolean;
  /** First name from interactive PTY "Welcome back {name}!" (Claude Code home banner). */
  ptyWelcomeName: string | null;
};

interface LayoutProps {
  children: React.ReactNode;
  activeView: 'dashboard' | 'history' | 'usage' | 'account' | 'logon';
  onViewChange: (view: 'dashboard' | 'history' | 'usage' | 'account' | 'logon') => void;
  headerSession: HeaderSessionSnapshot;
  /** When false, skip mounting the PTY WebSocket terminal (server disabled WS). */
  terminalWsEnabled: boolean;
  onPtyWelcomeBackDetected?: (name: string) => void;
  onPtySessionEnd?: () => void;
  /** Dashboard: reconnect the off-screen Logon PTY (after idle timeout or “Connection closed”). */
  onRestartPtySession?: () => void;
}

export default function Layout({
  children,
  activeView,
  onViewChange,
  headerSession,
  terminalWsEnabled,
  onPtyWelcomeBackDetected,
  onPtySessionEnd,
  onRestartPtySession
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex font-sans text-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen">
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Terminal className="text-white w-5 h-5" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">Claude Content</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activeView === 'dashboard'} 
            onClick={() => onViewChange('dashboard')}
          />
          <NavItem 
            icon={<History size={20} />} 
            label="History" 
            active={activeView === 'history'} 
            onClick={() => onViewChange('history')}
          />
          <NavItem 
            icon={<BarChart3 size={20} />} 
            label="Usage Info" 
            active={activeView === 'usage'} 
            onClick={() => onViewChange('usage')}
          />
          <NavItem
            icon={<LogIn size={20} />}
            label="Logon"
            active={activeView === 'logon'}
            onClick={() => onViewChange('logon')}
          />
          <NavItem
            icon={<UserCircle size={20} />}
            label="Account Info"
            active={activeView === 'account'}
            onClick={() => onViewChange('account')}
          />
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="bg-indigo-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-indigo-600" />
              <span className="text-xs font-semibold text-indigo-900 tracking-wide">System secure</span>
            </div>
            <p className="text-xs text-indigo-700 leading-relaxed">
              Meant to run within the DDM VPN. The terminal environment is isolated in a container and is intended only
              for the Claude Code CLI with the blog skill.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-10 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-sm font-medium text-gray-700 shrink-0">Claude Content</span>
            <span className="text-gray-300 shrink-0">/</span>
            <span className="text-sm font-semibold text-gray-900 uppercase tracking-wider truncate">
              {activeView === 'dashboard'
                ? 'Dashboard'
                : activeView === 'history'
                  ? 'History'
                  : activeView === 'usage'
                    ? 'Usage Info'
                    : activeView === 'logon'
                      ? 'Logon'
                      : 'Account Info'}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {activeView === 'dashboard' && terminalWsEnabled && onRestartPtySession ? (
              <button
                type="button"
                onClick={onRestartPtySession}
                title="Start a new interactive PTY session (same as Logon → Restart). Use after an idle disconnect or “Connection closed”."
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <RotateCcw size={14} className="text-indigo-600 shrink-0" aria-hidden />
                <span className="hidden sm:inline">Restart session</span>
                <span className="sm:hidden">Restart</span>
              </button>
            ) : null}
            <HeaderSessionPill snapshot={headerSession} />
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto w-full">
          {children}
          {terminalWsEnabled ? (
            <div
              className={
                activeView === 'logon'
                  ? 'mt-10 max-w-4xl'
                  : 'fixed left-[-9999px] top-0 z-[-1] h-[min(70vh,560px)] w-[min(100vw,720px)] opacity-0 pointer-events-none overflow-hidden'
              }
              aria-hidden={activeView !== 'logon'}
            >
              <ClaudeTerminalView
                compact
                title="Claude — interactive (PTY)"
                onWelcomeBackDetected={onPtyWelcomeBackDetected}
                onPtySessionEnd={onPtySessionEnd}
              />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function HeaderSessionPill({ snapshot }: { snapshot: HeaderSessionSnapshot }) {
  const { apiReachable, claudeEmail } = snapshot;
  const email = claudeEmail?.trim() ?? '';

  if (apiReachable === false) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0 bg-red-500" />
        <span className="text-xs font-medium text-gray-600 whitespace-nowrap">API offline</span>
      </div>
    );
  }

  if (email) {
    return (
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0" title="From Account Info /status refresh">
          <div className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" />
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">Online</span>
        </div>
        <div
          className="h-8 min-w-8 max-w-[min(12rem,40vw)] px-2 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center"
          title={email}
        >
          <span className="text-[11px] font-mono text-gray-800 truncate">{email}</span>
        </div>
      </div>
    );
  }

  return null;
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        active 
          ? 'bg-indigo-50 text-indigo-700' 
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  clearDashboardChatHistory,
  DASHBOARD_CHAT_STORAGE_KEY,
  loadDashboardChatHistory,
  type DashboardChatTurn
} from '../lib/dashboardChatHistory';
import PrettyOutputBody from './PrettyOutputBody';

type Props = {
  /** Bump after each completed headless run so we re-read localStorage. */
  refreshKey: number;
};

export default function DashboardHeadlessChat({ refreshKey }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const [turns, setTurns] = useState<DashboardChatTurn[]>(() => loadDashboardChatHistory());

  useEffect(() => {
    setTurns(loadDashboardChatHistory());
  }, [refreshKey]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DASHBOARD_CHAT_STORAGE_KEY) {
        setTurns(loadDashboardChatHistory());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [refreshKey, turns.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = gap < 120;
  };

  const empty = turns.length === 0;

  const onClear = () => {
    clearDashboardChatHistory();
    setTurns([]);
  };

  const list = useMemo(() => turns, [turns]);

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6 border-b border-gray-100 bg-gray-50/80">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Conversation</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Each run is one exchange (your command on the right, Claude on the left). Runs use{' '}
            <code className="text-[10px] bg-gray-100 px-1 rounded">claude -p</code> (one-shot); replies like{' '}
            <code className="text-[10px] bg-gray-100 px-1 rounded">1</code> go to the <strong>Logon / PTY</strong>{' '}
            session below, not back into this finished output.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Clear saved conversation"
        >
          <Trash2 size={14} aria-hidden />
          Clear
        </button>
      </div>

      {empty ? (
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          No runs yet. Use <strong>Command Runner</strong> above — each finished run appears here as a chat turn and
          stays in your browser until you clear it.
        </div>
      ) : (
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="flex flex-col gap-10 md:gap-12 px-4 py-6 md:px-10 md:py-8 max-h-[min(75vh,760px)] min-h-[240px] overflow-y-auto bg-white"
          role="log"
          aria-label="Headless run conversation"
        >
          {list.map((t) => (
            <React.Fragment key={t.id}>
              <div className="flex justify-end w-full">
                <div className="max-w-[min(100%,85%)] sm:max-w-[32rem] pl-8 sm:pl-12">
                  <div className="rounded-[1.35rem] bg-[#ececec] text-gray-900 px-4 py-2.5 md:px-5 md:py-3 text-[15px] leading-6 whitespace-pre-wrap break-words shadow-sm">
                    {t.user}
                  </div>
                </div>
              </div>
              <div className="flex justify-start w-full">
                <div className="w-full max-w-[min(100%,42rem)] md:max-w-[52rem] pr-2 md:pr-12">
                  <div className="rounded-2xl border border-gray-100 bg-white px-4 py-5 md:px-7 md:py-6 shadow-sm">
                    <PrettyOutputBody text={t.assistant} />
                  </div>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

import React, { useState, useEffect } from 'react';
import {
  Activity,
  DollarSign,
  Cpu,
  User,
  Shield,
  HardDrive,
  Terminal,
  Info,
  BarChart3,
  PieChart,
  Gauge,
  Clock,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { apiService } from '../services/api';
import type { UsageInfo, UsageTabInfo } from '../types';

const EMPTY_USAGE_TAB: UsageTabInfo = {
  currentSessionUsage: '—',
  weeklyUsageAllModels: '—',
  weeklyUsageOpus: '—',
  contextWindow: '—',
  rateLimitsAndResets: '—'
};

export default function UsageView() {
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setFetchError(null);
      try {
        const usageInfo = await apiService.getUsageInfo();
        setData(usageInfo);
      } catch (error) {
        console.error('Failed to fetch usage info:', error);
        setFetchError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-200 border-dashed">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 font-medium">Loading usage information...</p>
      </div>
    );
  }

  if (!data && !fetchError) return null;

  if (fetchError && !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-800 text-sm">
        <p className="font-bold">Could not load usage from Claude Code</p>
        <p className="mt-2 font-mono text-xs">{fetchError}</p>
      </div>
    );
  }

  if (!data) return null;

  const t = data.terminals;
  const billingMode = data.billingMode ?? 'api_credits';
  const subscriptionMode = billingMode === 'subscription';
  const usageTab = data.usageTab ?? EMPTY_USAGE_TAB;
  const statusLooksLikeUnknownSkill = (t?.status ?? '').toLowerCase().includes('unknown skill');

  return (
    <div className="space-y-8 pb-12">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}
      {/* Account & Status Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <User className="text-indigo-600" size={20} />
          <h3 className="text-lg font-bold text-gray-900">Account & Status</h3>
        </div>
        {statusLooksLikeUnknownSkill && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Probe output mentions &quot;Unknown skill&quot;</p>
            <p className="mt-1 text-amber-900/90">
              Slash commands are not available under <code className="rounded bg-amber-100/80 px-1">claude -p</code>. The
              server uses two separate prompts: one for the <strong>Status</strong> tab and one for the{' '}
              <strong>Usage</strong> tab of interactive <code className="rounded bg-amber-100/80 px-1">/usage</code>. Check
              the raw blocks below if fields stay empty.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatusCard
            icon={<Info className="text-blue-600" size={18} />}
            label="Version"
            value={data.status.version}
          />
          <StatusCard
            icon={<Terminal className="text-gray-600" size={18} />}
            label="Session Name"
            value={data.status.sessionName}
          />
          <StatusCard
            icon={<Shield className="text-indigo-600" size={18} />}
            label="Session ID"
            value={data.status.sessionId}
          />
          <StatusCard
            icon={<HardDrive className="text-orange-600" size={18} />}
            label="CWD"
            value={data.status.cwd}
          />
          <StatusCard
            icon={<User className="text-violet-600" size={18} />}
            label="Login method"
            value={data.status.loginMethod ?? '—'}
          />
          <StatusCard
            icon={<Shield className="text-indigo-600" size={18} />}
            label="Organization"
            value={data.status.organization}
          />
          <StatusCard
            icon={<User className="text-green-600" size={18} />}
            label="Email"
            value={data.status.email}
          />
          <StatusCard
            icon={<Cpu className="text-purple-600" size={18} />}
            label="Current Model"
            value={data.status.model}
          />
          <StatusCard
            icon={<BarChart3 className="text-slate-600" size={18} />}
            label="Setting sources"
            value={data.status.settingSources ?? '—'}
          />
        </div>
        {t?.status && (
          <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
            <summary className="cursor-pointer font-bold text-gray-700">Raw Status tab (headless probe)</summary>
            <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">{t.status}</pre>
          </details>
        )}
      </section>

      {/* Cost Analysis (API credits) or Usage Analysis (subscription / Pro) */}
      <section className="space-y-4">
        {subscriptionMode ? (
          <>
            <div className="flex items-center gap-2 px-1">
              <Gauge className="text-indigo-600" size={20} />
              <h3 className="text-lg font-bold text-gray-900">Usage Analysis</h3>
            </div>
            <p className="text-sm text-gray-600 px-1 leading-relaxed max-w-3xl">
              Your account is on a <span className="font-semibold text-gray-800">subscription plan</span>, so per-token
              dollar totals live under API-style billing instead of here. The cards below mirror only the{' '}
              <strong>Usage</strong> tab of interactive <code className="rounded bg-gray-100 px-1 text-xs">/usage</code>{' '}
              (rolling window quota, weekly limits, context, resets)—not Status, Config, or Stats. Filled by a separate
              headless probe; <code className="rounded bg-gray-100 px-1 text-xs">claude -p</code> cannot run slash
              commands.
            </p>
            <p className="text-xs text-gray-500 px-1">
              &quot;Current session usage&quot; in Claude Code is usually a <strong>server-side time window</strong>{' '}
              (often ~5 hours), not tied to restarting the CLI.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatusCard
                icon={<Clock className="text-amber-600" size={18} />}
                label="Current session usage"
                value={usageTab.currentSessionUsage}
              />
              <StatusCard
                icon={<BarChart3 className="text-indigo-600" size={18} />}
                label="Weekly usage (all models)"
                value={usageTab.weeklyUsageAllModels}
              />
              <StatusCard
                icon={<Sparkles className="text-violet-600" size={18} />}
                label="Weekly usage (Opus)"
                value={usageTab.weeklyUsageOpus}
              />
              <StatusCard
                icon={<PieChart className="text-teal-600" size={18} />}
                label="Context window"
                value={usageTab.contextWindow}
              />
              <StatusCard
                icon={<RefreshCw className="text-slate-600" size={18} />}
                label="Rate limits & resets"
                value={usageTab.rateLimitsAndResets}
              />
            </div>
            {t?.usage && (
              <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
                <summary className="cursor-pointer font-bold text-gray-700">Raw Usage tab (headless probe)</summary>
                <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">
                  {t.usage}
                </pre>
              </details>
            )}
            {t?.cost && (
              <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
                <summary className="cursor-pointer font-bold text-gray-700">Raw /cost output (plan message)</summary>
                <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">
                  {t.cost}
                </pre>
              </details>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1">
              <DollarSign className="text-green-600" size={20} />
              <h3 className="text-lg font-bold text-gray-900">Cost Analysis</h3>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 bg-gray-50/50 border-b border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Cost</span>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{data.cost.totalCost}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">API Duration</span>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{data.cost.apiDuration}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Wall Duration</span>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{data.cost.wallDuration}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/30">
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Model</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Input</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Output</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Cache Read
                      </th>
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Cache Write
                      </th>
                      <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.cost.usageByModel.map((m, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">{m.model}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-mono">{m.input}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-mono">{m.output}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-mono">{m.cacheRead}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 font-mono">{m.cacheWrite}</td>
                        <td className="px-6 py-4 text-sm font-bold text-indigo-600 text-right">{m.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {t?.cost && (
              <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
                <summary className="cursor-pointer font-bold text-gray-700">Raw /cost output</summary>
                <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">
                  {t.cost}
                </pre>
              </details>
            )}
          </>
        )}
      </section>

      {/* Context Usage Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <Activity className="text-orange-600" size={20} />
          <h3 className="text-lg font-bold text-gray-900">Context Usage</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-gray-900">{data.context.model}</h4>
                <p className="text-xs text-gray-500 font-mono">{data.context.modelFull}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-indigo-600">{data.context.totalTokens} / {data.context.maxTokens}</div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{data.context.percentage}% Used</div>
              </div>
            </div>
            
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden flex">
              {data.context.categories.map((cat, idx) => (
                <div 
                  key={idx}
                  className={`h-full transition-all duration-1000 ${
                    idx === 0 ? 'bg-indigo-500' :
                    idx === 1 ? 'bg-blue-500' :
                    idx === 2 ? 'bg-purple-500' :
                    idx === 3 ? 'bg-pink-500' :
                    idx === 4 ? 'bg-orange-500' :
                    idx === 5 ? 'bg-gray-200' : 'bg-red-400'
                  }`}
                  style={{ width: `${cat.percentage}%` }}
                  title={`${cat.label}: ${cat.tokens} (${cat.percentage}%)`}
                ></div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.context.categories.map((cat, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-gray-50/50 border border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      idx === 0 ? 'bg-indigo-500' :
                      idx === 1 ? 'bg-blue-500' :
                      idx === 2 ? 'bg-purple-500' :
                      idx === 3 ? 'bg-pink-500' :
                      idx === 4 ? 'bg-orange-500' :
                      idx === 5 ? 'bg-gray-300' : 'bg-red-400'
                    }`}></div>
                    <span className="text-xs font-semibold text-gray-700">{cat.label}</span>
                  </div>
                  <div className="text-xs font-mono text-gray-500">{cat.tokens} ({cat.percentage}%)</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <BarChart3 size={16} />
              Custom Agents
            </h4>
            {data.context.agents.length === 0 ? (
              <p className="text-sm text-gray-500">No agent rows parsed — check raw /context if you expected a table.</p>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar rounded-xl border border-gray-100">
                <table className="w-full text-left text-sm border-collapse min-w-[280px]">
                  <thead>
                    <tr className="bg-gray-50/80 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.context.agents.map((agent, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2 font-medium text-gray-900 font-mono text-xs">{agent.name}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{agent.source ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{agent.tokens}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <PieChart size={16} />
            Skills
          </h4>
          {data.context.skills.length === 0 ? (
            <p className="text-sm text-gray-500">No skill rows parsed — check raw /context if you expected a table.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[480px] overflow-y-auto custom-scrollbar pr-1">
              {data.context.skills.map((skill, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-gray-50/50 border border-gray-100 flex flex-col gap-1 min-w-0"
                >
                  <span className="text-xs font-bold text-gray-900 truncate font-mono" title={skill.name}>
                    {skill.name}
                  </span>
                  <span className="text-[10px] text-gray-500 truncate">{skill.source ?? '—'}</span>
                  <span className="text-[10px] font-mono text-indigo-600">{skill.tokens}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {t?.context && (
          <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
            <summary className="cursor-pointer font-bold text-gray-700">Raw /context output</summary>
            <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">{t.context}</pre>
          </details>
        )}
      </section>

      {data.exitCodes && (
        <p className="text-[10px] font-mono text-gray-400 px-1">
          Process exit codes: {JSON.stringify(data.exitCodes)}
        </p>
      )}
    </div>
  );
}

function StatusCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start gap-4 hover:border-indigo-200 transition-colors">
      <div className="p-2.5 bg-gray-50 rounded-xl">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
        <span className="text-sm font-bold text-gray-900 mt-1 block truncate">{value}</span>
      </div>
    </div>
  );
}

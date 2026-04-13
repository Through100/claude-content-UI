import React, { useState, useEffect } from 'react';
import { Activity, DollarSign, Cpu, User, Shield, HardDrive, Terminal, Info, BarChart3, PieChart } from 'lucide-react';
import { apiService } from '../services/api';
import { SystemStatus, CostInfo, ContextUsage } from '../types';
import { motion } from 'motion/react';

export default function UsageView() {
  const [data, setData] = useState<{
    status: SystemStatus;
    cost: CostInfo;
    context: ContextUsage;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const usageInfo = await apiService.getUsageInfo();
        setData(usageInfo);
      } catch (error) {
        console.error('Failed to fetch usage info:', error);
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

  if (!data) return null;

  return (
    <div className="space-y-8 pb-12">
      {/* Account & Status Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <User className="text-indigo-600" size={20} />
          <h3 className="text-lg font-bold text-gray-900">Account & Status</h3>
        </div>
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
            icon={<HardDrive className="text-orange-600" size={18} />}
            label="CWD"
            value={data.status.cwd}
          />
        </div>
      </section>

      {/* Cost Analysis Section */}
      <section className="space-y-4">
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
                  <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cache Read</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cache Write</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Cost</th>
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

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
            <div>
              <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <BarChart3 size={16} />
                Custom Agents
              </h4>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {data.context.agents.map((agent, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 font-medium">{agent.name}</span>
                    <span className="text-gray-400 font-mono text-xs">{agent.tokens} tokens</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
            <PieChart size={16} />
            Skills Usage Breakdown
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.context.skills.map((skill, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-gray-50/50 border border-gray-100 flex flex-col items-center text-center">
                <span className="text-xs font-bold text-gray-900 truncate w-full">{skill.name}</span>
                <span className="text-[10px] font-mono text-gray-400 mt-1">{skill.tokens} tokens</span>
              </div>
            ))}
          </div>
        </div>
      </section>
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

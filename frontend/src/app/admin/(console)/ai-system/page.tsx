"use client";

import React, { useState } from "react";
import { Cpu, Activity, Timer, AlertTriangle, Gauge, Mic, AudioLines, GitBranch, ArrowRight, ArrowDown, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, CardTitle, CardDescription, PageHeader, StatCard, Toast } from "@/components/ui";
import { LineChart, CHART_COLORS } from "@/components/charts";
import { AgentStatusTable } from "@/features/admin/components/AgentStatusTable";
import { mockAiAgentStatuses, mockServiceHealth } from "@/data";
import { cn } from "@/lib/utils";
import { agentStatusMeta } from "@/lib/status";
import { useToast } from "@/hooks/useToast";
import { LOCALE } from "@/lib/constants";

const HOURS = ["22", "23", "00", "01", "02", "03", "04", "05", "06", "07", "08", "09"];

export default function AdminAiSystemPage() {
  const agents = mockAiAgentStatuses;
  const [selectedId, setSelectedId] = useState(agents.find((a) => a.status !== "operational")?.agentId ?? agents[0].agentId);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const selected = agents.find((a) => a.agentId === selectedId) ?? agents[0];

  const capabilityAgents = agents.filter((a) => a.kind === "agent");
  const supervisor = agents.find((a) => a.kind === "router");
  const voice = agents.find((a) => a.kind === "input");
  const totalRequests = supervisor?.totalRequestsToday ?? 0;
  const totalErrors = agents.reduce((a, x) => a + (x.errorsToday ?? 0), 0);
  const weightedLatency = Math.round(
    capabilityAgents.reduce((a, x) => a + x.averageLatencyMs * x.totalRequestsToday, 0) / capabilityAgents.reduce((a, x) => a + x.totalRequestsToday, 0)
  );
  const operational = agents.filter((a) => a.status === "operational").length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cpu}
        title="AI System"
        description="Agent health, latency, throughput and errors across the platform."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            isLoading={refreshing}
            onClick={() => {
              setRefreshing(true);
              setTimeout(() => {
                setRefreshing(false);
                showToast("Metrics refreshed (mock data).", "info");
              }, 700);
            }}
          >
            {!refreshing && <RefreshCw className="w-3.5 h-3.5" />} Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Components Operational" value={`${operational}/${agents.length}`} icon={Activity} tone={operational === agents.length ? "emerald" : "amber"} hint="Agents, router & voice" />
        <StatCard label="Routed Requests" value={totalRequests.toLocaleString(LOCALE)} icon={GitBranch} tone="indigo" hint="Through the Supervisor today" />
        <StatCard label="Avg Agent Latency" value={`${weightedLatency} ms`} icon={Timer} tone="blue" hint="Request-weighted" />
        <StatCard label="Errors Today" value={totalErrors} icon={AlertTriangle} tone={totalErrors > 20 ? "rose" : "gray"} hint={`${((totalErrors / totalRequests) * 100).toFixed(3)}% of requests`} />
      </div>

      {/* Request flow */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Request Flow</CardTitle>
          <CardDescription>How a customer or owner message reaches the right capability</CardDescription>
        </CardHeader>
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 text-xs">
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 lg:w-40 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Input</div>
            <div className="flex items-center gap-1.5 text-gray-200">
              <Mic className="w-3.5 h-3.5 text-gray-400" /> Voice message
            </div>
            <div className="flex items-center gap-1.5 text-gray-200">
              <AudioLines className="w-3.5 h-3.5 text-gray-400" /> Text chat
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-600 hidden lg:block flex-shrink-0" />
          <ArrowDown className="w-4 h-4 text-gray-600 lg:hidden self-center" />
          <button
            type="button"
            onClick={() => voice && setSelectedId(voice.agentId)}
            className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 lg:w-44 text-left hover:border-gray-700 cursor-pointer"
          >
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Speech-to-Text</div>
            <div className="text-gray-200 mt-1">{voice?.name}</div>
            <div className="text-[10px] font-mono text-gray-500">{voice?.averageLatencyMs} ms • voice only</div>
          </button>
          <ArrowRight className="w-4 h-4 text-gray-600 hidden lg:block flex-shrink-0" />
          <ArrowDown className="w-4 h-4 text-gray-600 lg:hidden self-center" />
          <button
            type="button"
            onClick={() => supervisor && setSelectedId(supervisor.agentId)}
            className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 lg:w-48 text-left hover:border-amber-500/60 cursor-pointer"
          >
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold">Supervisor (internal)</div>
            <div className="text-gray-100 mt-1">Intent classification & routing</div>
            <div className="text-[10px] font-mono text-gray-500">{supervisor?.averageLatencyMs} ms • {supervisor?.totalRequestsToday.toLocaleString(LOCALE)} req</div>
          </button>
          <ArrowRight className="w-4 h-4 text-gray-600 hidden lg:block flex-shrink-0" />
          <ArrowDown className="w-4 h-4 text-gray-600 lg:hidden self-center" />
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-1.5">
            {capabilityAgents.map((a) => (
              <button
                key={a.agentId}
                type="button"
                onClick={() => setSelectedId(a.agentId)}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer",
                  selectedId === a.agentId ? "border-amber-500/60 bg-amber-500/10" : "border-gray-800 bg-gray-950/60 hover:border-gray-700"
                )}
              >
                <span className="flex items-center gap-1.5 text-[11px] text-gray-200">
                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", agentStatusMeta[a.status].dot)} />
                  <span className="truncate">{a.name.replace(" Agent", "")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Selected agent detail */}
        <Card className="xl:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3">
            <div>
              <h2 className="text-base font-semibold text-white">{selected.name}</h2>
              <p className="text-xs text-gray-400">{selected.role}</p>
            </div>
            <Badge variant={agentStatusMeta[selected.status].variant}>{agentStatusMeta[selected.status].label}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pb-4">
            {[
              { label: "Avg latency", value: `${selected.averageLatencyMs} ms` },
              { label: "p95 latency", value: `${selected.p95LatencyMs ?? "—"} ms` },
              { label: "Requests", value: selected.totalRequestsToday.toLocaleString(LOCALE) },
              { label: "Uptime (30d)", value: `${selected.uptimePercent.toFixed(2)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</div>
                <div className="text-sm font-bold text-white font-mono mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>
          {selected.latencyHistory && (
            <LineChart
              title={`${selected.name} average latency by hour`}
              data={selected.latencyHistory.map((v, i) => ({ label: `${HOURS[i]}:00`, values: { latency: v } }))}
              series={[{ key: "latency", label: "Avg latency", color: CHART_COLORS.blue }]}
              format={(v) => `${Math.round(v)} ms`}
              heightClass="h-44"
            />
          )}
          <p className="text-[11px] text-gray-500 pt-2">Last 12 hours, UTC.</p>
        </Card>

        {/* Infrastructure */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-amber-400" /> Infrastructure
            </CardTitle>
            <CardDescription>Dependencies the agents rely on</CardDescription>
          </CardHeader>
          <ul className="space-y-2">
            {mockServiceHealth.map((s) => (
              <li key={s.id} className={cn("rounded-lg border p-2.5", s.status === "operational" ? "border-gray-800 bg-gray-950/60" : "border-amber-500/30 bg-amber-500/5")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", agentStatusMeta[s.status].dot)} aria-hidden="true" />
                    {s.name}
                  </span>
                  <span className="text-[11px] font-mono text-gray-400">{s.latencyMs} ms</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5 ml-4">
                  {agentStatusMeta[s.status].label} • {s.detail}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">All Components</h2>
          <p className="text-xs text-gray-400">Click a row to inspect it above</p>
        </div>
        <AgentStatusTable agents={agents} detailed onSelect={(a) => setSelectedId(a.agentId)} />
      </Card>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

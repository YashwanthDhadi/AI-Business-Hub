import React from "react";
import { Badge } from "@/components/ui";
import { CHART_COLORS } from "@/components/charts";
import type { AiAgentStatus } from "@/types";
import { cn } from "@/lib/utils";
import { agentStatusMeta } from "@/lib/status";
import { LOCALE } from "@/lib/constants";

/** Tiny latency trend line (last 12 hours). */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / range) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("w-20 h-6", className)} role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke={CHART_COLORS.blue} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const kindLabels: Record<NonNullable<AiAgentStatus["kind"]>, string> = {
  router: "Router",
  agent: "Agent",
  input: "Input",
};

interface AgentStatusTableProps {
  agents: AiAgentStatus[];
  detailed?: boolean;
  onSelect?: (agent: AiAgentStatus) => void;
}

export function AgentStatusTable({ agents, detailed = false, onSelect }: AgentStatusTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
          <tr>
            <th className="py-3 px-4">Agent</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4 text-right">Latency</th>
            {detailed && <th className="py-3 px-4 text-right hidden lg:table-cell">p95</th>}
            <th className="py-3 px-4 text-right">Requests</th>
            <th className="py-3 px-4 text-right">Errors</th>
            <th className="py-3 px-4 text-right">Uptime</th>
            {detailed && <th className="py-3 px-4 hidden md:table-cell">12h trend</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/80 text-gray-200 font-mono">
          {agents.map((a) => {
            const meta = agentStatusMeta[a.status];
            return (
              <tr
                key={a.agentId}
                onClick={onSelect ? () => onSelect(a) : undefined}
                className={cn("transition-colors", onSelect && "cursor-pointer hover:bg-gray-800/40", a.status !== "operational" && "bg-amber-500/5")}
              >
                <td className="py-3 px-4 font-sans">
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} aria-hidden="true" />
                    <span className="font-semibold text-white whitespace-nowrap">{a.name}</span>
                    {a.kind && a.kind !== "agent" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase tracking-wider">{kindLabels[a.kind]}</span>
                    )}
                  </div>
                  {detailed && <div className="text-[11px] text-gray-500 mt-0.5 ml-4 max-w-xs truncate">{a.role}</div>}
                </td>
                <td className="py-3 px-4 font-sans">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </td>
                <td className={cn("py-3 px-4 text-right whitespace-nowrap", a.averageLatencyMs > 400 ? "text-amber-300" : "text-gray-200")}>{a.averageLatencyMs} ms</td>
                {detailed && <td className="py-3 px-4 text-right text-gray-400 hidden lg:table-cell whitespace-nowrap">{a.p95LatencyMs ?? "—"} ms</td>}
                <td className="py-3 px-4 text-right">{a.totalRequestsToday.toLocaleString(LOCALE)}</td>
                <td className="py-3 px-4 text-right whitespace-nowrap">
                  {a.errorsToday ?? "—"} <span className="text-gray-500">({a.errorRatePercent}%)</span>
                </td>
                <td className="py-3 px-4 text-right">{a.uptimePercent.toFixed(2)}%</td>
                {detailed && (
                  <td className="py-3 px-4 hidden md:table-cell">
                    {a.latencyHistory && <Sparkline values={a.latencyHistory} label={`${a.name} latency, last 12 hours`} />}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import React from "react";
import Link from "next/link";
import { Building2, CheckCircle2, IndianRupee, Users, Cpu, HeartPulse, ArrowRight, LayoutDashboard } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, PageHeader, StatCard, Badge } from "@/components/ui";
import { BarChart, LineChart, CHART_COLORS } from "@/components/charts";
import { AgentStatusTable } from "@/features/admin/components/AgentStatusTable";
import { ActivityFeed } from "@/features/admin/components/ActivityFeed";
import {
  mockPlatformHealth,
  mockAiAgentStatuses,
  mockServiceHealth,
  mockPlatformActivity,
  mockPlatformMonthly,
  mockDailyAiRequests,
  mockTenants,
  planLabels,
} from "@/data";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { agentStatusMeta, tenantStatusMeta } from "@/lib/status";

const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

export default function AdminOverviewPage() {
  const h = mockPlatformHealth;
  const degraded = mockAiAgentStatuses.filter((a) => a.status !== "operational");
  const prevMrr = mockPlatformMonthly[mockPlatformMonthly.length - 2].mrr;
  const mrrGrowth = Math.round(((h.totalRevenueMtd - prevMrr) / prevMrr) * 100);
  const recentTenants = [...mockTenants].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader icon={LayoutDashboard} title="Platform Overview" description="SaaS-wide health, revenue and AI usage across all tenants." />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        <StatCard label="Total Businesses" value={h.totalBusinesses} icon={Building2} tone="indigo" hint="+4 this month" />
        <StatCard label="Active Businesses" value={h.activeBusinesses} icon={CheckCircle2} tone="emerald" hint={`${Math.round((h.activeBusinesses / h.totalBusinesses) * 100)}% of tenants`} />
        <StatCard label="Platform Revenue" value={formatCurrency(h.totalRevenueMtd).replace(".00", "")} icon={IndianRupee} tone="amber" hint={`MTD • +${mrrGrowth}% MoM`} />
        <StatCard label="Total Users" value={h.totalUsers} icon={Users} tone="purple" hint="Owners, staff & admins" />
        <StatCard label="AI Requests" value={compact(h.totalAiRequestsToday)} icon={Cpu} tone="blue" hint="Today, all tenants" />
        <StatCard
          label="System Health"
          value={`${h.platformUptimePercent}%`}
          icon={HeartPulse}
          tone={degraded.length ? "amber" : "emerald"}
          hint={degraded.length ? `${degraded.length} agent degraded` : "30-day uptime"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Platform Revenue</CardTitle>
            <CardDescription>Monthly recurring revenue, last 6 months</CardDescription>
          </CardHeader>
          <LineChart
            title="Monthly recurring revenue"
            data={mockPlatformMonthly.map((m) => ({ label: m.month, values: { mrr: m.mrr } }))}
            series={[{ key: "mrr", label: "MRR", color: CHART_COLORS.blue }]}
            format={(v) => formatCurrency(v).replace(".00", "")}
            axisFormat={(v) => `$${compact(v)}`}
            area
          />
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>AI Requests</CardTitle>
            <CardDescription>Requests per day across all tenants, last 7 days</CardDescription>
          </CardHeader>
          <BarChart
            title="AI requests per day"
            data={mockDailyAiRequests.map((d) => ({ label: d.day, values: { requests: d.requests } }))}
            series={[{ key: "requests", label: "Requests", color: CHART_COLORS.blue }]}
            axisFormat={compact}
          />
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-4 sm:p-5 flex items-center justify-between gap-3 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Agent Status</h2>
            <p className="text-xs text-gray-400">Today&apos;s latency, volume and errors per agent</p>
          </div>
          <Link href="/admin/ai-system" className="text-xs text-amber-300 hover:text-amber-200 inline-flex items-center gap-1 whitespace-nowrap">
            AI System <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <AgentStatusTable agents={mockAiAgentStatuses} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Infrastructure</CardTitle>
            <CardDescription>Core platform services</CardDescription>
          </CardHeader>
          <ul className="space-y-2">
            {mockServiceHealth.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={cn("w-2 h-2 rounded-full flex-shrink-0", agentStatusMeta[s.status].dot)} aria-hidden="true" />
                  <span className="text-gray-200 truncate">{s.name}</span>
                </span>
                <span className={cn("font-mono flex-shrink-0", s.status === "operational" ? "text-gray-400" : "text-amber-300")}>{s.latencyMs} ms</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle>Newest Businesses</CardTitle>
              <CardDescription>Recent sign-ups</CardDescription>
            </div>
            <Link href="/admin/businesses" className="text-xs text-amber-300 hover:text-amber-200">
              View all
            </Link>
          </CardHeader>
          <ul className="space-y-2.5">
            {recentTenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                  <div className="text-[10px] text-gray-500 font-mono">
                    {planLabels[t.plan]} • {formatDate(t.createdAt, { month: "short", day: "numeric" })}
                  </div>
                </div>
                <Badge variant={tenantStatusMeta[t.status].variant}>{tenantStatusMeta[t.status].label}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Platform events</CardDescription>
            </div>
            <Link href="/admin/activity" className="text-xs text-amber-300 hover:text-amber-200">
              View log
            </Link>
          </CardHeader>
          <ActivityFeed events={mockPlatformActivity.slice(0, 3)} />
        </Card>
      </div>
    </div>
  );
}

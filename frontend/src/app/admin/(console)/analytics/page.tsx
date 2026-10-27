"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, PageHeader } from "@/components/ui";
import { BarChart, LineChart, CHART_COLORS } from "@/components/charts";
import { mockPlatformMonthly, mockTenants, planLabels, planPrices } from "@/data";
import type { PlatformTenant } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { LOCALE } from "@/lib/constants";

const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

function MeterList({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="space-y-1">
          <div className="flex justify-between gap-2 text-xs">
            <span className="text-gray-200 truncate">{r.label}</span>
            <span className="text-gray-400 font-mono flex-shrink-0">
              <span className="text-white">{format(r.value)}</span>
              {r.sub && ` • ${r.sub}`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: CHART_COLORS.blue }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminAnalyticsPage() {
  const plans = (Object.keys(planLabels) as PlatformTenant["plan"][]).map((p) => {
    const count = mockTenants.filter((t) => t.plan === p && t.status !== "suspended").length;
    return { label: planLabels[p], value: count, sub: `${formatCurrency(count * planPrices[p]).replace(".00", "")}/mo` };
  });
  const topUsage = [...mockTenants]
    .sort((a, b) => b.aiRequestsCount - a.aiRequestsCount)
    .slice(0, 5)
    .map((t) => ({ label: t.name, value: t.aiRequestsCount, sub: planLabels[t.plan] }));
  const industries = Object.entries(
    mockTenants.reduce<Record<string, number>>((acc, t) => {
      const k = t.industry ?? "Other";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const first = mockPlatformMonthly[0];
  const last = mockPlatformMonthly[mockPlatformMonthly.length - 1];

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} title="Analytics" description="Growth, revenue and AI usage trends across the platform." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "MRR growth (6 mo)", value: `+${Math.round(((last.mrr - first.mrr) / first.mrr) * 100)}%` },
          { label: "New businesses (6 mo)", value: `+${last.businesses - first.businesses}` },
          { label: "AI requests (Sep)", value: compact(last.aiRequests) },
          { label: "Avg revenue / business", value: formatCurrency(Math.round(last.mrr / last.businesses)).replace(".00", "") },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <span className="text-xs text-gray-400">{k.label}</span>
            <div className="text-xl sm:text-2xl font-bold text-white mt-1 font-mono">{k.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Monthly Recurring Revenue</CardTitle>
            <CardDescription>Apr – Sep 2026</CardDescription>
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
            <CardTitle>Businesses on Platform</CardTitle>
            <CardDescription>Total tenants at month end</CardDescription>
          </CardHeader>
          <BarChart
            title="Businesses on platform by month"
            data={mockPlatformMonthly.map((m) => ({ label: m.month, values: { businesses: m.businesses } }))}
            series={[{ key: "businesses", label: "Businesses", color: CHART_COLORS.blue }]}
          />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>AI Requests per Month</CardTitle>
            <CardDescription>All tenants, all agents</CardDescription>
          </CardHeader>
          <BarChart
            title="AI requests per month"
            data={mockPlatformMonthly.map((m) => ({ label: m.month, values: { requests: m.aiRequests } }))}
            series={[{ key: "requests", label: "Requests", color: CHART_COLORS.blue }]}
            axisFormat={compact}
            heightClass="h-40"
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Plan Mix</CardTitle>
            <CardDescription>Active and trial tenants in this sample</CardDescription>
          </CardHeader>
          <MeterList rows={plans} format={(v) => String(v)} />
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Top AI Usage</CardTitle>
            <CardDescription>Requests this month</CardDescription>
          </CardHeader>
          <MeterList rows={topUsage} format={(v) => v.toLocaleString(LOCALE)} />
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Industries</CardTitle>
            <CardDescription>Businesses by type</CardDescription>
          </CardHeader>
          <MeterList rows={industries} format={(v) => String(v)} />
        </Card>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  IndianRupee,
  CalendarCheck,
  UserPlus,
  MessageSquare,
  Package,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  SegmentedTabs,
  Toast,
} from "@/components/ui";
import { BarChart, LineChart, CHART_COLORS } from "@/components/charts";
import type { BusinessReport } from "@/types";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";

/**
 * SegmentedTabs is typed for string values, so the window is a string here and
 * converted once, where it is used. Keeping it a number would mean casting in
 * three places instead.
 */
type Window = "7" | "30" | "90";

/** Indian short forms on the axis: ₹90k, ₹1.2L, ₹1.5Cr. */
const compactRupees = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${Math.round(v / 1e3)}k` : `₹${v}`;

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function ReportsPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [days, setDays] = useState<Window>("30");
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const load = useCallback(async (window: Window) => {
    setLoading(true);
    try {
      setReport(await dashboardApi.report(Number(window)));
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load the report."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `load` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(days);
    // The written summary describes a particular window, so it is cleared
    // whenever the window changes rather than left describing the old one.
    setSummary(null);
  }, [configured, days, load]);

  const summarise = async () => {
    setSummarising(true);
    try {
      setSummary(await dashboardApi.summariseReport(Number(days)));
    } catch (error) {
      showToast(message(error, "Could not write a summary."), "error");
    } finally {
      setSummarising(false);
    }
  };

  const totals = report?.summary;
  const daily = report?.daily ?? [];

  const label = (day: string) => formatDate(day, { day: "numeric", month: "short" });
  const revenueData = daily.map((d) => ({ label: label(d.day), values: { collected: d.collected } }));
  const activityData = daily.map((d) => ({
    label: label(d.day),
    values: { bookings: d.bookings, conversations: d.conversations },
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Reports"
        description="What actually happened, counted by the database."
        actions={
          <SegmentedTabs<Window>
            tabs={[
              { label: "7 days", value: "7" },
              { label: "30 days", value: "30" },
              { label: "90 days", value: "90" },
            ]}
            value={days}
            onChange={setDays}
          />
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      {loading && !report ? (
        <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading the report…</p>
      ) : totals ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Collected" value={formatCurrency(totals.collected)} icon={IndianRupee} tone="emerald" hint={`over ${totals.days} days`} />
            <StatCard label="Still owed" value={formatCurrency(totals.outstanding)} icon={AlertTriangle} tone="amber" hint="unpaid invoices, all time" />
            <StatCard label="Bookings" value={formatNumber(totals.bookings)} icon={CalendarCheck} tone="indigo" hint={`${totals.completedBookings} completed, ${totals.cancelledBookings} cancelled`} />
            <StatCard label="New customers" value={formatNumber(totals.newCustomers)} icon={UserPlus} tone="purple" hint={`${totals.activeCustomers} active in total`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle>Money collected</CardTitle>
                <CardDescription>
                  Counted on the day each invoice was marked paid, in your own timezone.
                </CardDescription>
              </CardHeader>
              <BarChart
                title="Money collected per day"
                data={revenueData}
                series={[{ key: "collected", label: "Collected", color: CHART_COLORS.blue }]}
                format={(v) => formatCurrency(v)}
                axisFormat={compactRupees}
                heightClass="h-52"
              />
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle>What sells</CardTitle>
                <CardDescription>By bookings, over {totals.days} days</CardDescription>
              </CardHeader>
              <ul className="space-y-2 flex-1">
                {(report?.topServices ?? []).length === 0 && (
                  <li className="text-xs text-gray-500 py-4 text-center">No bookings in this period.</li>
                )}
                {(report?.topServices ?? []).map((s) => (
                  <li key={s.serviceName} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{s.serviceName}</div>
                      <div className="text-[11px] text-gray-400">{s.bookings} bookings</div>
                    </div>
                    <span className="text-xs font-semibold text-white">{formatCurrency(s.revenue)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Bookings and conversations</CardTitle>
              <CardDescription>How busy each day was</CardDescription>
            </CardHeader>
            <LineChart
              title="Bookings and conversations per day"
              data={activityData}
              series={[
                { key: "bookings", label: "Bookings", color: CHART_COLORS.blue },
                { key: "conversations", label: "Chats", color: CHART_COLORS.aqua },
              ]}
              heightClass="h-52"
            />
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <StatCard label="Chats" value={formatNumber(totals.conversations)} icon={MessageSquare} tone="purple" hint="Customer conversations" />
            <StatCard label="Invoices issued" value={formatNumber(totals.invoicesIssued)} icon={IndianRupee} tone="blue" hint={`over ${totals.days} days`} />
            <StatCard label="Stock needing attention" value={formatNumber(totals.lowStockItems)} icon={Package} tone="amber" hint="Low or out of stock" />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>In a sentence</CardTitle>
              <CardDescription>
                The numbers above are worked out by the database. This asks the assistant to describe them — it never
                calculates anything itself.
              </CardDescription>
            </CardHeader>
            {summary ? (
              <p className="text-sm text-gray-200 whitespace-pre-line">{summary}</p>
            ) : (
              <p className="text-xs text-gray-500">Not written yet. It costs one model call, so it only runs when you ask.</p>
            )}
            <div className="flex justify-end pt-3">
              <Button variant="outline" size="sm" disabled={summarising} onClick={() => void summarise()}>
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                {summarising ? "Writing…" : summary ? "Write it again" : "Explain these numbers"}
              </Button>
            </div>
          </Card>
        </>
      ) : null}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

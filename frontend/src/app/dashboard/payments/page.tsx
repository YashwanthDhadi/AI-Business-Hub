"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Wallet, Clock, AlertTriangle, CheckCircle2, Send, BadgeInfo } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  PageHeader,
  StatCard,
  SearchInput,
  Select,
  SegmentedTabs,
  Toast,
} from "@/components/ui";
import { BarChart, CHART_COLORS } from "@/components/charts";
import { InvoiceTable } from "@/features/payments/components/InvoiceTable";
import { InvoiceDetailModal } from "@/features/payments/components/InvoiceDetailModal";
import { NewInvoiceModal } from "@/features/payments/components/NewInvoiceModal";
import { PaymentSettingsCard } from "@/features/payments/components/PaymentSettingsCard";
import { paymentMethodLabels, PaymentMethod } from "@/features/payments/constants";
import type { CustomerSummary, PaymentInvoice, PaymentSettings, PaymentStatus } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type CatalogService, type InvoiceResult, type NewInvoice } from "@/lib/api/dashboard";

type StatusFilter = PaymentStatus | "all";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis labels the Indian way: ₹90k, ₹1.2L (lakh), ₹1.5Cr (crore). */
const compactRupees = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${Math.round(v / 1e3)}k` : `₹${v}`;

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function PaymentsPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [invoices, setInvoices] = useState<PaymentInvoice[]>([]);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [business, setBusiness] = useState({ name: "", today: "" });
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.invoices();
      setInvoices(data.invoices);
      setSettings(data.settings);
      setBusiness(data.business);
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load invoices."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  const replace = useCallback((updated: PaymentInvoice) => {
    setInvoices((prev) => {
      const exists = prev.some((i) => i.id === updated.id);
      return exists ? prev.map((i) => (i.id === updated.id ? updated : i)) : [updated, ...prev];
    });
  }, []);

  /** Run a payment action, update the list, toast, and re-throw so the modal keeps its state. */
  const run = useCallback(
    async (action: () => Promise<InvoiceResult>, done: (r: InvoiceResult) => string) => {
      try {
        const result = await action();
        replace(result.invoice);
        showToast(done(result));
      } catch (error) {
        showToast(message(error, "That did not work."), "error");
        void refresh();
        throw error;
      }
    },
    [refresh, replace, showToast],
  );

  const told = (r: InvoiceResult, yes: string, no: string) => (r.customer_notified ? yes : no);

  const handleMarkPaid = (id: string, method: PaymentMethod, reference: string) =>
    run(
      () => dashboardApi.markInvoicePaid(id, method, reference),
      (r) => told(r, `${r.invoice.invoiceNumber} marked paid. A receipt is in their chat.`, `${r.invoice.invoiceNumber} marked paid.`),
    );

  const handleCancel = (id: string, reason: string) =>
    run(
      () => dashboardApi.cancelInvoice(id, reason),
      (r) => told(r, `${r.invoice.invoiceNumber} cancelled. They have been told in their chat.`, `${r.invoice.invoiceNumber} cancelled.`),
    );

  const handleRefund = (id: string, note: string) =>
    run(() => dashboardApi.refundInvoice(id, note), (r) => `Refund recorded on ${r.invoice.invoiceNumber}.`);

  const handleRemind = (inv: PaymentInvoice) =>
    run(() => dashboardApi.remindInvoice(inv.id), () => `Reminder posted in ${inv.customerName}'s chat.`);

  const handleCopyLink = (inv: PaymentInvoice) => {
    if (!inv.payUrl) return;
    navigator.clipboard
      .writeText(inv.payUrl)
      .then(() => showToast("Payment link copied. Anyone with it can see and pay this one invoice.", "info"))
      .catch(() => showToast(inv.payUrl ?? "", "info"));
  };

  /** Loaded when the owner opens the form, in the click - not on every page visit. */
  const openNewInvoice = async () => {
    setIsNewOpen(true);
    try {
      const [people, catalog] = await Promise.all([dashboardApi.customers(), dashboardApi.paymentCatalog()]);
      setCustomers(people);
      setServices(catalog);
    } catch (error) {
      showToast(message(error, "Could not load customers and services."), "error");
    }
  };

  const handleCreate = async (input: NewInvoice) => {
    // Errors (409 already billed, 400 due date...) go back to the form, which shows them.
    const result = await dashboardApi.createInvoice(input);
    replace(result.invoice);
    showToast(
      told(
        result,
        `${result.invoice.invoiceNumber} created and sent to ${result.invoice.customerName}'s chat.`,
        `${result.invoice.invoiceNumber} created. Share its payment link yourself.`,
      ),
    );
  };

  const handleSaveSettings = async (patch: { upi_id: string; payee_name: string; invoice_prefix: string; due_days: number }) => {
    try {
      const saved = await dashboardApi.updatePaymentSettings(patch);
      setSettings(saved);
      showToast(saved.upiReady ? "Saved. New pay pages show your UPI QR code." : "Saved. Add a UPI ID to take UPI payments.");
      void refresh();
    } catch (error) {
      throw new Error(message(error, "Could not save the settings."));
    }
  };

  // ---- numbers ---------------------------------------------------------------
  const sumBy = (status: PaymentStatus) => invoices.filter((i) => i.status === status).reduce((a, i) => a + i.amount, 0);
  const collected = sumBy("paid");
  const pending = sumBy("pending");
  const overdue = sumBy("overdue");
  const paidCount = invoices.filter((i) => i.status === "paid").length;
  const billable = invoices.filter((i) => i.status !== "cancelled").length || 1;

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: invoices.length, paid: 0, pending: 0, overdue: 0, refunded: 0, cancelled: 0 };
    for (const i of invoices) c[i.status] += 1;
    return c;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => {
        const matchesSearch =
          !q ||
          i.customerName.toLowerCase().includes(q) ||
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.items.some((it) => it.description.toLowerCase().includes(q));
        const matchesStatus = statusFilter === "all" || i.status === statusFilter;
        const matchesMethod = methodFilter === "all" || (methodFilter === "none" ? !i.paymentMethod : i.paymentMethod === methodFilter);
        return matchesSearch && matchesStatus && matchesMethod;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices, search, statusFilter, methodFilter]);

  const outstanding = invoices
    .filter((i) => i.status === "pending" || i.status === "overdue")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const claims = outstanding.filter((i) => i.customerReportedAt);

  const methodTotals = (Object.keys(paymentMethodLabels) as PaymentMethod[])
    .map((m) => ({
      method: m,
      total: invoices.filter((i) => i.status === "paid" && i.paymentMethod === m).reduce((a, i) => a + i.amount, 0),
    }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);

  /** The last six months, by the month the money was marked paid (in IST). */
  const revenueData = useMemo(() => {
    if (!business.today) return [];
    const [year, month] = business.today.split("-").map(Number);
    return Array.from({ length: 6 }, (_, index) => {
      const offset = 5 - index;
      const m = (month - 1 - offset + 12 * 2) % 12;
      const y = year - (month - 1 - offset < 0 ? 1 : 0);
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const revenue = invoices
        .filter((i) => i.status === "paid" && (i.paidDate ?? "").startsWith(key))
        .reduce((a, i) => a + i.amount, 0);
      return { label: MONTHS[m], values: { revenue } };
    });
  }, [invoices, business.today]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CreditCard}
        title="Payments"
        description="Bill customers, collect by UPI with no fees, and see what has come in."
        actions={
          <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => void openNewInvoice()} disabled={!configured}>
            <Plus className="w-3.5 h-3.5" /> New Invoice
          </Button>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      {settings && !settings.upiReady && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          No UPI ID yet. Invoices still work, but their pay page can only say &ldquo;pay at the front desk&rdquo;. Add your UPI ID in Payment Settings below.
        </div>
      )}

      {claims.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <BadgeInfo className="w-4 h-4" /> {claims.length} {claims.length === 1 ? "customer says they have" : "customers say they have"} paid
          </div>
          <p className="text-xs text-amber-200/80">Check your UPI app or bank statement, then open each one and mark it paid. Nothing is paid until you do.</p>
          <div className="flex flex-wrap gap-2">
            {claims.map((inv) => (
              <Button key={inv.id} variant="outline" size="sm" onClick={() => setSelectedId(inv.id)}>
                {inv.customerName} • {formatCurrency(inv.amount)}
                {inv.customerReference ? ` • ${inv.customerReference}` : ""}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Collected" value={formatCurrency(collected)} icon={Wallet} tone="emerald" hint={`${paidCount} paid invoices`} onClick={() => setStatusFilter("paid")} active={statusFilter === "paid"} />
        <StatCard label="Pending" value={formatCurrency(pending)} icon={Clock} tone="amber" hint={`${counts.pending} awaiting payment`} onClick={() => setStatusFilter("pending")} active={statusFilter === "pending"} />
        <StatCard label="Overdue" value={formatCurrency(overdue)} icon={AlertTriangle} tone="rose" hint={`${counts.overdue} past due date`} onClick={() => setStatusFilter("overdue")} active={statusFilter === "overdue"} />
        <StatCard label="Collection Rate" value={`${Math.round((paidCount / billable) * 100)}%`} icon={CheckCircle2} tone="indigo" hint="Paid vs. billed (not cancelled)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Money In</CardTitle>
            <CardDescription>Invoices marked paid, by month, over the last six months.</CardDescription>
          </CardHeader>
          <BarChart
            title="Money marked paid each month"
            data={revenueData}
            series={[{ key: "revenue", label: "Collected", color: CHART_COLORS.blue }]}
            format={(v) => formatCurrency(v)}
            axisFormat={compactRupees}
            heightClass="h-52"
          />
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle>Needs Follow-up</CardTitle>
            <CardDescription>{formatCurrency(pending + overdue)} still to collect</CardDescription>
          </CardHeader>
          <ul className="space-y-2 flex-1">
            {outstanding.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">Everyone is paid up.</li>}
            {outstanding.slice(0, 5).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <button type="button" onClick={() => setSelectedId(inv.id)} className="min-w-0 text-left cursor-pointer">
                  <div className="text-xs font-semibold text-white truncate hover:text-indigo-300">{inv.customerName}</div>
                  <div className={inv.status === "overdue" ? "text-[11px] text-rose-300" : "text-[11px] text-gray-400"}>
                    {formatCurrency(inv.amount)} • {inv.status === "overdue" ? "Overdue since" : "Due"} {formatDate(inv.dueDate, { month: "short", day: "numeric" })}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inv.hasChat === false}
                  title={inv.hasChat === false ? "They have never chatted with you - call them instead" : "Post a reminder in their chat"}
                  onClick={() => void handleRemind(inv).catch(() => undefined)}
                  aria-label={`Send reminder to ${inv.customerName}`}
                >
                  <Send className="w-3.5 h-3.5 text-indigo-400" />
                </Button>
              </li>
            ))}
          </ul>
          {methodTotals.length > 0 && (
            <div className="pt-3 mt-3 border-t border-gray-800/80 space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Collected by method</span>
              {methodTotals.map((m) => (
                <div key={m.method} className="space-y-1">
                  <div className="flex justify-between text-[11px] text-gray-300">
                    <span>{paymentMethodLabels[m.method]}</span>
                    <span className="font-mono text-white">{formatCurrency(m.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(m.total / (collected || 1)) * 100}%`, backgroundColor: CHART_COLORS.blue }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <section className="space-y-3" aria-label="Invoices">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedTabs<StatusFilter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "Paid", value: "paid", count: counts.paid },
              { label: "Pending", value: "pending", count: counts.pending },
              { label: "Overdue", value: "overdue", count: counts.overdue },
              { label: "Refunded", value: "refunded", count: counts.refunded },
              { label: "Cancelled", value: "cancelled", count: counts.cancelled },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="self-start"
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search customer or invoice #..." className="w-full sm:w-64" />
            <Select
              aria-label="Filter by payment method"
              value={methodFilter}
              onChange={setMethodFilter}
              options={[
                { label: "All methods", value: "all" },
                ...(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((m) => ({ label: paymentMethodLabels[m], value: m })),
                { label: "Not paid yet", value: "none" },
              ]}
              wrapperClassName="w-full sm:w-44"
            />
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading invoices…</p>
        ) : (
          <InvoiceTable invoices={filtered} onSelect={(i) => setSelectedId(i.id)} onRemind={(i) => void handleRemind(i).catch(() => undefined)} />
        )}
      </section>

      {settings && <PaymentSettingsCard key={`${settings.upiId}-${settings.invoicePrefix}-${settings.dueDays}`} settings={settings} onSave={handleSaveSettings} />}

      <InvoiceDetailModal
        invoice={selected}
        businessName={business.name}
        onClose={() => setSelectedId(null)}
        onMarkPaid={handleMarkPaid}
        onCancel={handleCancel}
        onRefund={handleRefund}
        onRemind={handleRemind}
        onCopyLink={handleCopyLink}
      />
      <NewInvoiceModal
        key={isNewOpen ? "open" : "closed"}
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onCreate={handleCreate}
        customers={customers}
        services={services}
        dueDays={settings?.dueDays ?? 7}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

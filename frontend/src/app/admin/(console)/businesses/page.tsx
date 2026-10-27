"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink, Ban, RotateCcw, CheckCircle2, Clock3, PauseCircle } from "lucide-react";
import { Badge, Button, DetailList, EmptyState, Modal, PageHeader, SearchInput, Select, SegmentedTabs, StatCard, Toast } from "@/components/ui";
import { mockTenants, planLabels, planPrices } from "@/data";
import type { PlatformTenant } from "@/types";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { tenantStatusMeta } from "@/lib/status";
import { useToast } from "@/hooks/useToast";
import { LOCALE } from "@/lib/constants";

type StatusFilter = PlatformTenant["status"] | "all";

function UsageMeter({ tenant }: { tenant: PlatformTenant }) {
  const limit = tenant.aiRequestLimit ?? 1;
  const pct = Math.min(100, Math.round((tenant.aiRequestsCount / limit) * 100));
  return (
    <div className="min-w-28">
      <div className="flex justify-between text-[10px] font-mono text-gray-400">
        <span>{tenant.aiRequestsCount.toLocaleString(LOCALE)}</span>
        <span className={pct >= 90 ? "text-rose-300" : pct >= 75 ? "text-amber-300" : ""}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden mt-1">
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-400" : "bg-blue-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminBusinessesPage() {
  const [tenants, setTenants] = useState<PlatformTenant[]>(mockTenants);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [plan, setPlan] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: tenants.length, active: 0, trial: 0, suspended: 0 };
    tenants.forEach((t) => (c[t.status] += 1));
    return c;
  }, [tenants]);

  const filtered = tenants
    .filter((t) => {
      const q = search.trim().toLowerCase();
      return (
        (!q || t.name.toLowerCase().includes(q) || t.ownerName.toLowerCase().includes(q) || t.slug.includes(q) || t.ownerEmail.includes(q)) &&
        (status === "all" || t.status === status) &&
        (plan === "all" || t.plan === plan)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const selected = tenants.find((t) => t.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<PlatformTenant>) => setTenants((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const subscriptionRevenue = tenants.filter((t) => t.status === "active").reduce((a, t) => a + planPrices[t.plan], 0);

  return (
    <div className="space-y-6">
      <PageHeader icon={Building2} title="Businesses" description="Multi-tenant management: every business on the platform, its plan and usage." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Active" value={counts.active} icon={CheckCircle2} tone="emerald" onClick={() => setStatus("active")} active={status === "active"} hint="Paying tenants" />
        <StatCard label="On Trial" value={counts.trial} icon={Clock3} tone="indigo" onClick={() => setStatus("trial")} active={status === "trial"} hint="14-day trial" />
        <StatCard label="Suspended" value={counts.suspended} icon={PauseCircle} tone="rose" onClick={() => setStatus("suspended")} active={status === "suspended"} hint="Billing or policy" />
        <StatCard label="Subscriptions (shown)" value={formatCurrency(subscriptionRevenue).replace(".00", "")} icon={Building2} tone="amber" hint="Monthly, active tenants" />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs<StatusFilter>
          tabs={[
            { label: "All", value: "all", count: counts.all },
            { label: "Active", value: "active", count: counts.active },
            { label: "Trial", value: "trial", count: counts.trial },
            { label: "Suspended", value: "suspended", count: counts.suspended },
          ]}
          value={status}
          onChange={setStatus}
          className="self-start"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search business, owner or slug..." className="w-full sm:w-64" />
          <Select
            aria-label="Filter by plan"
            value={plan}
            onChange={setPlan}
            options={[{ label: "All plans", value: "all" }, ...(Object.keys(planLabels) as PlatformTenant["plan"][]).map((p) => ({ label: planLabels[p], value: p }))]}
            wrapperClassName="w-full sm:w-36"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No businesses found" description="Try a different search or filter." />
      ) : (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
          <ul className="md:hidden divide-y divide-gray-800/80">
            {filtered.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setSelectedId(t.id)} className="w-full text-left p-4 space-y-2 hover:bg-gray-800/40 cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {t.ownerName} • {planLabels[t.plan]}
                      </div>
                    </div>
                    <Badge variant={tenantStatusMeta[t.status].variant}>{tenantStatusMeta[t.status].label}</Badge>
                  </div>
                  <UsageMeter tenant={t} />
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Business</th>
                  <th className="py-3 px-4">Owner</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4">Plan</th>
                  <th className="py-3 px-4">AI Usage (month)</th>
                  <th className="py-3 px-4 text-right hidden xl:table-cell">Customers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80 text-gray-200">
                {filtered.map((t) => (
                  <tr key={t.id} onClick={() => setSelectedId(t.id)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white group-hover:text-amber-200 transition-colors">{t.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        /{t.slug} • {t.industry}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-gray-200">{t.ownerName}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{t.ownerEmail}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={tenantStatusMeta[t.status].variant}>{tenantStatusMeta[t.status].label}</Badge>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-gray-400 font-mono">{formatDate(t.createdAt, { year: "numeric", month: "2-digit", day: "2-digit" })}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-gray-200">{planLabels[t.plan]}</span>
                      <span className="block text-[10px] text-gray-500 font-mono">${planPrices[t.plan]}/mo</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <UsageMeter tenant={t} />
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono hidden xl:table-cell">{t.totalCustomersCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <Modal isOpen onClose={() => setSelectedId(null)} title={selected.name} description={`Tenant ID ${selected.id}`} maxWidth="lg">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tenantStatusMeta[selected.status].variant}>{tenantStatusMeta[selected.status].label}</Badge>
              <Badge variant="neutral">{planLabels[selected.plan]} plan</Badge>
              {selected.industry && <Badge variant="neutral">{selected.industry}</Badge>}
            </div>
            <DetailList
              items={[
                { label: "Owner", value: `${selected.ownerName} (${selected.ownerEmail})` },
                { label: "Chat link", value: <span className="font-mono text-xs">/chat/{selected.slug}</span> },
                { label: "Created", value: formatDate(selected.createdAt) },
                { label: "Last active", value: selected.lastActiveAt ? formatDate(selected.lastActiveAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—" },
                { label: "Staff accounts", value: selected.staffCount ?? "—" },
                { label: "Customers", value: selected.totalCustomersCount },
                { label: "Business revenue (month)", value: formatCurrency(selected.monthlyRevenue) },
                { label: "AI requests (month)", value: `${selected.aiRequestsCount.toLocaleString(LOCALE)} / ${(selected.aiRequestLimit ?? 0).toLocaleString(LOCALE)}` },
              ]}
            />
            <Select
              label="Plan"
              value={selected.plan}
              onChange={(p) => {
                update(selected.id, { plan: p as PlatformTenant["plan"], aiRequestLimit: p === "enterprise" ? 50000 : p === "growth" ? 10000 : 2000 });
                showToast(`${selected.name} moved to ${planLabels[p as PlatformTenant["plan"]]}.`);
              }}
              options={(Object.keys(planLabels) as PlatformTenant["plan"][]).map((p) => ({ label: `${planLabels[p]} ($${planPrices[p]}/mo)`, value: p }))}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-gray-800">
              {selected.status === "suspended" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    update(selected.id, { status: "active" });
                    showToast(`${selected.name} reactivated.`);
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5 text-emerald-400" /> Reactivate
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    update(selected.id, { status: "suspended" });
                    showToast(`${selected.name} suspended. Their customer chat is now offline.`, "info");
                  }}
                >
                  <Ban className="w-3.5 h-3.5" /> Suspend
                </Button>
              )}
              <div className="flex gap-2">
                {selected.status !== "suspended" && (
                  <Link href={`/chat/${selected.slug}`} target="_blank">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="w-3.5 h-3.5" /> Open Chat
                    </Button>
                  </Link>
                )}
                {selected.slug === "fitzone" && (
                  <Link href="/dashboard">
                    <Button size="sm">View Dashboard</Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

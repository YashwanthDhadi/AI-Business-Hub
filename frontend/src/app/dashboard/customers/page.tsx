"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Users, UserPlus, UserCheck, Sparkles, IndianRupee } from "lucide-react";
import { Button, PageHeader, StatCard, SearchInput, Select, SegmentedTabs, Toast } from "@/components/ui";
import { CustomerTable } from "@/features/customers/components/CustomerTable";
import { CustomerDetailModal } from "@/features/customers/components/CustomerDetailModal";
import { AddCustomerModal } from "@/features/customers/components/AddCustomerModal";
import type { Booking, CustomerNote, CustomerSummary, MarketingConsent, PaymentInvoice } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type CustomerPatch, type NewCustomer } from "@/lib/api/dashboard";

type StatusFilter = CustomerSummary["status"] | "all";
type SortKey = "name" | "spend" | "recent" | "bookings";

interface Profile {
  customerId: string;
  bookings: Booking[];
  notes: CustomerNote[];
  invoices: PaymentInvoice[];
  invoicesAvailable: boolean;
}

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function CustomersPage() {
  // LIVE_BUSINESS_ID is a build-time constant, so "not configured" is known up front.
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setCustomers(await dashboardApi.customers());
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load customers."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously
    // here. Thirty seconds: customers change far less often than bookings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  /** Replace one customer in the list with a fresher copy from the API. */
  const replace = useCallback((updated: CustomerSummary) => {
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  /** Open a profile. Loads here, in the click, rather than in an effect. */
  const openCustomer = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setProfile(null);
      try {
        const detail = await dashboardApi.customer(id);
        replace(detail.customer);
        setProfile({
          customerId: id,
          bookings: detail.bookings,
          notes: detail.notes,
          invoices: detail.invoices,
          invoicesAvailable: detail.invoicesAvailable,
        });
      } catch (error) {
        showToast(message(error, "Could not load this customer."), "error");
      }
    },
    [replace, showToast],
  );

  const update = useCallback(
    async (id: string, patch: CustomerPatch, done: string) => {
      try {
        replace(await dashboardApi.updateCustomer(id, patch));
        showToast(done);
      } catch (error) {
        showToast(message(error, "Could not save that change."), "error");
        throw error;
      }
    },
    [replace, showToast],
  );

  const handleSaveNotes = useCallback(
    (id: string, notes: string) => update(id, { notes }, "Notes saved."),
    [update],
  );

  const handleSetConsent = useCallback(
    (id: string, consent: MarketingConsent) =>
      update(
        id,
        { marketing_consent: consent },
        consent === "opted_in" ? "Recorded: they want offers." : "Consent updated.",
      ).catch(() => undefined),
    [update],
  );

  const handleAdd = useCallback(
    async (input: NewCustomer) => {
      // Errors (e.g. 409 duplicate phone) propagate to the form, which shows them.
      const created = await dashboardApi.createCustomer(input);
      setCustomers((prev) => [created, ...prev]);
      showToast(`${created.name} added.`);
    },
    [showToast],
  );

  const allTags = useMemo(() => Array.from(new Set(customers.flatMap((c) => c.tags))).sort(), [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter((c) => {
      const matchesSearch =
        !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesTag = tagFilter === "all" || c.tags.includes(tagFilter);
      return matchesSearch && matchesStatus && matchesTag;
    });
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "spend":
          return b.totalSpend - a.totalSpend;
        case "bookings":
          return b.bookingsCount - a.bookingsCount;
        default:
          // Most recent visit first; people who never visited sort by when we last heard from them.
          return (b.lastVisit ?? b.lastSeenAt ?? "").localeCompare(a.lastVisit ?? a.lastSeenAt ?? "");
      }
    });
  }, [customers, search, statusFilter, tagFilter, sortKey]);

  const counts = {
    all: customers.length,
    active: customers.filter((c) => c.status === "active").length,
    lead: customers.filter((c) => c.status === "lead").length,
    inactive: customers.filter((c) => c.status === "inactive").length,
  };
  const leadsFromChat = customers.filter((c) => c.status === "lead" && c.source === "chat").length;
  const totalSpend = customers.reduce((a, c) => a + c.totalSpend, 0);
  const payingCustomers = customers.filter((c) => c.totalSpend > 0).length || 1;

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const current = profile && profile.customerId === selectedId ? profile : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Customers"
        description="Your client directory: contact details, visits, and what the chat assistant passed on."
        actions={
          <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => setIsAddOpen(true)} disabled={!configured}>
            <UserPlus className="w-3.5 h-3.5" />
            Add Customer
          </Button>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Customers" value={counts.all} icon={Users} tone="indigo" hint="All profiles" />
        <StatCard label="Active Members" value={counts.active} icon={UserCheck} tone="emerald" hint="Visited or booked in 60 days" />
        <StatCard label="New Leads" value={counts.lead} icon={Sparkles} tone="purple" hint={`${leadsFromChat} came from customer chat`} />
        <StatCard
          label="Avg. Spend"
          value={formatCurrency(Math.round(totalSpend / payingCustomers))}
          icon={IndianRupee}
          tone="amber"
          hint={`${formatCurrency(totalSpend)} from completed bookings`}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedTabs<StatusFilter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "Active", value: "active", count: counts.active },
              { label: "Leads", value: "lead", count: counts.lead },
              { label: "Inactive", value: "inactive", count: counts.inactive },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="self-start"
          />
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or phone..." className="w-full sm:w-64" />
            <Select
              aria-label="Filter by tag"
              value={tagFilter}
              onChange={setTagFilter}
              options={[{ label: "All tags", value: "all" }, ...allTags.map((t) => ({ label: t, value: t }))]}
              wrapperClassName="w-[calc(50%-4px)] sm:w-40"
            />
            <Select
              aria-label="Sort customers"
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={[
                { label: "Recent visit", value: "recent" },
                { label: "Highest spend", value: "spend" },
                { label: "Most bookings", value: "bookings" },
                { label: "Name A–Z", value: "name" },
              ]}
              wrapperClassName="w-[calc(50%-4px)] sm:w-40"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading customers…</p>
        ) : (
          <CustomerTable customers={filtered} onSelect={(c) => void openCustomer(c.id)} />
        )}
      </div>

      <CustomerDetailModal
        customer={selected}
        bookings={current?.bookings ?? []}
        invoices={current?.invoices ?? []}
        invoicesAvailable={current?.invoicesAvailable ?? false}
        notes={current?.notes ?? []}
        loading={selected !== null && current === null}
        onClose={() => setSelectedId(null)}
        onSaveNotes={handleSaveNotes}
        onSetConsent={handleSetConsent}
      />

      <AddCustomerModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onAdd={handleAdd} />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

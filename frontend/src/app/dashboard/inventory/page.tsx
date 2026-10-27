"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Plus, AlertTriangle, PackageX, Boxes, IndianRupee, History } from "lucide-react";
import { Button, PageHeader, StatCard, SearchInput, Select, SegmentedTabs, Toast } from "@/components/ui";
import { InventoryTable } from "@/features/inventory/components/InventoryTable";
import { ProductDetailModal } from "@/features/inventory/components/ProductDetailModal";
import { ProductFormModal } from "@/features/inventory/components/ProductFormModal";
import { StockLedger } from "@/features/inventory/components/StockLedger";
import type { InventoryItem, StockMovement, StockReason } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID, type NewInventoryItem } from "@/lib/api/dashboard";

type StockFilter = InventoryItem["status"] | "all";

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

/** A key unique to one click, so a double tap moves stock once, not twice. */
function newKey(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function InventoryPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stockValue, setStockValue] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; item: InventoryItem | null; key: number }>({
    open: false,
    item: null,
    key: 0,
  });
  const [ledger, setLedger] = useState<StockMovement[] | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.inventory();
      setItems(data.items);
      setStockValue(data.stockValue);
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load inventory."));
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

  const replace = useCallback((updated: InventoryItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === updated.id);
      return exists ? prev.map((i) => (i.id === updated.id ? updated : i)) : [updated, ...prev];
    });
  }, []);

  /**
   * Add or remove stock. The database refuses anything below zero, so a 409
   * here means "not enough stock" and the message says which item and how many.
   */
  const adjustStock = useCallback(
    async (id: string, delta: number, reason: StockReason = "restock") => {
      try {
        const updated = await dashboardApi.adjustStock(id, delta, reason, "", newKey());
        replace(updated);
        showToast(
          delta > 0
            ? `Added ${delta} to ${updated.name}. Now ${updated.quantity}.`
            : `Removed ${Math.abs(delta)} from ${updated.name}. Now ${updated.quantity}.`,
        );
      } catch (error) {
        showToast(message(error, "Could not change the stock."), "error");
        void refresh();
      }
    },
    [refresh, replace, showToast],
  );

  const saveProduct = useCallback(
    async (input: NewInventoryItem, existing: InventoryItem | null) => {
      // Errors reach the form, which shows them next to the fields.
      const saved = existing
        ? await dashboardApi.updateInventoryItem(existing.id, input)
        : await dashboardApi.createInventoryItem(input);
      replace(saved);
      showToast(`${saved.name} saved.`);
      void refresh();
    },
    [refresh, replace, showToast],
  );

  const openLedger = useCallback(async () => {
    setLedger([]);
    try {
      setLedger(await dashboardApi.inventoryMovements());
    } catch (error) {
      setLedger(null);
      showToast(message(error, "Could not load the stock history."), "error");
    }
  }, [showToast]);

  const openForm = (item: InventoryItem | null) => {
    setSelectedId(null);
    setForm((f) => ({ open: true, item, key: f.key + 1 }));
  };

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items],
  );

  const counts = useMemo(() => {
    const c: Record<StockFilter, number> = { all: items.length, in_stock: 0, low_stock: 0, out_of_stock: 0 };
    for (const i of items) c[i.status] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const severity = { out_of_stock: 0, low_stock: 1, in_stock: 2 };
    return items
      .filter((i) => {
        const matchesSearch =
          !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);
        return (
          matchesSearch &&
          (stockFilter === "all" || i.status === stockFilter) &&
          (categoryFilter === "all" || i.category === categoryFilter)
        );
      })
      .sort((a, b) => severity[a.status] - severity[b.status] || a.name.localeCompare(b.name));
  }, [items, search, stockFilter, categoryFilter]);

  const attention = items.filter((i) => i.status !== "in_stock");
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Inventory"
        description="Products you sell, how many you have, and what needs restocking."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => void openLedger()}>
              <History className="w-3.5 h-3.5" /> Stock History
            </Button>
            <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => openForm(null)} disabled={!configured}>
              <Plus className="w-3.5 h-3.5" /> Add Product
            </Button>
          </div>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      {attention.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {attention.length} product{attention.length === 1 ? " needs" : "s need"} restocking
              </h2>
              <p className="text-xs text-gray-300 mt-0.5">
                {attention
                  .slice(0, 3)
                  .map((i) => `${i.name.split(" (")[0]} (${i.quantity} left)`)
                  .join(" • ")}
                {attention.length > 3 && ` • +${attention.length - 3} more`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setStockFilter("low_stock")}>
              Show low stock
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Products" value={items.length} icon={Boxes} tone="indigo" hint={`${categories.length} categories`} onClick={() => setStockFilter("all")} active={stockFilter === "all"} />
        <StatCard label="Stock Value" value={formatCurrency(stockValue)} icon={IndianRupee} tone="emerald" hint="At cost price" />
        <StatCard label="Low Stock" value={counts.low_stock} icon={AlertTriangle} tone="amber" hint="At or below minimum" onClick={() => setStockFilter("low_stock")} active={stockFilter === "low_stock"} />
        <StatCard label="Out of Stock" value={counts.out_of_stock} icon={PackageX} tone="rose" hint="Can't be sold right now" onClick={() => setStockFilter("out_of_stock")} active={stockFilter === "out_of_stock"} />
      </div>

      <section className="space-y-3" aria-label="Products">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedTabs<StockFilter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "In Stock", value: "in_stock", count: counts.in_stock },
              { label: "Low Stock", value: "low_stock", count: counts.low_stock },
              { label: "Out of Stock", value: "out_of_stock", count: counts.out_of_stock },
            ]}
            value={stockFilter}
            onChange={setStockFilter}
            className="self-start"
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search product, SKU or category..." className="w-full sm:w-64" />
            <Select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ label: "All categories", value: "all" }, ...categories.map((c) => ({ label: c, value: c }))]}
              wrapperClassName="w-full sm:w-44"
            />
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading inventory…</p>
        ) : (
          <InventoryTable items={filtered} onSelect={(i) => setSelectedId(i.id)} />
        )}
      </section>

      <ProductDetailModal
        item={selected}
        onClose={() => setSelectedId(null)}
        onAdjustStock={(id, delta) => void adjustStock(id, delta)}
        onEdit={(i) => openForm(i)}
      />
      <ProductFormModal
        key={form.key}
        isOpen={form.open}
        initial={form.item}
        categories={categories}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSave={saveProduct}
      />
      <StockLedger movements={ledger} onClose={() => setLedger(null)} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

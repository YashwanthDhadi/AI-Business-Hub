import React from "react";
import { Package, ChevronRight } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { InventoryItem } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";
import { stockStatusMeta } from "@/lib/status";

interface InventoryTableProps {
  items: InventoryItem[];
  onSelect: (item: InventoryItem) => void;
}

/** Stock level bar: fills relative to 2x the minimum level so "healthy" reads as mostly full. */
export function StockMeter({ item, className }: { item: InventoryItem; className?: string }) {
  const target = Math.max(item.lowStockThreshold * 2, 1);
  const pct = Math.min(100, (item.quantity / target) * 100);
  const color = item.status === "out_of_stock" ? "bg-rose-500" : item.status === "low_stock" ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className={cn("h-1.5 rounded-full bg-gray-800 overflow-hidden", className)} aria-hidden="true">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(pct, item.quantity > 0 ? 4 : 0)}%` }} />
    </div>
  );
}

export function InventoryTable({ items, onSelect }: InventoryTableProps) {
  if (items.length === 0) {
    return <EmptyState icon={Package} title="No Products Found" description="No products match your search or filters." />;
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      <ul className="md:hidden divide-y divide-gray-800/80">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onSelect(item)} className="w-full text-left p-4 space-y-2 hover:bg-gray-800/40 cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{item.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {item.category} • {formatCurrency(item.unitPrice)}
                  </div>
                </div>
                <Badge variant={stockStatusMeta[item.status].variant}>{stockStatusMeta[item.status].label}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <StockMeter item={item} className="flex-1" />
                <span className="text-xs text-gray-300 whitespace-nowrap">
                  <span className="font-bold text-white">{item.quantity}</span> / min {item.lowStockThreshold}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Product</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4 w-48">Stock</th>
              <th className="py-3 px-4 text-right">Min. Level</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Price</th>
              <th className="py-3 px-4 hidden xl:table-cell">Supplier</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {items.map((item) => (
              <tr key={item.id} onClick={() => onSelect(item)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                <td className="py-3.5 px-4">
                  <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{item.name}</div>
                  <div className="text-[11px] text-gray-500 font-mono">{item.sku}</div>
                </td>
                <td className="py-3.5 px-4 text-gray-300">{item.category}</td>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-8 text-right font-bold",
                        item.status === "out_of_stock" ? "text-rose-300" : item.status === "low_stock" ? "text-amber-300" : "text-white"
                      )}
                    >
                      {item.quantity}
                    </span>
                    <StockMeter item={item} className="flex-1" />
                  </div>
                </td>
                <td className="py-3.5 px-4 text-right text-gray-400">{item.lowStockThreshold}</td>
                <td className="py-3.5 px-4">
                  <Badge variant={stockStatusMeta[item.status].variant}>{stockStatusMeta[item.status].label}</Badge>
                </td>
                <td className="py-3.5 px-4 text-right font-medium">{formatCurrency(item.unitPrice)}</td>
                <td className="py-3.5 px-4 hidden xl:table-cell text-gray-400">{item.supplier ?? "—"}</td>
                <td className="py-3.5 px-4 text-right">
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300 inline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

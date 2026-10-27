"use client";

import React, { useState } from "react";
import { Minus, Plus, Pencil, PackagePlus, AlertTriangle } from "lucide-react";
import { Modal, Badge, Button, DetailList } from "@/components/ui";
import { InventoryItem } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { stockStatusMeta } from "@/lib/status";
import { StockMeter } from "./InventoryTable";

interface ProductDetailModalProps {
  item: InventoryItem | null;
  onClose: () => void;
  onAdjustStock: (id: string, delta: number) => void;
  onEdit: (item: InventoryItem) => void;
}

export function ProductDetailModal({ item, onClose, onAdjustStock, onEdit }: ProductDetailModalProps) {
  const [restockAmount, setRestockAmount] = useState(10);
  if (!item) return null;

  const status = stockStatusMeta[item.status];
  const margin = item.unitPrice > 0 ? Math.round(((item.unitPrice - item.costPrice) / item.unitPrice) * 100) : 0;
  const suggested = Math.max(item.lowStockThreshold * 2 - item.quantity, 0);

  return (
    <Modal isOpen onClose={onClose} title={item.name} description={`SKU ${item.sku}`} maxWidth="lg">
      <div className="space-y-5">
        {item.status !== "in_stock" && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              {item.status === "out_of_stock" ? "This product is out of stock." : "Stock is at or below your minimum level."} We suggest
              ordering <strong>{suggested} units</strong> from {item.supplier ?? "your supplier"}.
            </span>
          </div>
        )}

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">In stock</span>
              <div className="text-3xl font-bold text-white">{item.quantity}</div>
              <span className="text-xs text-gray-400">Minimum level: {item.lowStockThreshold}</span>
            </div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <StockMeter item={item} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onAdjustStock(item.id, -1)} disabled={item.quantity === 0} aria-label="Remove one unit">
              <Minus className="w-3.5 h-3.5" /> Sold 1
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAdjustStock(item.id, 1)} aria-label="Add one unit">
              <Plus className="w-3.5 h-3.5" /> Add 1
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <input
                type="number"
                min={1}
                value={restockAmount}
                onChange={(e) => setRestockAmount(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Restock quantity"
                className="w-16 rounded-lg bg-gray-950 border border-gray-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <Button size="sm" onClick={() => onAdjustStock(item.id, restockAmount)}>
                <PackagePlus className="w-3.5 h-3.5" /> Restock
              </Button>
            </div>
          </div>
        </div>

        <DetailList
          items={[
            { label: "Category", value: item.category },
            { label: "Supplier", value: item.supplier ?? "—" },
            { label: "Selling price", value: formatCurrency(item.unitPrice) },
            { label: "Cost price", value: `${formatCurrency(item.costPrice)} (${margin}% margin)` },
            { label: "Stock value", value: formatCurrency(item.quantity * item.costPrice) },
            { label: "Last restocked", value: item.lastRestocked ? formatDate(item.lastRestocked) : "—" },
          ]}
        />

        <div className="flex justify-end pt-4 border-t border-gray-800">
          <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
            <Pencil className="w-3.5 h-3.5" /> Edit Product
          </Button>
        </div>
      </div>
    </Modal>
  );
}

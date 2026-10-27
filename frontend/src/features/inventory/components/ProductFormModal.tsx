"use client";

import React, { useState } from "react";
import { Modal, Button, Input } from "@/components/ui";
import type { InventoryItem } from "@/types";
import type { NewInventoryItem } from "@/lib/api/dashboard";

interface ProductFormModalProps {
  isOpen: boolean;
  /** When provided the form edits this product; otherwise it creates a new one. */
  initial: InventoryItem | null;
  categories: string[];
  onClose: () => void;
  /** Rejects with the backend's message (duplicate name, bad value), shown in the form. */
  onSave: (input: NewInventoryItem, existing: InventoryItem | null) => Promise<void>;
}

interface FormState {
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: string;
  lowStockThreshold: string;
  unitPrice: string;
  costPrice: string;
}

const toForm = (item: InventoryItem | null): FormState => ({
  name: item?.name ?? "",
  sku: item?.sku ?? "",
  category: item?.category ?? "",
  unit: item?.unit ?? "piece",
  quantity: String(item?.quantity ?? 0),
  lowStockThreshold: String(item?.lowStockThreshold ?? 5),
  unitPrice: String(item?.unitPrice ?? ""),
  costPrice: String(item?.costPrice ?? ""),
});

/** Remounted via `key` by the parent so the form always starts from `initial`. */
export function ProductFormModal({ isOpen, initial, categories, onClose, onSave }: ProductFormModalProps) {
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: NewInventoryItem = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        category: form.category.trim(),
        unit: form.unit.trim() || "piece",
        reorder_level: Math.max(0, Math.round(Number(form.lowStockThreshold) || 0)),
        sale_price: Number(form.unitPrice) || 0,
        cost_price: Number(form.costPrice) || 0,
      };
      // Quantity is OPENING stock and only applies to a new product. Editing
      // it here would change stock with no ledger entry, so an existing
      // product's quantity is only ever moved from the detail screen.
      if (!initial) input.quantity = Math.max(0, Math.round(Number(form.quantity) || 0));

      await onSave(input, initial);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the product.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? "Edit Product" : "Add Product"} maxWidth="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
        <Input label="Product Name" value={form.name} onChange={set("name")} placeholder="e.g. Protein Powder (Vanilla)" required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="SKU" value={form.sku} onChange={set("sku")} placeholder="Optional" />
          <div className="space-y-1.5">
            <Input label="Category" value={form.category} onChange={set("category")} list="inventory-categories" placeholder="e.g. Supplements" />
            <datalist id="inventory-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {initial ? (
            <Input
              label="Stock Quantity"
              value={form.quantity}
              disabled
              helperText="Change stock from the product screen, so it is recorded"
            />
          ) : (
            <Input label="Opening Stock" type="number" min={0} value={form.quantity} onChange={set("quantity")} required />
          )}
          <Input
            label="Minimum Level"
            type="number"
            min={0}
            value={form.lowStockThreshold}
            onChange={set("lowStockThreshold")}
            helperText="Warn me at or below this"
            required
          />
          <Input label="Selling Price (₹)" type="number" min={0} step="0.01" value={form.unitPrice} onChange={set("unitPrice")} required />
          <Input label="Cost Price (₹)" type="number" min={0} step="0.01" value={form.costPrice} onChange={set("costPrice")} />
        </div>
        <Input label="Unit" value={form.unit} onChange={set("unit")} placeholder="piece, kg, box" />
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : initial ? "Save Changes" : "Add Product"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

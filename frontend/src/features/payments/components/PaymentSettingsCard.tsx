"use client";

import React, { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import type { PaymentSettings } from "@/types";

interface PaymentSettingsCardProps {
  settings: PaymentSettings;
  /** Rejects with the backend's message, shown under the form. */
  onSave: (patch: { upi_id: string; payee_name: string; invoice_prefix: string; due_days: number }) => Promise<void>;
}

/**
 * Where the business's UPI ID lives. Without it, invoices still work but the
 * pay page can only say "pay at the front desk" - we will never invent a payee.
 */
export function PaymentSettingsCard({ settings, onSave }: PaymentSettingsCardProps) {
  const [upiId, setUpiId] = useState(settings.upiId);
  const [payeeName, setPayeeName] = useState(settings.payeeName);
  const [prefix, setPrefix] = useState(settings.invoicePrefix);
  const [dueDays, setDueDays] = useState(settings.dueDays);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ upi_id: upiId.trim(), payee_name: payeeName.trim(), invoice_prefix: prefix.trim(), due_days: dueDays });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Payment Settings</CardTitle>
        <CardDescription>
          Customers pay you directly by UPI: no gateway, no fees. The money goes straight to this UPI ID, so check it carefully.
        </CardDescription>
      </CardHeader>
      <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 items-end">
        <Input label="Your UPI ID" placeholder="yourname@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
        <Input label="Name shown in the UPI app" placeholder="Pulse Fitness Studio" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
        <Input label="Invoice prefix" placeholder="INV" maxLength={3} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
        <Input label="Due in (days)" type="number" min={0} max={90} value={dueDays} onChange={(e) => setDueDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))} />
        <Button type="submit" size="md" disabled={saving} className="text-xs">
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-rose-400 mt-2">
          {error}
        </p>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Invoice numbers look like {prefix || "INV"}/2026-27/0001: one unbroken series per financial year (1 April to 31 March). GST is not calculated.
      </p>
    </Card>
  );
}

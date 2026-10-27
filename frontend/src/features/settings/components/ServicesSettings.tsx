"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, Button, Input } from "@/components/ui";
import type { ServiceItem } from "@/types";

interface ServicesSettingsProps {
  services: ServiceItem[];
  onChange: (services: ServiceItem[]) => void;
}

export function ServicesSettings({ services, onChange }: ServicesSettingsProps) {
  const update = (id: string, patch: Partial<ServiceItem>) => onChange(services.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const add = () =>
    onChange([
      ...services,
      { id: `srv-${Date.now()}`, name: "New Service", description: "", durationMinutes: 60, price: 0, category: "General" },
    ]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <CardHeader className="pb-0">
          <CardTitle>Services</CardTitle>
          <CardDescription>What customers can book. Prices and durations appear in your customer chat.</CardDescription>
        </CardHeader>
        <Button size="sm" onClick={add} className="self-start">
          <Plus className="w-3.5 h-3.5" /> Add Service
        </Button>
      </div>

      <ul className="space-y-3">
        {services.map((s) => (
          <li key={s.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 sm:p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <Input label="Service Name" id={`${s.id}-name`} value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} />
              </div>
              <div className="md:col-span-3">
                <Input label="Category" id={`${s.id}-category`} value={s.category ?? ""} onChange={(e) => update(s.id, { category: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:col-span-4">
                <Input
                  label="Minutes"
                  id={`${s.id}-duration`}
                  type="number"
                  min={5}
                  step={5}
                  value={s.durationMinutes}
                  onChange={(e) => update(s.id, { durationMinutes: Math.max(5, Number(e.target.value) || 5) })}
                />
                <Input
                  label="Price ($)"
                  id={`${s.id}-price`}
                  type="number"
                  min={0}
                  value={s.price}
                  onChange={(e) => update(s.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Input label="Description" id={`${s.id}-description`} value={s.description} onChange={(e) => update(s.id, { description: e.target.value })} />
              </div>
              <Button
                variant="ghost"
                size="md"
                onClick={() => onChange(services.filter((x) => x.id !== s.id))}
                aria-label={`Remove ${s.name}`}
                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </li>
        ))}
        {services.length === 0 && <li className="text-sm text-gray-500 text-center py-6">No services yet. Add one so customers can book.</li>}
      </ul>
    </Card>
  );
}

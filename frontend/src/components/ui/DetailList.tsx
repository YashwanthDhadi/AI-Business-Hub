import React from "react";
import { cn } from "@/lib/utils";

export interface DetailItem {
  label: string;
  value: React.ReactNode;
}

/** Two-column label / value grid used inside detail modals. */
export function DetailList({ items, className }: { items: DetailItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5 min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{item.label}</dt>
          <dd className="text-sm text-gray-100 mt-0.5 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Modal, Badge } from "@/components/ui";
import type { StockMovement, StockReason } from "@/types";
import { formatInstant } from "@/lib/utils";

const reasonLabels: Record<StockReason, string> = {
  sale: "Sale",
  restock: "Restocked",
  adjustment: "Adjusted",
  damage: "Damaged",
  return: "Returned",
  stocktake: "Stocktake",
};

const actorLabels = { owner: "You", agent: "Assistant", system: "System" } as const;

/**
 * Every stock change, newest first.
 *
 * This is an append-only ledger: nothing in the system edits or deletes a row.
 * It is what makes "why is this 3 and not 5?" answerable months later, and it
 * is why the quantity is never edited directly - only moved.
 */
export function StockLedger({
  movements,
  onClose,
}: {
  movements: StockMovement[] | null;
  onClose: () => void;
}) {
  if (movements === null) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Stock History"
      description="Every change to every product, newest first. Nothing here can be edited."
      maxWidth="lg"
    >
      {movements.length === 0 ? (
        <p className="text-xs text-gray-500 py-8 text-center">No stock movements yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800 max-h-[26rem] overflow-y-auto">
          {movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                {m.delta > 0 ? (
                  <ArrowUpRight className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-rose-400 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">{m.itemName}</div>
                  <div className="text-[11px] text-gray-500">
                    {formatInstant(m.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {actorLabels[m.actor]}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="neutral">{reasonLabels[m.reason]}</Badge>
                <span className={m.delta > 0 ? "text-xs font-semibold text-emerald-300" : "text-xs font-semibold text-rose-300"}>
                  {m.delta > 0 ? "+" : ""}
                  {m.delta}
                </span>
                <span className="text-[11px] text-gray-500 w-12 text-right">→ {m.balance}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

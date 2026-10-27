"use client";

import React, { useState } from "react";
import { BellRing, Check, X, MessageSquare, Clock } from "lucide-react";
import { Button } from "@/components/ui";
import { Booking } from "@/types";
import { formatPhone } from "@/lib/utils";

interface PendingApprovalsProps {
  bookings: Booking[];
  /** Resolves when the decision has been saved. Rejects to show an error. */
  onDecide: (id: string, decision: "approve" | "reject", note: string) => Promise<void>;
}

/**
 * Every booking the assistant took that is still waiting on the owner.
 *
 * The assistant deliberately has no way to write "confirmed" — it can only
 * ever create a `pending` row. This strip is the other half of that gate, so
 * the owner's decision is one click and not something they must go hunting
 * for in the table below.
 */
export function PendingApprovals({ bookings, onDecide }: PendingApprovalsProps) {
  // Which row is showing its note box, and what is typed in it.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  if (bookings.length === 0) return null;

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusyId(id);
    try {
      await onDecide(id, decision, noteFor === id ? note.trim() : "");
      setNoteFor(null);
      setNote("");
    } finally {
      // Clear even on failure — the row is still there and still clickable.
      setBusyId(null);
    }
  };

  return (
    <section
      className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 sm:p-5 space-y-3"
      aria-label="Bookings waiting for your approval"
    >
      <header className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
          <BellRing className="w-4 h-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white">
            {bookings.length} booking{bookings.length === 1 ? "" : "s"} waiting for you
          </h2>
          <p className="text-xs text-amber-200/70">
            The assistant took these but told the customer nothing is confirmed yet.
          </p>
        </div>
      </header>

      <ul className="space-y-2">
        {bookings.map((booking) => {
          const busy = busyId === booking.id;
          const showNote = noteFor === booking.id;

          return (
            <li
              key={booking.id}
              className="rounded-lg border border-gray-800 bg-gray-900/70 p-3 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium text-white truncate">
                    {booking.serviceName}
                    {booking.reference && (
                      <span className="ml-2 text-[10px] font-mono text-gray-500">
                        {booking.reference}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {booking.date} at {booking.time}
                    </span>
                    <span className="text-gray-600">•</span>
                    <span className="truncate">
                      {booking.customerName} {formatPhone(booking.customerPhone)}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setNoteFor(showNote ? null : booking.id);
                      setNote("");
                    }}
                    aria-expanded={showNote}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Note
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    disabled={busy}
                    onClick={() => void decide(booking.id, "reject")}
                  >
                    <X className="w-3.5 h-3.5" />
                    Decline
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="text-xs"
                    isLoading={busy}
                    disabled={busy}
                    onClick={() => void decide(booking.id, "approve")}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve
                  </Button>
                </div>
              </div>

              {showNote && (
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Sent to the customer with your decision — e.g. 'Please arrive 10 minutes early.'"
                  className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

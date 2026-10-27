"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Send, Clock, Package } from "lucide-react";
import { Card, CardHeader, CardTitle, Badge, Button } from "@/components/ui";

export function NeedsAttention() {
  const [remindedId, setRemindedId] = useState<string | null>(null);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);

  const handleSendReminder = (id: string) => {
    setRemindedId(id);
    setTimeout(() => {
      // keep marked sent
    }, 2000);
  };

  const handleConfirmBooking = (id: string) => {
    setConfirmedBookingId(id);
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base">Needs Your Attention</CardTitle>
            <p className="text-xs text-gray-400">
              3 items require owner confirmation or follow-up
            </p>
          </div>
        </div>
        <Badge variant="warning">3 Action Items</Badge>
      </CardHeader>

      <div className="space-y-3 pt-2">
        {/* Item 1: Unpaid invoice */}
        <div className="p-3.5 rounded-xl border border-gray-800 bg-gray-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">Elena Rostova</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                Pending ₹120.00
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Invoice #INV-1002 for Nutrition Consultations is due in 2 days.
            </p>
          </div>

          <Button
            variant={remindedId === "inv-1002" ? "secondary" : "outline"}
            size="sm"
            onClick={() => handleSendReminder("inv-1002")}
            className="text-xs flex-shrink-0"
          >
            {remindedId === "inv-1002" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Reminder Sent
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 text-indigo-400" />
                Send Reminder
              </>
            )}
          </Button>
        </div>

        {/* Item 2: Booking needing confirmation */}
        <div className="p-3.5 rounded-xl border border-gray-800 bg-gray-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">David Kim</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium">
                1:00 PM Today
              </span>
            </div>
            <p className="text-xs text-gray-400">
              HIIT Bootcamp requested via AI chat. Needs trainer confirmation.
            </p>
          </div>

          <Button
            variant={confirmedBookingId === "bk-103" ? "secondary" : "primary"}
            size="sm"
            onClick={() => handleConfirmBooking("bk-103")}
            className="text-xs flex-shrink-0"
          >
            {confirmedBookingId === "bk-103" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Confirmed
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5" />
                Confirm Slot
              </>
            )}
          </Button>
        </div>

        {/* Item 3: Low stock warning */}
        <div className="p-3.5 rounded-xl border border-gray-800 bg-gray-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">
                Pure Whey Isolate Protein (Chocolate)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 font-medium">
                3 Left
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Inventory is below minimum threshold of 8 units.
            </p>
          </div>

          <Link href="/dashboard/inventory">
            <Button variant="outline" size="sm" className="text-xs flex-shrink-0 w-full sm:w-auto">
              <Package className="w-3.5 h-3.5" />
              View Stock
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

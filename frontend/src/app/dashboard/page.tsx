"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageSquare, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { OverviewStatCards } from "@/features/dashboard/components/OverviewStatCards";
import { AskAiSection } from "@/features/dashboard/components/AskAiSection";
import { NeedsAttention } from "@/features/dashboard/components/NeedsAttention";
import { RecentActivity } from "@/features/dashboard/components/RecentActivity";
import { QuickActions } from "@/features/dashboard/components/QuickActions";
import { mockBookings, mockCustomers, mockInventory, mockPayments } from "@/data";
import { MOCK_TODAY } from "@/lib/constants";

/** Picks up a question sent from the header "Ask AI" bar (?ask=...). */
function AskAiFromQuery() {
  const ask = useSearchParams().get("ask") ?? undefined;
  return <AskAiSection key={ask ?? "none"} initialQuery={ask} />;
}

export default function DashboardHomePage() {
  // Aggregate real mock numbers
  const todayBookings = mockBookings.filter((b) => b.date === MOCK_TODAY && b.status !== "cancelled");
  const todayBookingsCount = todayBookings.length;
  const pendingTodayCount = todayBookings.filter((b) => b.status === "pending").length;
  const pendingInvoices = mockPayments.filter((p) => p.status === "pending" || p.status === "overdue");
  const pendingPaymentsAmount = pendingInvoices.reduce((acc, curr) => acc + curr.amount, 0);
  const activeCustomersCount = mockCustomers.filter((c) => c.status === "active").length;
  const lowStockCount = mockInventory.filter((i) => i.status === "low_stock" || i.status === "out_of_stock").length;

  return (
    <div className="space-y-8">
      {/* 1. Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Good morning, Yashwanth
            </h1>
            <span className="text-xl">👋</span>
          </div>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            FitZone Fitness & Wellness Club • Business Operations Overview
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/chat/fitzone" target="_blank">
            <Button variant="outline" size="sm" className="text-xs">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              Public Chat Link
              <ExternalLink className="w-3 h-3 text-gray-500" />
            </Button>
          </Link>
          <Link href="/dashboard/bookings">
            <Button variant="primary" size="sm" className="text-xs shadow-md shadow-indigo-600/20">
              <Plus className="w-3.5 h-3.5" />
              New Appointment
            </Button>
          </Link>
        </div>
      </div>

      {/* 2. Overview Stat Cards */}
      <OverviewStatCards
        bookingsCount={todayBookingsCount}
        pendingTodayCount={pendingTodayCount}
        pendingPaymentsAmount={pendingPaymentsAmount}
        pendingInvoicesCount={pendingInvoices.length}
        customersCount={activeCustomersCount}
        lowStockCount={lowStockCount}
      />

      {/* 3. Interactive "Ask AI" Console */}
      <Suspense fallback={<AskAiSection />}>
        <AskAiFromQuery />
      </Suspense>

      {/* 4. Two-Column Operational Section: Needs Attention + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NeedsAttention />
        <RecentActivity />
      </div>

      {/* 5. Quick Actions Bar */}
      <QuickActions />
    </div>
  );
}

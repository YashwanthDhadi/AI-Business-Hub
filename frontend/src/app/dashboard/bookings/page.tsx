"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { PageHeader, Toast } from "@/components/ui";
import { BookingStats } from "@/features/bookings/components/BookingStats";
import { BookingFilters } from "@/features/bookings/components/BookingFilters";
import { BookingTable } from "@/features/bookings/components/BookingTable";
import { BookingCalendar } from "@/features/bookings/components/BookingCalendar";
import { BookingDetailModal } from "@/features/bookings/components/BookingDetailModal";
import { PendingApprovals } from "@/features/bookings/components/PendingApprovals";
import type {
  BookingStatusFilter,
  BookingChannelFilter,
  BookingDateFilter,
  BookingQuickView,
} from "@/features/bookings/types";
import { Booking, BookingStatus } from "@/types";
import { todayISO } from "@/lib/constants";
import { timeToMinutes } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";

export default function BookingsPage() {
  // LIVE_BUSINESS_ID is a build-time constant, so the "not configured" state is
  // known at construction — no effect needed, and no cascading render.
  const configured = Boolean(LIVE_BUSINESS_ID);

  // Read once per mount so filters do not shift under the owner at midnight.
  const [today] = useState(todayISO);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured
      ? null
      : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<BookingChannelFilter>("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<BookingDateFilter>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  const selectedBooking = bookings.find((b) => b.id === selectedBookingId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.bookings();
      setBookings(data.bookings);
      setPending(data.pending);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof HubError ? error.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it touches state, so nothing is set synchronously
    // here — the lint rule cannot see past the async boundary. Ten seconds, not
    // the chat page's six: bookings arrive far less often and each poll pulls
    // the whole list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  // Everything except status, so the status tab counts reflect the other filters.
  const baseFiltered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const matchesDate = (b: Booking) => {
      switch (dateFilter) {
        case "today":
          return b.date === today;
        case "upcoming":
          return b.date > today;
        case "past":
          return b.date < today;
        case "selected":
          return selectedDate ? b.date === selectedDate : true;
        default:
          return true;
      }
    };
    return bookings.filter((b) => {
      const matchesSearch =
        !q ||
        b.customerName.toLowerCase().includes(q) ||
        b.serviceName.toLowerCase().includes(q) ||
        b.customerPhone.includes(q) ||
        (b.reference ?? "").toLowerCase().includes(q);
      const matchesChannel = channelFilter === "all" || b.bookedVia === channelFilter;
      const matchesService = serviceFilter === "all" || b.serviceId === serviceFilter;
      return matchesSearch && matchesChannel && matchesService && matchesDate(b);
    });
  }, [bookings, searchTerm, channelFilter, serviceFilter, dateFilter, selectedDate, today]);

  const filteredBookings = useMemo(() => {
    return baseFiltered
      .filter((b) => statusFilter === "all" || b.status === statusFilter)
      .sort((a, b) =>
        a.date === b.date
          ? timeToMinutes(a.time) - timeToMinutes(b.time)
          : a.date.localeCompare(b.date),
      );
  }, [baseFiltered, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<BookingStatusFilter, number> = {
      all: baseFiltered.length,
      confirmed: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const b of baseFiltered) counts[b.status] += 1;
    return counts;
  }, [baseFiltered]);

  /**
   * The service dropdown, built from the bookings themselves.
   *
   * The mock screen read a fixed service list. Live, a business can add and
   * retire services, and filtering by one nobody has ever booked is useless —
   * so the options are whatever actually appears in the data.
   */
  const serviceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bookings) {
      if (b.serviceId && !seen.has(b.serviceId)) seen.set(b.serviceId, b.serviceName);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [bookings]);

  const pendingBookings = useMemo(
    () => bookings.filter((b) => b.status === "pending"),
    [bookings],
  );

  // Summary card numbers (always across all bookings)
  const todayCount = bookings.filter((b) => b.date === today && b.status !== "cancelled").length;
  const upcomingCount = bookings.filter((b) => b.date > today && b.status !== "cancelled").length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;

  const activeQuickView: BookingQuickView | null =
    statusFilter === "all" && dateFilter === "today"
      ? "today"
      : statusFilter === "all" && dateFilter === "upcoming"
        ? "upcoming"
        : statusFilter === "pending" && dateFilter === "all"
          ? "pending"
          : statusFilter === "completed" && dateFilter === "all"
            ? "completed"
            : null;

  const handleQuickView = (view: BookingQuickView) => {
    if (activeQuickView === view) {
      setStatusFilter("all");
      setDateFilter("all");
      return;
    }
    setSelectedDate(view === "today" ? today : null);
    setDateFilter(view === "today" || view === "upcoming" ? view : "all");
    setStatusFilter(view === "pending" || view === "completed" ? view : "all");
  };

  const handleSelectDate = (date: string | null) => {
    setSelectedDate(date);
    setDateFilter(date ? "selected" : "all");
  };

  const handleDateFilterChange = (filter: BookingDateFilter) => {
    setDateFilter(filter);
    if (filter === "today") setSelectedDate(today);
    else if (filter !== "selected") setSelectedDate(null);
  };

  const hasActiveFilters =
    searchTerm !== "" ||
    statusFilter !== "all" ||
    channelFilter !== "all" ||
    serviceFilter !== "all" ||
    dateFilter !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setChannelFilter("all");
    setServiceFilter("all");
    setDateFilter("all");
    setSelectedDate(null);
  };

  /**
   * Approve or decline a booking the assistant took.
   *
   * This is the only path that can write "confirmed" — the assistant has no
   * tool for it. The backend also posts a line into the customer's chat, which
   * is why the toast says whether anyone was actually told.
   */
  const handleDecide = useCallback(
    async (id: string, decision: "approve" | "reject", note = "") => {
      try {
        const result = await dashboardApi.decideBooking(id, decision, note);
        setBookings((prev) => prev.map((b) => (b.id === id ? result.booking : b)));
        // Drop the count now rather than waiting up to ten seconds for the next
        // poll. Math.max guards against two tabs deciding the same booking.
        setPending((n) => Math.max(0, n - 1));
        const word = decision === "approve" ? "confirmed" : "declined";
        showToast(
          result.customer_notified
            ? `Booking ${word} — the customer has been told in their chat.`
            : `Booking ${word}. This one has no chat thread, so ring them yourself.`,
        );
      } catch (error) {
        showToast(
          error instanceof HubError ? error.message : "Could not update the booking.",
          "error",
        );
        // Our copy may be stale — a second tab may have decided it already.
        void refresh();
      }
    },
    [refresh, showToast],
  );

  /**
   * Any other status move, e.g. confirmed -> completed after the visit.
   *
   * A pending booking is routed through the decision endpoint instead, because
   * that one also messages the customer. Same button to the owner, two very
   * different things underneath.
   */
  const handleUpdateStatus = useCallback(
    async (id: string, status: BookingStatus) => {
      const current = bookings.find((b) => b.id === id);
      if (current?.status === "pending" && (status === "confirmed" || status === "cancelled")) {
        await handleDecide(id, status === "confirmed" ? "approve" : "reject");
        return;
      }
      try {
        const updated = await dashboardApi.setBookingStatus(id, status);
        setBookings((prev) => prev.map((b) => (b.id === id ? updated : b)));
        showToast(`Booking marked ${status}.`);
      } catch (error) {
        showToast(
          error instanceof HubError ? error.message : "Could not update the booking.",
          "error",
        );
        void refresh();
      }
    },
    [bookings, handleDecide, refresh, showToast],
  );

  /**
   * Bill a booking. The invoice uses the booking's OWN snapshot price, lands
   * in the customer's chat, and - once it is paid - a database trigger flips
   * this booking's payment status. Nothing here sets "paid" by hand.
   */
  const handleCreateInvoice = useCallback(
    async (booking: Booking) => {
      try {
        const result = await dashboardApi.createInvoice({
          customer_id: booking.customerId,
          appointment_id: booking.id,
        });
        showToast(
          result.customer_notified
            ? `${result.invoice.invoiceNumber} created and sent to ${booking.customerName}'s chat.`
            : `${result.invoice.invoiceNumber} created. They have no chat thread - share the link from Payments.`,
        );
      } catch (error) {
        showToast(error instanceof HubError ? error.message : "Could not create the invoice.", "error");
      }
    },
    [showToast],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Calendar}
        title="Bookings"
        description="Every appointment your assistant took, and the ones waiting on your OK."
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      )}

      <PendingApprovals bookings={pendingBookings} onDecide={handleDecide} />

      <BookingStats
        today={todayCount}
        upcoming={upcomingCount}
        pending={pending}
        completed={completedCount}
        activeView={activeQuickView}
        onSelectView={handleQuickView}
      />

      <BookingCalendar
        bookings={bookings}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onSelectBooking={(b) => setSelectedBookingId(b.id)}
      />

      <section className="space-y-3" aria-label="Booking list">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-white">All Appointments</h2>
          <span className="text-xs text-gray-500">
            Showing {filteredBookings.length} of {bookings.length}
          </span>
        </div>

        <BookingFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          statusCounts={statusCounts}
          serviceFilter={serviceFilter}
          onServiceFilterChange={setServiceFilter}
          serviceOptions={serviceOptions}
          dateFilter={dateFilter}
          onDateFilterChange={handleDateFilterChange}
          selectedDate={selectedDate}
          channelFilter={channelFilter}
          onChannelFilterChange={setChannelFilter}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />

        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading bookings…</p>
        ) : (
          <BookingTable
            bookings={filteredBookings}
            onConfirmBooking={(id) => void handleUpdateStatus(id, "confirmed")}
            onCancelBooking={(id) => void handleUpdateStatus(id, "cancelled")}
            onSelectBooking={(b) => setSelectedBookingId(b.id)}
          />
        )}
      </section>

      <BookingDetailModal
        booking={selectedBooking}
        onClose={() => setSelectedBookingId(null)}
        onUpdateStatus={(id, status) => void handleUpdateStatus(id, status)}
        onCreateInvoice={(b) => void handleCreateInvoice(b)}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

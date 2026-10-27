import React from "react";
import { Booking } from "@/types";
import { Badge, Button, EmptyState } from "@/components/ui";
import { Calendar, Clock, CheckCircle2, XCircle, MessageSquare, ChevronRight } from "lucide-react";
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils";
import { bookingStatusMeta, bookingPaymentMeta } from "@/lib/status";

interface BookingTableProps {
  bookings: Booking[];
  onConfirmBooking: (id: string) => void;
  onCancelBooking: (id: string) => void;
  onSelectBooking: (booking: Booking) => void;
}

function SourceTag({ bookedVia }: { bookedVia: Booking["bookedVia"] }) {
  if (bookedVia === "customer_chat") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 whitespace-nowrap">
        <MessageSquare className="w-3 h-3" />
        Customer Chat
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-800 text-gray-300 border border-gray-700 whitespace-nowrap">
      {bookedVia === "manual" ? "Walk-in / Phone" : "Dashboard"}
    </span>
  );
}

export function BookingTable({ bookings, onConfirmBooking, onCancelBooking, onSelectBooking }: BookingTableProps) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="No Bookings Found"
        description="No appointments matched your search or filters. Try clearing filters or create a new booking."
      />
    );
  }

  const renderActions = (b: Booking) => (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {b.status === "pending" && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => onConfirmBooking(b.id)}
          className="text-[11px] py-1 px-2.5 h-7"
        >
          <CheckCircle2 className="w-3 h-3" />
          Confirm
        </Button>
      )}
      {(b.status === "pending" || b.status === "confirmed") && (
        <button
          type="button"
          onClick={() => onCancelBooking(b.id)}
          className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
          title="Cancel appointment"
          aria-label={`Cancel appointment for ${b.customerName}`}
        >
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      {/* Mobile card list */}
      <ul className="md:hidden divide-y divide-gray-800/80">
        {bookings.map((b) => (
          <li key={b.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectBooking(b)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectBooking(b)}
              className="p-4 space-y-2 hover:bg-gray-800/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{b.customerName}</div>
                  <div className="text-xs text-gray-400 truncate">{b.serviceName}</div>
                </div>
                <Badge variant={bookingStatusMeta[b.status].variant}>{bookingStatusMeta[b.status].label}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(b.date, { month: "short", day: "numeric" })}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-indigo-300">
                  <Clock className="w-3 h-3" />
                  {b.time}
                </span>
                <Badge variant={bookingPaymentMeta[b.paymentStatus].variant} className="text-[10px]">
                  {bookingPaymentMeta[b.paymentStatus].label}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <SourceTag bookedVia={b.bookedVia} />
                {renderActions(b)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Service</th>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Time</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Payment</th>
              <th className="py-3 px-4 hidden lg:table-cell">Source</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {bookings.map((b) => (
              <tr
                key={b.id}
                onClick={() => onSelectBooking(b)}
                className="hover:bg-gray-800/40 transition-colors cursor-pointer group"
              >
                <td className="py-3.5 px-4">
                  <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                    {b.customerName}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{formatPhone(b.customerPhone)}</div>
                </td>
                <td className="py-3.5 px-4">
                  <div className="font-medium text-gray-200 max-w-[16rem] truncate">{b.serviceName}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {b.durationMinutes} mins • {formatCurrency(b.price)}
                  </div>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap font-medium text-white">
                  {formatDate(b.date, { weekday: "short", month: "short", day: "numeric" })}
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap font-mono text-indigo-300">{b.time}</td>
                <td className="py-3.5 px-4">
                  <Badge variant={bookingStatusMeta[b.status].variant}>{bookingStatusMeta[b.status].label}</Badge>
                </td>
                <td className="py-3.5 px-4">
                  <Badge variant={bookingPaymentMeta[b.paymentStatus].variant}>
                    {bookingPaymentMeta[b.paymentStatus].label}
                  </Badge>
                </td>
                <td className="py-3.5 px-4 hidden lg:table-cell">
                  <SourceTag bookedVia={b.bookedVia} />
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {renderActions(b)}
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

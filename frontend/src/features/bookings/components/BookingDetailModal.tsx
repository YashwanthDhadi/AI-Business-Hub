"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, CreditCard, Phone, Mail, MessageSquare, User, BadgeCheck } from "lucide-react";
import { Modal, Button, Badge, DetailList, Avatar } from "@/components/ui";
import { Booking, BookingStatus } from "@/types";
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils";
import { bookingStatusMeta, bookingPaymentMeta } from "@/lib/status";

interface BookingDetailModalProps {
  booking: Booking | null;
  onClose: () => void;
  onUpdateStatus: (id: string, status: BookingStatus) => void;
  /**
   * Bill this booking. Payment status is no longer set by hand: it follows the
   * booking's invoice (a database trigger), so "paid" means an invoice was paid.
   */
  onCreateInvoice: (booking: Booking) => void;
}

const sourceLabels: Record<Booking["bookedVia"], string> = {
  customer_chat: "Customer Chat",
  dashboard: "Dashboard",
  manual: "Walk-in / Phone",
};

export function BookingDetailModal({ booking, onClose, onUpdateStatus, onCreateInvoice }: BookingDetailModalProps) {
  if (!booking) return null;

  const status = bookingStatusMeta[booking.status];
  const payment = bookingPaymentMeta[booking.paymentStatus];
  const isOpen = booking.status === "pending" || booking.status === "confirmed";

  return (
    <Modal isOpen={!!booking} onClose={onClose} title="Booking Details" description={`Reference ${booking.id.toUpperCase()}`} maxWidth="lg">
      <div className="space-y-5">
        {/* Customer header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={booking.customerName} size="lg" />
            <div className="min-w-0">
              <div className="text-base font-semibold text-white truncate">{booking.customerName}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {formatPhone(booking.customerPhone)}
                </span>
                <span className="inline-flex items-center gap-1 truncate">
                  <Mail className="w-3 h-3" /> {booking.customerEmail}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            <Badge variant={payment.variant}>{payment.label}</Badge>
          </div>
        </div>

        <DetailList
          items={[
            { label: "Service", value: booking.serviceName },
            { label: "Date", value: formatDate(booking.date, { weekday: "long", month: "long", day: "numeric" }) },
            { label: "Time", value: `${booking.time} (${booking.durationMinutes} min)` },
            { label: "Staff", value: booking.staffAssigned ?? "Unassigned" },
            { label: "Price", value: formatCurrency(booking.price) },
            { label: "Payment", value: payment.label },
            {
              label: "Booked via",
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {booking.bookedVia === "customer_chat" && <MessageSquare className="w-3.5 h-3.5 text-purple-400" />}
                  {sourceLabels[booking.bookedVia]}
                </span>
              ),
            },
            { label: "Status", value: status.label },
          ]}
        />

        {booking.notes && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Notes</span>
            <p className="text-sm text-gray-200 mt-0.5">{booking.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-gray-800">
          <Link href="/dashboard/customers" className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
            <User className="w-3.5 h-3.5" /> View customer profile
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {booking.paymentStatus === "unpaid" && (booking.status === "confirmed" || booking.status === "completed") && (
              <Button variant="outline" size="sm" onClick={() => onCreateInvoice(booking)}>
                <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                Create Invoice
              </Button>
            )}
            {isOpen && (
              <Button variant="outline" size="sm" onClick={() => onUpdateStatus(booking.id, "cancelled")} className="hover:text-rose-300">
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                Cancel
              </Button>
            )}
            {booking.status === "pending" && (
              <Button variant="primary" size="sm" onClick={() => onUpdateStatus(booking.id, "confirmed")}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Confirm Booking
              </Button>
            )}
            {booking.status === "confirmed" && (
              <Button variant="primary" size="sm" onClick={() => onUpdateStatus(booking.id, "completed")}>
                <BadgeCheck className="w-3.5 h-3.5" />
                Mark Completed
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

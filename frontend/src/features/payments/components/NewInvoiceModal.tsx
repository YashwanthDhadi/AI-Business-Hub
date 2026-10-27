"use client";

import React, { useState } from "react";
import { Modal, Button, Input, Select, SegmentedTabs, Toggle } from "@/components/ui";
import type { Booking, CustomerSummary } from "@/types";
import { dashboardApi, type CatalogService, type NewInvoice } from "@/lib/api/dashboard";
import { formatCurrency, formatDate, formatPhone, isoDateInIndia } from "@/lib/utils";

interface NewInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rejects with the backend's message, shown inside the form. */
  onCreate: (invoice: NewInvoice) => Promise<void>;
  customers: CustomerSummary[];
  services: CatalogService[];
  dueDays: number;
}

type Mode = "booking" | "service";

export function NewInvoiceModal({ isOpen, onClose, onCreate, customers, services, dueDays }: NewInvoiceModalProps) {
  const [customerId, setCustomerId] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [mode, setMode] = useState<Mode>("booking");
  const [bookingId, setBookingId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState(() => isoDateInIndia(dueDays));
  const [sendToChat, setSendToChat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const booking = bookings.find((b) => b.id === bookingId);
  const total = mode === "booking" ? (booking?.price ?? 0) : (service?.price ?? 0) * quantity;

  const reset = () => {
    setCustomerId("");
    setBookings([]);
    setMode("booking");
    setBookingId("");
    setServiceId("");
    setQuantity(1);
    setDueDate(isoDateInIndia(dueDays));
    setSendToChat(true);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  /** Load this customer's billable bookings when they are picked - in the event, not an effect. */
  const chooseCustomer = async (id: string) => {
    setCustomerId(id);
    setBookingId("");
    setBookings([]);
    setError(null);
    if (!id) return;
    setLoadingBookings(true);
    try {
      const detail = await dashboardApi.customer(id);
      const billable = detail.bookings.filter(
        (b) => (b.status === "confirmed" || b.status === "completed") && b.paymentStatus === "unpaid",
      );
      setBookings(billable);
      setMode(billable.length > 0 ? "booking" : "service");
    } catch {
      setMode("service");
    } finally {
      setLoadingBookings(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) return setError("Choose a customer.");
    if (mode === "booking" && !bookingId) return setError("Choose the booking to bill.");
    if (mode === "service" && !service) return setError("Choose a service.");

    setSaving(true);
    setError(null);
    try {
      await onCreate({
        customer_id: customerId,
        // Billing a booking sends NO items: the backend uses the booking's own snapshot price.
        appointment_id: mode === "booking" ? bookingId : null,
        items:
          mode === "service" && service
            ? [{ description: service.name, quantity, unit_price: service.price }]
            : [],
        due_date: dueDate,
        send_to_chat: sendToChat,
      });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the invoice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Invoice" description="Bill a customer for a booking or a service." maxWidth="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
        <Select
          label="Customer"
          value={customerId}
          onChange={(v) => void chooseCustomer(v)}
          options={[
            { label: "Choose a customer…", value: "" },
            ...customers.map((c) => ({ label: `${c.name}${c.phone ? ` (${formatPhone(c.phone)})` : ""}`, value: c.id })),
          ]}
        />

        {customerId && (
          <SegmentedTabs<Mode>
            tabs={[
              { label: "A booking", value: "booking", count: bookings.length },
              { label: "A service", value: "service" },
            ]}
            value={mode}
            onChange={setMode}
            className="w-fit"
          />
        )}

        {customerId && mode === "booking" && (
          loadingBookings ? (
            <p className="text-xs text-gray-500">Loading their bookings…</p>
          ) : bookings.length === 0 ? (
            <p className="text-xs text-gray-500">No confirmed, unpaid bookings for this customer. Bill a service instead.</p>
          ) : (
            <Select
              label="Booking (billed at the price they were quoted)"
              value={bookingId}
              onChange={setBookingId}
              options={[
                { label: "Choose a booking…", value: "" },
                ...bookings.map((b) => ({
                  label: `${b.serviceName} • ${formatDate(b.date, { day: "numeric", month: "short" })} ${b.time} • ${formatCurrency(b.price)}`,
                  value: b.id,
                })),
              ]}
            />
          )
        )}

        {customerId && mode === "service" && (
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Select
              label="Service"
              value={serviceId}
              onChange={setServiceId}
              options={[
                { label: "Choose a service…", value: "" },
                ...services.map((s) => ({ label: `${s.name} — ${formatCurrency(s.price)}`, value: s.id })),
              ]}
            />
            <Input
              label="Quantity"
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        )}

        <Input label="Due Date" type="date" value={dueDate} min={isoDateInIndia()} onChange={(e) => setDueDate(e.target.value)} required />

        <Toggle
          checked={sendToChat}
          onChange={setSendToChat}
          label="Send it to their chat"
          description="Posts the invoice and its UPI payment link in the customer's chat thread, if they have one."
        />

        <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5">
          <span className="text-xs text-gray-400">Invoice total</span>
          <span className="text-lg font-bold text-white">{formatCurrency(total)}</span>
        </div>
        <p className="text-[11px] text-gray-500">The invoice number is given by the database when you create it, in one unbroken series for the financial year.</p>

        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Creating…" : "Create Invoice"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

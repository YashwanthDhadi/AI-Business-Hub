"use client";

import React, { useState } from "react";
import { Send, CheckCircle2, Download, Link2, ExternalLink, XCircle, Undo2, BadgeInfo } from "lucide-react";
import { Modal, Badge, Button, DetailList, Input, Select } from "@/components/ui";
import { PaymentInvoice } from "@/types";
import { formatCurrency, formatDate, formatInstant, formatPhone } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { paymentMethodLabels, PaymentMethod } from "../constants";

interface InvoiceDetailModalProps {
  invoice: PaymentInvoice | null;
  businessName: string;
  onClose: () => void;
  /** Each action rejects on failure; the page shows the toast. */
  onMarkPaid: (id: string, method: PaymentMethod, reference: string) => Promise<void>;
  onCancel: (id: string, reason: string) => Promise<void>;
  onRefund: (id: string, note: string) => Promise<void>;
  onRemind: (invoice: PaymentInvoice) => Promise<void>;
  onCopyLink: (invoice: PaymentInvoice) => void;
}

export function InvoiceDetailModal({
  invoice,
  businessName,
  onClose,
  onMarkPaid,
  onCancel,
  onRefund,
  onRemind,
  onCopyLink,
}: InvoiceDetailModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  if (!invoice) return null;

  const status = invoiceStatusMeta[invoice.status];
  const isOpen = invoice.status === "pending" || invoice.status === "overdue";

  /** Run one action with the buttons disabled; the page reports success or failure. */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setReference("");
    } catch {
      // The page has shown the error. Leave the form as it was.
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    const reason = window.prompt("Why cancel this invoice? The customer is told it no longer needs paying.", "");
    if (reason !== null) void act(() => onCancel(invoice.id, reason));
  };

  const handleRefund = () => {
    const note = window.prompt(
      "Record a refund you have ALREADY paid back (by UPI, cash...). What should the note say?",
      "",
    );
    if (note !== null) void act(() => onRefund(invoice.id, note));
  };

  return (
    <Modal isOpen onClose={onClose} title={`Invoice ${invoice.invoiceNumber}`} description={`Issued ${formatInstant(invoice.createdAt)}`} maxWidth="lg">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Billed to</span>
            <div className="text-base font-semibold text-white">{invoice.customerName}</div>
            <div className="text-xs text-gray-400">{formatPhone(invoice.customerPhone) || invoice.customerEmail}</div>
          </div>
          <div className="sm:text-right">
            <Badge variant={status.variant}>{status.label}</Badge>
            <div className="text-2xl font-bold text-white mt-1">{formatCurrency(invoice.amount, invoice.currency)}</div>
          </div>
        </div>

        {invoice.customerReportedAt && isOpen && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200 flex gap-2">
            <BadgeInfo className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>
              The customer says they paid on {formatInstant(invoice.customerReportedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {invoice.customerReference ? <>, UPI reference <span className="font-mono text-white">{invoice.customerReference}</span></> : null}.
              Check your UPI app or bank statement first. Only mark it paid once you can see the money.
            </span>
          </div>
        )}

        {/* Line items */}
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-950/80 text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="text-left py-2 px-3">Item</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3 hidden sm:table-cell">Price</th>
                <th className="text-right py-2 px-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-200">
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 px-3">{item.description}</td>
                  <td className="py-2 px-3 text-right">{item.quantity}</td>
                  <td className="py-2 px-3 text-right hidden sm:table-cell">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-2 px-3 text-right font-medium">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-800 bg-gray-950/60">
              <tr>
                <td colSpan={2} className="py-2 px-3 font-semibold text-white sm:hidden">Total</td>
                <td colSpan={3} className="py-2 px-3 font-semibold text-white hidden sm:table-cell">Total</td>
                <td className="py-2 px-3 text-right font-bold text-white">{formatCurrency(invoice.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DetailList
          items={[
            { label: "Due date", value: formatDate(invoice.dueDate) },
            { label: "Paid on", value: invoice.paidDate ? formatDate(invoice.paidDate) : "Not paid yet" },
            {
              label: "Method",
              value: invoice.paymentMethod
                ? `${paymentMethodLabels[invoice.paymentMethod]}${invoice.paidReference ? ` • ${invoice.paidReference}` : ""}`
                : "—",
            },
            { label: "Booking", value: invoice.bookingReference ?? "Not for a booking" },
            { label: "Business", value: businessName },
            ...(invoice.cancelReason ? [{ label: "Cancelled because", value: invoice.cancelReason }] : []),
            ...(invoice.refundNote ? [{ label: "Refund note", value: invoice.refundNote }] : []),
          ]}
        />

        {isOpen && (
          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] sm:items-end gap-2">
            <Select
              label="Payment received by"
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={(Object.keys(paymentMethodLabels) as PaymentMethod[]).map((m) => ({ label: paymentMethodLabels[m], value: m }))}
            />
            <Input
              label="Reference (optional)"
              placeholder={method === "upi" ? "12-digit UPI reference" : "Receipt or cheque no."}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <Button size="md" disabled={busy} onClick={() => void act(() => onMarkPaid(invoice.id, method, reference.trim()))} className="text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark as Paid
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button variant="ghost" size="sm" disabled title="PDF invoices are not built yet.">
            <Download className="w-3.5 h-3.5" /> PDF not built yet
          </Button>
          {invoice.payUrl && (
            <>
              <Button variant="outline" size="sm" onClick={() => onCopyLink(invoice)}>
                <Link2 className="w-3.5 h-3.5" /> Copy Payment Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open(invoice.payUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="w-3.5 h-3.5" /> Open Pay Page
              </Button>
            </>
          )}
          {isOpen && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || invoice.hasChat === false}
                title={invoice.hasChat === false ? "They have never chatted with you - call them instead." : undefined}
                onClick={() => void act(() => onRemind(invoice))}
              >
                <Send className="w-3.5 h-3.5 text-indigo-400" /> Send Reminder
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={handleCancel} className="hover:text-rose-300">
                <XCircle className="w-3.5 h-3.5 text-rose-400" /> Cancel Invoice
              </Button>
            </>
          )}
          {invoice.status === "paid" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleRefund}>
              <Undo2 className="w-3.5 h-3.5 text-amber-400" /> Record Refund
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

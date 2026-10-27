"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Smartphone, ShieldCheck, Clock } from "lucide-react";
import { Badge, Button, Input, QrCodeGraphic } from "@/components/ui";
import type { PublicInvoice } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { payApi, PayApiError } from "@/lib/api/pay";

/**
 * The page a customer opens from the link in their chat.
 *
 * It shows a real UPI QR code (scan from a laptop) and a "Pay with a UPI app"
 * button (tap on a phone). The money goes straight to the business. Pressing
 * "I've paid" only TELLS the business; the invoice stays unpaid until they
 * check their account and mark it paid.
 */
export function PayPage({ token }: { token: string }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvoice(await payApi.get(token));
      setError(null);
    } catch (cause) {
      setError(cause instanceof PayApiError ? cause.message : "This payment link could not be opened.");
    }
  }, [token]);

  const payable = invoice?.status === "pending" || invoice?.status === "overdue";

  useEffect(() => {
    // `load` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // While it is unpaid, check every 20 seconds, so "Paid" appears here as soon
    // as the business confirms - without the customer reloading.
    if (!payable) return;
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [payable, load]);

  const claim = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaiming(true);
    setClaimError(null);
    try {
      setInvoice(await payApi.claim(token, reference.trim()));
    } catch (cause) {
      setClaimError(cause instanceof PayApiError ? cause.message : "Could not send that. Please try again.");
    } finally {
      setClaiming(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-gray-300 text-center py-10">{error}</p>
      </Shell>
    );
  }
  if (!invoice) {
    return (
      <Shell>
        <p className="text-sm text-gray-500 text-center py-10">Loading your invoice…</p>
      </Shell>
    );
  }

  const status = invoiceStatusMeta[invoice.status];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{invoice.businessName}</div>
          <div className="text-sm text-gray-300">
            {invoice.customerFirstName ? `${invoice.customerFirstName}, here is` : "Here is"} invoice{" "}
            <span className="font-mono text-white">{invoice.invoiceNumber}</span>
          </div>
          <div className="text-4xl font-bold text-white pt-2">{formatCurrency(invoice.amount)}</div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            {payable && (
              <span className={invoice.status === "overdue" ? "text-xs text-rose-300" : "text-xs text-gray-400"}>
                {invoice.status === "overdue" ? "was due" : "due by"} {formatDate(invoice.dueDate)}
              </span>
            )}
          </div>
        </div>

        <ul className="rounded-xl border border-gray-800 divide-y divide-gray-800 text-sm">
          {invoice.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3 px-3 py-2">
              <span className="text-gray-200">
                {item.quantity > 1 && <span className="text-gray-500">{item.quantity} × </span>}
                {item.description}
              </span>
              <span className="font-medium text-white whitespace-nowrap">{formatCurrency(item.total)}</span>
            </li>
          ))}
        </ul>

        {invoice.status === "paid" && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <div className="text-sm font-semibold text-emerald-300">Paid{invoice.paidDate ? ` on ${formatDate(invoice.paidDate)}` : ""}. Thank you!</div>
          </div>
        )}

        {invoice.status === "cancelled" && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            This invoice was cancelled. You do not need to pay it.
          </p>
        )}

        {invoice.status === "refunded" && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            This invoice was paid and then refunded.
          </p>
        )}

        {payable && invoice.upiLink && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              <QrCodeGraphic value={invoice.upiLink} svgClassName="w-52 h-52" label="Scan with any UPI app" />
              <p className="text-[11px] text-gray-400 text-center">
                Paying <span className="text-white font-medium">{invoice.payeeName}</span>
                {invoice.upiId && <> (<span className="font-mono">{invoice.upiId}</span>)</>}. Check the name in your app before you pay.
              </p>
            </div>
            {/* On a phone this opens GPay, PhonePe, Paytm or BHIM with the amount filled in. */}
            <a
              href={invoice.upiLink}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-3 transition-colors"
            >
              <Smartphone className="w-4 h-4" /> Pay {formatCurrency(invoice.amount)} with a UPI app
            </a>
          </div>
        )}

        {payable && !invoice.upiLink && (
          <p className="rounded-xl border border-gray-800 p-4 text-sm text-gray-300 text-center">
            Online payment is not set up for {invoice.businessName} yet. Please pay at the front desk.
          </p>
        )}

        {payable && invoice.customerReported && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200 flex gap-2">
            <Clock className="w-4 h-4 flex-shrink-0 text-amber-400" />
            <span>
              Thanks, {invoice.businessName} has been told you paid. It will show as paid here once they have checked it arrived.
            </span>
          </div>
        )}

        {payable && !invoice.customerReported && invoice.upiLink && (
          <form onSubmit={(e) => void claim(e)} className="rounded-xl border border-gray-800 p-3 space-y-2">
            <div className="text-xs font-semibold text-white">Already paid?</div>
            <Input
              label="UPI reference (optional)"
              placeholder="The 12-digit number your UPI app shows"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={60}
            />
            <Button type="submit" size="sm" variant="outline" disabled={claiming} className="w-full">
              {claiming ? "Sending…" : "I've paid"}
            </Button>
            <p className="text-[11px] text-gray-500">
              This tells {invoice.businessName} to check their account. It stays unpaid until they confirm.
            </p>
            {claimError && (
              <p role="alert" className="text-xs text-rose-400">
                {claimError}
              </p>
            )}
          </form>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-gray-500 justify-center text-center">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          Your payment goes directly to {invoice.businessName} by UPI. This page never sees your bank details.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900/70 p-5 shadow-xl">{children}</div>
    </main>
  );
}

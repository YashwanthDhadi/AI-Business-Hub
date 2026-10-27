import React from "react";
import { Receipt, ChevronRight, Send, BadgeInfo } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { PaymentInvoice } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { invoiceStatusMeta } from "@/lib/status";
import { paymentMethodLabels } from "../constants";

interface InvoiceTableProps {
  invoices: PaymentInvoice[];
  onSelect: (invoice: PaymentInvoice) => void;
  onRemind: (invoice: PaymentInvoice) => void;
}

const isOpen = (inv: PaymentInvoice) => inv.status === "pending" || inv.status === "overdue";

/** A reminder goes into the customer's chat, so it needs one. */
const canRemind = (inv: PaymentInvoice) => isOpen(inv) && inv.hasChat !== false;

function DueCell({ invoice }: { invoice: PaymentInvoice }) {
  if (invoice.status === "paid" && invoice.paidDate) {
    return <span className="text-gray-400">Paid {formatDate(invoice.paidDate, { month: "short", day: "numeric" })}</span>;
  }
  if (invoice.status === "cancelled") {
    return <span className="text-gray-500">Cancelled</span>;
  }
  return (
    <span className={invoice.status === "overdue" ? "text-rose-300" : "text-gray-300"}>
      {formatDate(invoice.dueDate, { month: "short", day: "numeric" })}
    </span>
  );
}

/** The customer says they paid. Shown until the owner checks and marks it paid. */
function ClaimBadge({ invoice }: { invoice: PaymentInvoice }) {
  if (!invoice.customerReportedAt || !isOpen(invoice)) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-300" title="The customer says they have paid. Check your UPI app or bank, then mark it paid.">
      <BadgeInfo className="w-3 h-3" /> Says paid
    </span>
  );
}

export function InvoiceTable({ invoices, onSelect, onRemind }: InvoiceTableProps) {
  if (invoices.length === 0) {
    return <EmptyState icon={Receipt} title="No Invoices Found" description="No invoices match your search or filters." />;
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      <ul className="md:hidden divide-y divide-gray-800/80">
        {invoices.map((inv) => (
          <li key={inv.id}>
            <button type="button" onClick={() => onSelect(inv)} className="w-full text-left p-4 space-y-1.5 hover:bg-gray-800/40 cursor-pointer">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white truncate">{inv.customerName}</span>
                <span className="text-sm font-bold text-white">{formatCurrency(inv.amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                <span className="font-mono">{inv.invoiceNumber}</span>
                <span className="flex items-center gap-2">
                  <ClaimBadge invoice={inv} />
                  <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                </span>
              </div>
              <div className="text-[11px] text-gray-400 truncate">
                {inv.items[0]?.description} • Due <DueCell invoice={inv} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Invoice</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4 hidden lg:table-cell">Description</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Due / Paid</th>
              <th className="py-3 px-4 hidden xl:table-cell">Method</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {invoices.map((inv) => (
              <tr key={inv.id} onClick={() => onSelect(inv)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                <td className="py-3.5 px-4 font-mono text-gray-300 whitespace-nowrap">{inv.invoiceNumber}</td>
                <td className="py-3.5 px-4">
                  <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{inv.customerName}</div>
                  <div className="text-[11px] text-gray-500">{inv.customerEmail}</div>
                </td>
                <td className="py-3.5 px-4 hidden lg:table-cell max-w-[14rem] truncate text-gray-300">{inv.items[0]?.description}</td>
                <td className="py-3.5 px-4 text-right font-semibold text-white">{formatCurrency(inv.amount)}</td>
                <td className="py-3.5 px-4">
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                    <ClaimBadge invoice={inv} />
                  </div>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <DueCell invoice={inv} />
                </td>
                <td className="py-3.5 px-4 hidden xl:table-cell text-gray-400">
                  {inv.paymentMethod ? paymentMethodLabels[inv.paymentMethod] : "—"}
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {isOpen(inv) && (
                      <button
                        type="button"
                        onClick={() => onRemind(inv)}
                        disabled={!canRemind(inv)}
                        title={canRemind(inv) ? "Post a reminder in their chat" : "They have never chatted with you - call them instead"}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-indigo-300 hover:text-white hover:bg-indigo-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        <Send className="w-3 h-3" /> Remind
                      </button>
                    )}
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

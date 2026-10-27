import React from "react";
import { Users, Mail, Phone, ChevronRight } from "lucide-react";
import { Avatar, Badge, EmptyState } from "@/components/ui";
import type { CustomerSummary } from "@/types";
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils";
import { customerStatusMeta } from "@/lib/status";

/** A customer plus the booking counts the table shows - exactly what the API returns. */
export type CustomerRow = CustomerSummary;

interface CustomerTableProps {
  customers: CustomerRow[];
  onSelect: (customer: CustomerRow) => void;
}

export function CustomerTable({ customers, onSelect }: CustomerTableProps) {
  if (customers.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No Customers Found"
        description="No customers matched your search or filters. Try a different name, or add a new customer."
      />
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
      {/* Mobile cards */}
      <ul className="md:hidden divide-y divide-gray-800/80">
        {customers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-800/40 transition-colors cursor-pointer"
            >
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                  <Badge variant={customerStatusMeta[c.status].variant}>{customerStatusMeta[c.status].label}</Badge>
                </div>
                <div className="text-[11px] text-gray-400 truncate">{formatPhone(c.phone) || c.email || "No contact details"}</div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-400">
                  <span>
                    Spend <span className="text-white font-medium">{formatCurrency(c.totalSpend)}</span>
                  </span>
                  <span>{c.bookingsCount} bookings</span>
                  <span>Last visit {c.lastVisit ? formatDate(c.lastVisit, { month: "short", day: "numeric" }) : "—"}</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Contact</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Total Spend</th>
              <th className="py-3 px-4 text-right">Bookings</th>
              <th className="py-3 px-4">Last Visit</th>
              <th className="py-3 px-4 hidden xl:table-cell">Tags</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80 text-gray-200">
            {customers.map((c) => (
              <tr key={c.id} onClick={() => onSelect(c)} className="hover:bg-gray-800/40 transition-colors cursor-pointer group">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">{c.name}</div>
                      {c.membershipPlan && <div className="text-[11px] text-gray-500">{c.membershipPlan}</div>}
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5 text-gray-300">
                    <Phone className="w-3 h-3 text-gray-500" /> {formatPhone(c.phone) || "—"}
                  </div>
                  {c.email && (
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
                      <Mail className="w-3 h-3 text-gray-500" /> {c.email}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-4">
                  <Badge variant={customerStatusMeta[c.status].variant}>{customerStatusMeta[c.status].label}</Badge>
                </td>
                <td className="py-3.5 px-4 text-right font-semibold text-white">{formatCurrency(c.totalSpend)}</td>
                <td className="py-3.5 px-4 text-right">
                  {c.bookingsCount}
                  {c.upcomingCount > 0 && <span className="block text-[10px] text-indigo-300">{c.upcomingCount} upcoming</span>}
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap text-gray-300">
                  {c.lastVisit ? formatDate(c.lastVisit, { month: "short", day: "numeric", year: "numeric" }) : "No visits yet"}
                </td>
                <td className="py-3.5 px-4 hidden xl:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 2).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 whitespace-nowrap">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300 inline" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

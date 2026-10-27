import React from "react";
import Link from "next/link";
import { Calendar, CreditCard, Users, AlertTriangle, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui";

interface OverviewStatCardsProps {
  bookingsCount: number;
  pendingTodayCount?: number;
  pendingPaymentsAmount: number;
  pendingInvoicesCount: number;
  customersCount: number;
  lowStockCount: number;
}

export function OverviewStatCards({
  bookingsCount,
  pendingTodayCount = 0,
  pendingPaymentsAmount,
  pendingInvoicesCount,
  customersCount,
  lowStockCount,
}: OverviewStatCardsProps) {
  const cards = [
    {
      title: "Today's Bookings",
      value: bookingsCount.toString(),
      subtext:
        pendingTodayCount === 0
          ? "All sessions confirmed"
          : `${pendingTodayCount} session${pendingTodayCount === 1 ? "" : "s"} pending confirmation`,
      icon: Calendar,
      href: "/dashboard/bookings",
      badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      accent: "emerald",
    },
    {
      title: "Pending Payments",
      value: `$${pendingPaymentsAmount}`,
      subtext: `${pendingInvoicesCount} invoices pending follow-up`,
      icon: CreditCard,
      href: "/dashboard/payments",
      badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      accent: "amber",
    },
    {
      title: "Active Customers",
      value: customersCount.toString(),
      subtext: "+6 new members this week",
      icon: Users,
      href: "/dashboard/customers",
      badgeColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
      accent: "indigo",
    },
    {
      title: "Inventory Alerts",
      value: lowStockCount.toString(),
      subtext: "Items below restock threshold",
      icon: AlertTriangle,
      href: "/dashboard/inventory",
      badgeColor: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      accent: "rose",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <Link key={card.title} href={card.href} className="group">
            <Card className="h-full hover:border-gray-700 transition-all duration-200 hover:-translate-y-0.5">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-medium text-gray-400">
                    {card.title}
                  </span>
                  <div className="text-2xl font-bold text-white mt-1.5 tracking-tight">
                    {card.value}
                  </div>
                </div>
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-transform group-hover:scale-105 ${card.badgeColor}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-xs text-gray-400">
                <span>{card.subtext}</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-gray-500 group-hover:text-white transition-colors" />
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

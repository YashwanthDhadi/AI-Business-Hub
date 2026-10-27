import React from "react";
import Link from "next/link";
import { MessageSquare, Calendar, CreditCard, Package, ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui";

export function RecentActivity() {
  const activities = [
    {
      id: "act-1",
      type: "booking",
      icon: Calendar,
      iconColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      title: "Booking confirmed via AI Chat",
      description: "Michael Chen booked Body Composition Assessment for tomorrow 11:00 AM",
      time: "15m ago",
      href: "/dashboard/bookings",
    },
    {
      id: "act-2",
      type: "payment",
      icon: CreditCard,
      iconColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
      title: "Payment received (₹100.00)",
      description: "Sarah Jenkins paid invoice #INV-1003 for Monthly Yoga Unlimited Pass",
      time: "2h ago",
      href: "/dashboard/payments",
    },
    {
      id: "act-3",
      type: "chat",
      icon: MessageSquare,
      iconColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      title: "Customer chat inquiry resolved",
      description: "Visitor asked about Friday opening hours; AI answered and shared timetable",
      time: "4h ago",
      href: "/dashboard/customer-chat",
    },
    {
      id: "act-4",
      type: "inventory",
      icon: Package,
      iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      title: "Inventory threshold alert",
      description: "Stainless Steel Shaker Bottle reached 2 remaining units",
      time: "Yesterday",
      href: "/dashboard/inventory",
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Recent Business Activity</CardTitle>
          <p className="text-xs text-gray-400">
            Real-time feed of automated customer actions and operations
          </p>
        </div>
        <Link
          href="/dashboard/reports"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1"
        >
          View Full Logs <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </CardHeader>

      <div className="space-y-3 pt-2">
        {activities.map((act) => {
          const Icon = act.icon;
          return (
            <Link
              key={act.id}
              href={act.href}
              className="flex items-start gap-3 p-3 rounded-xl border border-gray-800/80 bg-gray-950/40 hover:bg-gray-900/60 hover:border-gray-700 transition-colors group"
            >
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${act.iconColor}`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                    {act.title}
                  </h4>
                  <span className="text-[10px] text-gray-500 flex-shrink-0 ml-2">
                    {act.time}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 leading-normal">
                  {act.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

import React from "react";
import Link from "next/link";
import { UserPlus, CalendarPlus, CreditCard, UploadCloud, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui";

export function QuickActions() {
  const actions = [
    {
      label: "Create Booking",
      desc: "Reserve an appointment slot",
      icon: CalendarPlus,
      href: "/dashboard/bookings",
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    },
    {
      label: "Add Customer",
      desc: "Register a new client profile",
      icon: UserPlus,
      href: "/dashboard/customers",
      color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    },
    {
      label: "Record Payment",
      desc: "Generate invoice or payment link",
      icon: CreditCard,
      href: "/dashboard/payments",
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      label: "Upload Document",
      desc: "Add knowledge base or waiver PDF",
      icon: UploadCloud,
      href: "/dashboard/documents",
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    },
    {
      label: "View Reports",
      desc: "Check revenue and weekly analytics",
      icon: BarChart3,
      href: "/dashboard/reports",
      color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Quick Actions
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {actions.map((act) => {
          const Icon = act.icon;
          return (
            <Link key={act.label} href={act.href}>
              <Card className="p-3.5 hover:border-gray-700 hover:bg-gray-900/80 transition-all hover:-translate-y-0.5 group">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center mb-2.5 ${act.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">
                  {act.label}
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">
                  {act.desc}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

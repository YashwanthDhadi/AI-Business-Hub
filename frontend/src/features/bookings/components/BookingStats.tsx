import React from "react";
import { CalendarCheck, CalendarClock, Clock, CheckCircle2 } from "lucide-react";
import { StatCard } from "@/components/ui";
import type { BookingQuickView } from "../types";

interface BookingStatsProps {
  today: number;
  upcoming: number;
  pending: number;
  completed: number;
  activeView: BookingQuickView | null;
  onSelectView: (view: BookingQuickView) => void;
}

export function BookingStats({ today, upcoming, pending, completed, activeView, onSelectView }: BookingStatsProps) {
  const stats = [
    { view: "today" as const, label: "Today's Bookings", value: today, icon: CalendarCheck, tone: "indigo" as const, hint: "Scheduled for today" },
    { view: "upcoming" as const, label: "Upcoming", value: upcoming, icon: CalendarClock, tone: "blue" as const, hint: "After today" },
    { view: "pending" as const, label: "Pending Confirmation", value: pending, icon: Clock, tone: "amber" as const, hint: "Waiting for your OK" },
    { view: "completed" as const, label: "Completed", value: completed, icon: CheckCircle2, tone: "emerald" as const, hint: "Sessions delivered" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((s) => (
        <StatCard
          key={s.view}
          label={s.label}
          value={s.value}
          icon={s.icon}
          tone={s.tone}
          hint={s.hint}
          active={activeView === s.view}
          onClick={() => onSelectView(s.view)}
        />
      ))}
    </div>
  );
}

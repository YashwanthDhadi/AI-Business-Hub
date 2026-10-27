import React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./Card";
import { cn } from "@/lib/utils";

export type StatTone = "indigo" | "emerald" | "amber" | "rose" | "purple" | "blue" | "gray";

export const toneStyles: Record<StatTone, string> = {
  indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  gray: "text-gray-300 bg-gray-800 border-gray-700",
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Compact metric card (same look as the Bookings summary cards). */
export function StatCard({ label, value, icon: Icon, tone = "indigo", hint, active, onClick, className }: StatCardProps) {
  const content = (
    <Card
      className={cn(
        "p-4 h-full text-left transition-colors",
        onClick && "hover:border-gray-700 cursor-pointer",
        active && "border-indigo-500/60 bg-indigo-950/20",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-gray-400 font-medium block leading-tight">{label}</span>
          <span className="text-xl sm:text-2xl font-bold text-white block mt-1 tracking-tight">{value}</span>
        </div>
        <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0", toneStyles[tone])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      {hint && <div className="mt-2 text-[11px] text-gray-500 truncate">{hint}</div>}
    </Card>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="block w-full text-left rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {content}
      </button>
    );
  }
  return content;
}

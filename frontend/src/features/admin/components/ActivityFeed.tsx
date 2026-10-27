import React from "react";
import { Building2, CreditCard, Cpu, ShieldAlert, Server } from "lucide-react";
import { Badge } from "@/components/ui";
import type { PlatformActivityEvent } from "@/types";
import { cn, formatDate } from "@/lib/utils";
import { severityMeta } from "@/lib/status";

const categoryIcons: Record<PlatformActivityEvent["category"], typeof Server> = {
  tenant: Building2,
  billing: CreditCard,
  ai: Cpu,
  security: ShieldAlert,
  system: Server,
};

export function ActivityFeed({ events, showBadges = false }: { events: PlatformActivityEvent[]; showBadges?: boolean }) {
  if (events.length === 0) return <p className="text-sm text-gray-500 py-6 text-center">No events match.</p>;
  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const Icon = categoryIcons[e.category];
        const meta = severityMeta[e.severity];
        return (
          <li key={e.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-800/80 bg-gray-950/40">
            <div
              className={cn(
                "w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0",
                e.severity === "critical"
                  ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                  : e.severity === "warning"
                    ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                    : e.severity === "success"
                      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : "text-gray-300 bg-gray-800 border-gray-700"
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-200">{e.message}</p>
              <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-500 mt-0.5 font-mono">
                <span>{formatDate(e.at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC</span>
                <span>•</span>
                <span>{e.actor}</span>
                <span>•</span>
                <span className="uppercase">{e.category}</span>
              </div>
            </div>
            {showBadges && <Badge variant={meta.variant}>{meta.label}</Badge>}
          </li>
        );
      })}
    </ul>
  );
}

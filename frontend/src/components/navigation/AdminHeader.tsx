"use client";

import React from "react";
import Link from "next/link";
import { Menu, Activity, Search } from "lucide-react";
import { mockAiAgentStatuses, mockServiceHealth } from "@/data/mock-admin";

export function AdminHeader({ onMobileMenuToggle }: { onMobileMenuToggle: () => void }) {
  const degraded = [...mockAiAgentStatuses, ...mockServiceHealth].filter((s) => s.status !== "operational").length;

  return (
    <header className="sticky top-0 z-20 w-full border-b border-gray-800 bg-gray-950/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onMobileMenuToggle} className="md:hidden text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-900" aria-label="Toggle menu">
          <Menu className="w-5 h-5" />
        </button>
        <Link
          href="/admin/ai-system"
          className={
            degraded > 0
              ? "flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium whitespace-nowrap"
              : "flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium whitespace-nowrap"
          }
        >
          <Activity className="w-3.5 h-3.5" />
          {degraded > 0 ? `${degraded} component${degraded === 1 ? "" : "s"} degraded` : "All systems operational"}
        </Link>
      </div>

      <div className="flex-1 max-w-sm hidden md:block">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Search tenants and users"
            placeholder="Search tenants, users, request IDs..."
            className="w-full bg-gray-900/80 border border-gray-800 rounded-lg pl-8 pr-4 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/60 font-mono"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pl-2 border-l border-gray-800">
        <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white text-xs font-bold">SA</div>
        <div className="hidden lg:block">
          <span className="text-xs font-semibold text-white block leading-tight">System Administrator</span>
          <span className="text-[10px] text-gray-400 block leading-tight font-mono">admin@aibusinesshub.com</span>
        </div>
      </div>
    </header>
  );
}

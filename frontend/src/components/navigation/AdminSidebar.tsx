"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, Users, Cpu, BarChart3, ScrollText, Settings, Shield, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { mockPlatformHealth } from "@/data/mock-admin";

interface AdminSidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const navigation = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard, exact: true },
  { name: "Businesses", href: "/admin/businesses", icon: Building2 },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "AI System", href: "/admin/ai-system", icon: Cpu },
  { name: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { name: "Activity", href: "/admin/activity", icon: ScrollText },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

export function AdminSidebar({ mobileOpen, onMobileClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  const content = (
    <div className="flex flex-col h-full justify-between bg-gray-950 border-r border-gray-800/80 w-64 p-4 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between pb-5 border-b border-gray-800">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-white block tracking-tight">AI Business Hub</span>
              <span className="text-[10px] text-amber-400/80 font-medium uppercase tracking-wider block">Platform Admin</span>
            </div>
          </Link>
          <button onClick={onMobileClose} className="md:hidden text-gray-400 hover:text-white p-1 rounded-lg" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 p-2.5 rounded-xl bg-gray-900/80 border border-gray-800/80 text-[11px] space-y-1 font-mono">
          <div className="flex justify-between text-gray-400">
            <span>env</span>
            <span className="text-emerald-400">production</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>uptime</span>
            <span className="text-white">{mockPlatformHealth.platformUptimePercent}%</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>release</span>
            <span className="text-white">v1.8.2</span>
          </div>
        </div>

        <nav className="mt-5 space-y-1" aria-label="Admin">
          {navigation.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onMobileClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all select-none",
                  active ? "bg-amber-500/15 text-amber-200 border border-amber-500/30" : "text-gray-400 hover:text-white hover:bg-gray-900 border border-transparent"
                )}
              >
                <item.icon className={cn("w-4 h-4", active ? "text-amber-300" : "text-gray-400")} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="pt-4 border-t border-gray-800 space-y-1">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-900">
          <LayoutDashboard className="w-4 h-4" /> View Owner Dashboard
        </Link>
        <Link href="/auth/select-role" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-rose-400 hover:bg-rose-500/10">
          <LogOut className="w-4 h-4" /> Switch Role / Sign Out
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden md:flex md:flex-shrink-0 h-screen sticky top-0 z-30">{content}</aside>
      {mobileOpen && <div className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm" onClick={onMobileClose} />}
      <div
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 w-64 md:hidden transition-transform duration-300 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {content}
      </div>
    </>
  );
}

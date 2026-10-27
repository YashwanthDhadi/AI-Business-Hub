"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Calendar,
  Users,
  CreditCard,
  Package,
  FileText,
  TrendingUp,
  MessageSquare,
  Megaphone,
  Settings,
  Bot,
  ExternalLink,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface OwnerSidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function OwnerSidebar({ mobileOpen, onMobileClose }: OwnerSidebarProps) {
  const pathname = usePathname();

  const navigation = [
    { name: "Home", href: "/dashboard", icon: Home, exact: true },
    { name: "Bookings", href: "/dashboard/bookings", icon: Calendar },
    { name: "Customers", href: "/dashboard/customers", icon: Users },
    { name: "Payments", href: "/dashboard/payments", icon: CreditCard },
    { name: "Inventory", href: "/dashboard/inventory", icon: Package },
    { name: "Documents", href: "/dashboard/documents", icon: FileText },
    { name: "Reports", href: "/dashboard/reports", icon: TrendingUp },
    { name: "Customer Chat", href: "/dashboard/customer-chat", icon: MessageSquare },
    { name: "Communication", href: "/dashboard/communication", icon: Megaphone },
    { name: "Settings", href: "/dashboard/settings", icon: Settings },
  ];

  const isLinkActive = (href: string, exact: boolean = false) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between bg-gray-950 border-r border-gray-800/80 w-64 p-4 overflow-y-auto">
      {/* Brand & Business Header */}
      <div>
        <div className="flex items-center justify-between pb-5 border-b border-gray-800">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md shadow-indigo-600/20 group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-white block tracking-tight">
                AI Business Hub
              </span>
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider block">
                Business Operating OS
              </span>
            </div>
          </Link>
          {/* Mobile close button */}
          <button
            onClick={onMobileClose}
            className="md:hidden text-gray-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Business Selector Pill */}
        <div className="mt-4 p-2.5 rounded-xl bg-gray-900/80 border border-gray-800/80 flex items-center justify-between">
          <div className="truncate">
            <span className="text-xs font-bold text-white block truncate">
              FitZone Fitness Club
            </span>
            <span className="text-[10px] text-indigo-400 block font-medium">
              Gym & Wellness
            </span>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="AI active" />
        </div>

        {/* Navigation Menu */}
        <nav className="mt-5 space-y-1">
          {navigation.map((item) => {
            const active = isLinkActive(item.href, item.exact);
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all select-none",
                  active
                    ? "bg-indigo-600 text-white shadow-sm font-semibold"
                    : "text-gray-400 hover:text-white hover:bg-gray-900"
                )}
              >
                <Icon className={cn("w-4 h-4", active ? "text-white" : "text-gray-400")} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Info & Customer Chat Preview */}
      <div className="pt-4 border-t border-gray-800 space-y-3">
        {/* Customer Chat Link Card */}
        <div className="p-3 rounded-xl bg-gray-900/60 border border-gray-800 text-xs space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium">
            <span>Customer Chat</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
              Live
            </span>
          </div>
          <Link
            href="/chat/fitzone"
            target="_blank"
            className="text-[11px] font-mono text-indigo-300 hover:text-indigo-200 truncate flex items-center gap-1 group"
          >
            <span className="truncate">/chat/fitzone</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Sign Out */}
        <Link
          href="/auth/select-role"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Switch Role / Sign Out</span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="hidden md:flex md:flex-shrink-0 h-screen sticky top-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-Over Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm"
          onClick={onMobileClose}
        />
      )}

      {/* Mobile Slide-Over Sidebar */}
      <div
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 w-64 md:hidden transition-transform duration-300 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Bell, Sparkles, ExternalLink, MessageSquare, Settings, LogOut, Repeat, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface DashboardHeaderProps {
  onMobileMenuToggle: () => void;
}

type Popover = "notifications" | "user" | null;

export function DashboardHeader({ onMobileMenuToggle }: DashboardHeaderProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Popover>(null);
  const [askText, setAskText] = useState("");
  const [unread, setUnread] = useState(true);

  const notifications = [
    { id: "1", title: "New booking via Customer Chat", desc: "Michael Chen booked Body Assessment", time: "10m ago", href: "/dashboard/bookings" },
    { id: "2", title: "Payment overdue", desc: "Jessica Adams invoice INV-2026-004 is overdue", time: "1h ago", href: "/dashboard/payments" },
    { id: "3", title: "Low stock alert", desc: "Pure Whey Chocolate has only 3 bottles left", time: "2h ago", href: "/dashboard/inventory" },
  ];

  const toggle = (p: Popover) => setOpen((cur) => (cur === p ? null : p));

  const submitAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = askText.trim();
    if (!q) return;
    setAskText("");
    router.push(`/dashboard?ask=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-20 w-full border-b border-gray-800 bg-gray-950/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
      {/* Click-away layer for open popovers */}
      {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(null)} />}

      {/* Left side: Mobile Toggle & Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-900"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI Assistant Active</span>
          </div>
        </div>
      </div>

      {/* Middle: "Ask AI" prompt bar (answers appear on the Home dashboard) */}
      <form onSubmit={submitAsk} className="flex-1 max-w-md hidden md:block">
        <div className="relative">
          <Sparkles className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            aria-label="Ask AI about your business"
            placeholder="Ask AI anything... (e.g. 'Show today's bookings', 'Who hasn't paid?')"
            className="w-full bg-gray-900/80 border border-gray-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </form>

      {/* Right side: Public chat link, notifications & user profile */}
      <div className="flex items-center gap-2 sm:gap-3 relative z-30">
        <Link href="/chat/fitzone" target="_blank" className="hidden sm:inline-flex">
          <Button variant="outline" size="sm" className="text-xs">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
            Customer View
            <ExternalLink className="w-3 h-3 text-gray-500" />
          </Button>
        </Link>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => {
              toggle("notifications");
              setUnread(false);
            }}
            className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-900 transition-colors cursor-pointer"
            aria-label="View notifications"
            aria-expanded={open === "notifications"}
          >
            <Bell className="w-4 h-4" />
            {unread && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500" />}
          </button>

          {open === "notifications" && (
            <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                <span className="text-xs font-semibold text-white">Notifications</span>
                <span className="text-[10px] text-gray-500">All caught up</span>
              </div>
              <div className="mt-2 space-y-2">
                {notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(null)}
                    className="block p-2 rounded-lg bg-gray-950/60 border border-gray-800/80 text-xs space-y-0.5 hover:border-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-200">{n.title}</span>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">{n.time}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-normal">{n.desc}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggle("user")}
            aria-expanded={open === "user"}
            aria-label="Account menu"
            className="flex items-center gap-2 pl-2 border-l border-gray-800 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">Y</div>
            <div className="hidden lg:block text-left">
              <span className="text-xs font-semibold text-white block leading-tight">Yashwanth</span>
              <span className="text-[10px] text-gray-400 block leading-tight">Business Owner</span>
            </div>
            <ChevronDown className={cn("w-3.5 h-3.5 text-gray-500 hidden sm:block transition-transform", open === "user" && "rotate-180")} />
          </button>

          {open === "user" && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-800 bg-gray-900 p-1.5 shadow-2xl">
              <div className="px-2.5 py-2 border-b border-gray-800 mb-1">
                <div className="text-xs font-semibold text-white">Yashwanth</div>
                <div className="text-[11px] text-gray-400 truncate">yash@fitzone.com</div>
              </div>
              {[
                { label: "Business Settings", href: "/dashboard/settings", icon: Settings },
                { label: "Open Customer Chat", href: "/chat/fitzone", icon: MessageSquare, external: true },
                { label: "Switch Role", href: "/auth/select-role", icon: Repeat },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  onClick={() => setOpen(null)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-gray-300 hover:text-white hover:bg-gray-800"
                >
                  <item.icon className="w-3.5 h-3.5 text-gray-500" />
                  {item.label}
                </Link>
              ))}
              <Link
                href="/business/login"
                onClick={() => setOpen(null)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-rose-300 hover:bg-rose-500/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

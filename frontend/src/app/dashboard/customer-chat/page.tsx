"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, MessagesSquare, HelpCircle, Sun } from "lucide-react";
import { PageHeader, StatCard, SearchInput, SegmentedTabs, Toast } from "@/components/ui";
import { ChatLinkCard } from "@/features/customer-chat/components/ChatLinkCard";
import { ConversationList, ConversationDetail } from "@/features/customer-chat/components/ConversationViewer";
import { ConversationSession } from "@/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import {
  dashboardApi,
  HubError,
  LIVE_BUSINESS_ID,
  type DashboardStats,
} from "@/lib/api/dashboard";
import { LOCALE } from "@/lib/constants";

type Filter = "all" | "needs_reply" | "bookings" | "questions";

export default function CustomerChatPage() {
  // LIVE_BUSINESS_ID is a build-time constant, so the "not configured" state is
  // known at construction — no effect needed, and no cascading render.
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured
      ? null
      : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  /** Refetch everything. Also runs on a 6-second poll so new chats appear. */
  const refresh = useCallback(async () => {
    try {
      const [rows, live] = await Promise.all([dashboardApi.conversations(), dashboardApi.stats()]);
      setConversations(rows);
      setStats(live);
      setLoadError(null);
      // Only picks a default on first load — a poll must never yank the
      // selection away while the owner is reading.
      setSelectedId(
        (current) =>
          current ?? rows.find((c) => c.status === "escalated")?.id ?? rows[0]?.id ?? null,
      );
    } catch (error) {
      setLoadError(error instanceof HubError ? error.message : "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it touches state, so nothing is set synchronously
    // here — but the lint rule cannot see past the async boundary. Subscribing
    // to an external system and seeding it once is exactly what effects are
    // for, so this is the right place for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  const sorted = useMemo(
    () => [...conversations].sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")),
    [conversations],
  );

  const counts = {
    all: sorted.length,
    needs_reply: sorted.filter((c) => c.status === "escalated").length,
    bookings: sorted.filter((c) => c.outcome === "booking_created").length,
    questions: sorted.filter((c) => c.status === "resolved").length,
  };

  const filtered = sorted.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (c.customerName ?? "").toLowerCase().includes(q) ||
      (c.topic ?? "").toLowerCase().includes(q) ||
      c.messages.some((m) => m.text.toLowerCase().includes(q));
    const matchesFilter =
      filter === "all" ||
      (filter === "needs_reply" && c.status === "escalated") ||
      (filter === "bookings" && c.outcome === "booking_created") ||
      (filter === "questions" && c.status === "resolved");
    return matchesSearch && matchesFilter;
  });

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const handleReply = async (id: string, text: string) => {
    try {
      const updated = await dashboardApi.reply(id, text);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
      showToast("Reply sent — the customer sees it in their chat window.");
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not send the reply.", "error");
    }
  };

  const handleResolve = async (id: string) => {
    try {
      const updated = await dashboardApi.resolve(id);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
      showToast("Conversation resolved. The assistant is back in control.");
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not resolve.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquare}
        title="Customer Chat"
        description="Your 24/7 assistant that answers customers. See every conversation here."
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      )}

      {stats && (
        <ChatLinkCard
          businessName={stats.business.name}
          slug={stats.business.chatSlug}
          onCopied={() => showToast("Chat link copied.")}
        />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Total Conversations"
          value={(stats?.totalConversations ?? 0).toLocaleString(LOCALE)}
          icon={MessagesSquare}
          tone="indigo"
          hint="Since you went live"
        />
        <StatCard
          label="Today's Conversations"
          value={stats?.todayConversations ?? 0}
          icon={Sun}
          tone="blue"
          hint={`${counts.needs_reply} waiting for your reply`}
        />
        <StatCard
          label="Needs Your Reply"
          value={stats?.openRequests ?? 0}
          icon={MessageSquare}
          tone="amber"
          hint="Escalations and callbacks"
        />
        <StatCard
          label="Handled Without You"
          value={stats?.questionsAnswered ?? 0}
          icon={HelpCircle}
          tone="purple"
          hint="The assistant answered alone"
        />
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4" aria-label="Conversations">
        <div className={cn("lg:col-span-2 space-y-3", mobileDetail && "hidden lg:block")}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent Conversations</h2>
          </div>
          <SegmentedTabs<Filter>
            tabs={[
              { label: "All", value: "all", count: counts.all },
              { label: "Needs Reply", value: "needs_reply", count: counts.needs_reply },
              { label: "Resolved", value: "questions", count: counts.questions },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, topic or message..." />
          <div className="lg:max-h-[34rem] lg:overflow-y-auto lg:pr-1">
            {loading ? (
              <p className="text-xs text-gray-500 px-1 py-6 text-center">Loading conversations…</p>
            ) : (
              <ConversationList
                conversations={filtered}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setMobileDetail(true);
                }}
              />
            )}
          </div>
        </div>
        <div className={cn("lg:col-span-3", !mobileDetail && "hidden lg:block")}>
          <ConversationDetail
            key={selectedId ?? "none"}
            conversation={selected}
            onBack={() => setMobileDetail(false)}
            onReply={handleReply}
            onResolve={handleResolve}
          />
        </div>
      </section>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

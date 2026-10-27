"use client";

import React, { useState } from "react";
import { ArrowLeft, Send, CheckCircle2, Phone, MessageSquare, QrCode, Globe, Link2 } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { ConversationSession } from "@/types";
import { cn, formatDate, formatPhone } from "@/lib/utils";
import { conversationStatusMeta } from "@/lib/status";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { RoutingChip } from "./RoutingChip";

export const outcomeLabels: Record<NonNullable<ConversationSession["outcome"]>, string> = {
  booking_created: "Booking made",
  inquiry_resolved: "Question answered",
  unresolved: "Needs your reply",
};

const sourceMeta = {
  link: { label: "Chat link", Icon: Link2 },
  qr_code: { label: "QR code", Icon: QrCode },
  website: { label: "Website", Icon: Globe },
} as const;

export function formatConversationTime(iso: string) {
  return formatDate(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface ConversationListProps {
  conversations: ConversationSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ conversations, selectedId, onSelect }: ConversationListProps) {
  if (conversations.length === 0) {
    return <EmptyState icon={MessageSquare} title="No conversations" description="Nothing matches this filter yet." />;
  }
  return (
    <ul className="space-y-2">
      {conversations.map((c) => {
        const status = conversationStatusMeta[c.status];
        const last = c.messages[c.messages.length - 1];
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={selectedId === c.id}
              className={cn(
                "w-full text-left rounded-xl border p-3 transition-colors cursor-pointer",
                selectedId === c.id ? "border-indigo-500/60 bg-indigo-950/30" : "border-gray-800 bg-gray-900/60 hover:border-gray-700"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white truncate">{c.customerName ?? "Visitor"}</span>
                <span className="text-[10px] text-gray-500 flex-shrink-0">{formatConversationTime(c.lastMessageAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant={status.variant} className="text-[10px]">
                  {status.label}
                </Badge>
                {c.topic && <span className="text-[11px] text-gray-400 truncate">{c.topic}</span>}
              </div>
              <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{c.summary ?? last?.text}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ConversationDetailProps {
  conversation: ConversationSession | null;
  onBack: () => void;
  onReply: (id: string, text: string) => void;
  onResolve: (id: string) => void;
}

export function ConversationDetail({ conversation, onBack, onReply, onResolve }: ConversationDetailProps) {
  const [reply, setReply] = useState("");

  if (!conversation) {
    return (
      <Card className="h-full flex items-center justify-center min-h-80">
        <div className="text-center space-y-2">
          <MessageSquare className="w-8 h-8 text-gray-600 mx-auto" />
          <p className="text-sm text-gray-400">Select a conversation to read it.</p>
        </div>
      </Card>
    );
  }

  const status = conversationStatusMeta[conversation.status];
  const source = conversation.source ? sourceMeta[conversation.source] : null;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    onReply(conversation.id, reply.trim());
    setReply("");
  };

  return (
    <Card className="p-0 flex flex-col h-full min-h-[32rem] overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button type="button" onClick={onBack} className="lg:hidden p-1 -ml-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 cursor-pointer" aria-label="Back to conversations">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{conversation.customerName ?? "Visitor"}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
              {conversation.customerPhone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {formatPhone(conversation.customerPhone)}
                </span>
              )}
              <span>Started {formatConversationTime(conversation.startedAt)}</span>
              {source && (
                <span className="inline-flex items-center gap-1">
                  <source.Icon className="w-3 h-3" /> via {source.label}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant={status.variant}>{status.label}</Badge>
          {conversation.outcome && <span className="text-[10px] text-gray-500">{outcomeLabels[conversation.outcome]}</span>}
        </div>
      </div>

      {conversation.summary && (
        <div className="px-4 py-2.5 bg-gray-950/60 border-b border-gray-800 text-xs text-gray-300">
          <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px] mr-1.5">Summary</span>
          {conversation.summary}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[28rem]">
        {conversation.messages.map((m) => (
          <ChatMessageBubble key={m.id} message={m} perspective="owner">
            {m.routing && <RoutingChip routing={m.routing} />}
          </ChatMessageBubble>
        ))}
      </div>

      <form onSubmit={send} className="p-3 border-t border-gray-800 space-y-2">
        <div className="flex gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply as FitZone team..."
            aria-label="Reply to customer"
            className="flex-1 min-w-0 rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <Button type="submit" size="sm" disabled={!reply.trim()} aria-label="Send reply">
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        {conversation.status !== "resolved" && (
          <button type="button" onClick={() => onResolve(conversation.id)} className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer">
            <CheckCircle2 className="w-3.5 h-3.5" /> Mark as resolved
          </button>
        )}
      </form>
    </Card>
  );
}

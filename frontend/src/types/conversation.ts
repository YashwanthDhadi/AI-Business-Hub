export type SenderRole = "customer" | "assistant" | "system" | "staff";

/**
 * Which capabilities the supervisor chose for one message. Owner-facing only:
 * it never reaches the public chat, and carries no prompt or secret.
 */
export interface MessageRouting {
  capabilities: string[];
  lead: string;
  /** "model" the supervisor decided · "fallback" it failed · "disabled"/"trivial" it was skipped. */
  source: "model" | "fallback" | "disabled" | "trivial";
  latencyMs?: number;
  /** Why it fell back. Shown to the owner so a silent failure stays visible. */
  reason?: string;
}

export interface ChatMessage {
  id: string;
  sender: SenderRole;
  text: string;
  timestamp: string;
  metadata?: {
    actionType?: "show_services" | "show_slots" | "show_booking_confirmation" | "payment_link";
    data?: Record<string, unknown>;
  };
  /** Only on assistant replies, and only in the owner's inbox. */
  routing?: MessageRouting;
}

export interface ConversationSession {
  id: string;
  businessId: string;
  businessSlug: string;
  customerName?: string;
  customerPhone?: string;
  status: "active" | "resolved" | "escalated";
  startedAt: string;
  lastMessageAt: string;
  messages: ChatMessage[];
  outcome?: "booking_created" | "inquiry_resolved" | "unresolved";
  /** Short owner-facing topic, e.g. "Membership prices". */
  topic?: string;
  /** One-line summary of what happened, shown in the conversation list. */
  summary?: string;
  /** How the customer reached the chat. */
  source?: "link" | "qr_code" | "website";
}

export interface ChatStats {
  totalConversations: number;
  todayConversations: number;
  bookingsFromChat: number;
  questionsAnswered: number;
}

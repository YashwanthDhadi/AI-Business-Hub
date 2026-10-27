export type ContactChannel = "sms" | "whatsapp" | "email";

/** Whether a customer wants offers. Only the owner can record "opted_in". */
export type MarketingConsent = "unknown" | "opted_in" | "opted_out";

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  status: "active" | "inactive" | "lead";
  tags: string[];
  totalSpend: number;
  lastVisit?: string | null;
  notes?: string;
  membershipPlan?: string | null;
  preferredChannel?: ContactChannel | null;
  createdAt: string;

  // ---- live data only (the mock customers leave these out) ----
  /** False when the owner set the status by hand instead of letting bookings decide. */
  statusIsAutomatic?: boolean;
  marketingConsent?: MarketingConsent;
  /** Who recorded the consent. An opt-out can come from chat; an opt-in never does. */
  consentSource?: "chat" | "dashboard" | null;
  source?: "chat" | "dashboard" | "import";
  lastSeenAt?: string;
}

/** A customer plus the two booking counts the directory shows. What the API returns. */
export interface CustomerSummary extends Customer {
  bookingsCount: number;
  upcomingCount: number;
}

/** Something the chat assistant passed on. Append-only; the owner's own notes are Customer.notes. */
export interface CustomerNote {
  id: string;
  kind: "preference" | "interest" | "note";
  body: string;
  author: "agent" | "owner";
  createdAt: string;
  conversationId: string | null;
}

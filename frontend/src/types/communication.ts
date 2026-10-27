/**
 * Who a campaign goes to. These match the statuses the Customers screen shows,
 * so "active" means exactly the same thing in both places.
 */
export type CampaignAudience = "all" | "active" | "leads" | "inactive" | "unpaid_invoices" | "custom";

/**
 * draft            being written
 * pending_approval waiting for the owner
 * approved         the owner said yes; it can now be sent
 * sent             delivered
 * cancelled        stopped before sending
 *
 * The database allows only these moves, and nothing reaches "approved"
 * without a person.
 */
export type CampaignStatus = "draft" | "pending_approval" | "approved" | "sent" | "cancelled";

export interface Campaign {
  id: string;
  businessId: string;
  name: string;
  body: string;
  audience: CampaignAudience;
  /** Only "chat" exists. SMS and WhatsApp have no free tier. */
  channel: "chat";
  status: CampaignStatus;
  createdBy: "owner" | "agent";
  recipientCount: number;
  sentCount: number;
  /** People deliberately not messaged: opted out, or never chatted. */
  skippedCount: number;
  failedCount: number;
  approvedAt?: string | null;
  approvedBy?: string | null;
  sentAt?: string | null;
  cancelReason?: string;
  createdAt: string;
}

export interface CampaignRecipient {
  id: string;
  customerId: string;
  customerName: string;
  status: "pending" | "sent" | "skipped" | "failed";
  /** Why they were skipped, shown so a small reach explains itself. */
  reason: string;
  sentAt?: string | null;
}

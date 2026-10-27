import type { BadgeProps } from "@/components/ui/Badge";
import type {
  BookingStatus,
  BookingPaymentStatus,
  PaymentStatus,
  InventoryItem,
  Customer,
  ConversationSession,
  PlatformTenant,
  AiAgentStatus,
  PlatformUserRecord,
  PlatformActivityEvent,
} from "@/types";

type Variant = NonNullable<BadgeProps["variant"]>;

export interface StatusMeta {
  label: string;
  variant: Variant;
  /** Tailwind classes for a small status dot (calendar, lists). */
  dot: string;
}

export const bookingStatusMeta: Record<BookingStatus, StatusMeta> = {
  confirmed: { label: "Confirmed", variant: "success", dot: "bg-emerald-400" },
  pending: { label: "Pending", variant: "warning", dot: "bg-amber-400" },
  completed: { label: "Completed", variant: "brand", dot: "bg-indigo-400" },
  cancelled: { label: "Cancelled", variant: "danger", dot: "bg-rose-400" },
};

export const bookingPaymentMeta: Record<BookingPaymentStatus, StatusMeta> = {
  paid: { label: "Paid", variant: "success", dot: "bg-emerald-400" },
  unpaid: { label: "Unpaid", variant: "warning", dot: "bg-amber-400" },
  refunded: { label: "Refunded", variant: "neutral", dot: "bg-gray-400" },
};

export const invoiceStatusMeta: Record<PaymentStatus, StatusMeta> = {
  paid: { label: "Paid", variant: "success", dot: "bg-emerald-400" },
  pending: { label: "Pending", variant: "warning", dot: "bg-amber-400" },
  overdue: { label: "Overdue", variant: "danger", dot: "bg-rose-400" },
  refunded: { label: "Refunded", variant: "neutral", dot: "bg-gray-400" },
  cancelled: { label: "Cancelled", variant: "neutral", dot: "bg-gray-600" },
};

export const stockStatusMeta: Record<InventoryItem["status"], StatusMeta> = {
  in_stock: { label: "In Stock", variant: "success", dot: "bg-emerald-400" },
  low_stock: { label: "Low Stock", variant: "warning", dot: "bg-amber-400" },
  out_of_stock: { label: "Out of Stock", variant: "danger", dot: "bg-rose-400" },
};

export const customerStatusMeta: Record<Customer["status"], StatusMeta> = {
  active: { label: "Active", variant: "success", dot: "bg-emerald-400" },
  lead: { label: "Lead", variant: "brand", dot: "bg-indigo-400" },
  inactive: { label: "Inactive", variant: "neutral", dot: "bg-gray-500" },
};

export const conversationStatusMeta: Record<ConversationSession["status"], StatusMeta> = {
  active: { label: "Active", variant: "success", dot: "bg-emerald-400" },
  resolved: { label: "Resolved", variant: "neutral", dot: "bg-gray-400" },
  escalated: { label: "Needs Reply", variant: "warning", dot: "bg-amber-400" },
};

// documentStatusMeta is gone. The mock screen had documents "processing" while
// a fake upload progressed; a real upload is one synchronous request, so a
// document is either there or the upload failed. What matters now is whether
// the assistant can QUOTE it, which the list shows directly.

export const tenantStatusMeta: Record<PlatformTenant["status"], StatusMeta> = {
  active: { label: "Active", variant: "success", dot: "bg-emerald-400" },
  trial: { label: "Trial", variant: "brand", dot: "bg-indigo-400" },
  suspended: { label: "Suspended", variant: "danger", dot: "bg-rose-400" },
};

export const agentStatusMeta: Record<AiAgentStatus["status"], StatusMeta> = {
  operational: { label: "Operational", variant: "success", dot: "bg-emerald-400" },
  degraded: { label: "Degraded", variant: "warning", dot: "bg-amber-400" },
  offline: { label: "Offline", variant: "danger", dot: "bg-rose-400" },
};

export const platformUserStatusMeta: Record<PlatformUserRecord["status"], StatusMeta> = {
  active: { label: "Active", variant: "success", dot: "bg-emerald-400" },
  invited: { label: "Invited", variant: "brand", dot: "bg-indigo-400" },
  suspended: { label: "Suspended", variant: "danger", dot: "bg-rose-400" },
};

export const severityMeta: Record<PlatformActivityEvent["severity"], StatusMeta> = {
  info: { label: "Info", variant: "neutral", dot: "bg-gray-400" },
  success: { label: "Success", variant: "success", dot: "bg-emerald-400" },
  warning: { label: "Warning", variant: "warning", dot: "bg-amber-400" },
  critical: { label: "Critical", variant: "danger", dot: "bg-rose-400" },
};

/** Derives stock status from quantity and threshold so edits stay consistent. */
export function deriveStockStatus(quantity: number, threshold: number): InventoryItem["status"] {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= threshold) return "low_stock";
  return "in_stock";
}

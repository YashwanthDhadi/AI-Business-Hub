/** "overdue" is never stored: it is an unpaid invoice past its due date (in IST). */
export type PaymentStatus = "paid" | "pending" | "overdue" | "refunded" | "cancelled";

/** How the owner recorded the money arriving. UPI first: it is how India pays. */
export type PaymentMethod = "upi" | "cash" | "card" | "bank_transfer";

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PaymentInvoice {
  id: string;
  businessId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate: string;
  paidDate?: string | null;
  items: InvoiceItem[];
  paymentMethod?: PaymentMethod | null;
  createdAt: string;

  // ---- live data only (the mock invoices leave these out) ----
  customerPhone?: string;
  bookingId?: string | null;
  bookingReference?: string | null;
  /** The public pay page. Anyone with this link can see and pay this one invoice. */
  payUrl?: string;
  /** False until the owner sets a UPI ID - then the pay page offers "pay at the desk". */
  upiReady?: boolean;
  /** Whether there is a chat thread to post the invoice, reminders and receipt into. */
  hasChat?: boolean;
  /** The CUSTOMER says they paid. A claim to check, not proof. */
  customerReportedAt?: string | null;
  customerReference?: string | null;
  paidReference?: string;
  cancelReason?: string;
  refundNote?: string;
  lastRemindedAt?: string | null;
  notes?: string;
}

/** The owner's payment settings, from /dashboard/payments/settings. */
export interface PaymentSettings {
  upiId: string;
  payeeName: string;
  invoicePrefix: string;
  dueDays: number;
  upiReady: boolean;
}

/** What the PUBLIC pay page is allowed to know. No phone, email or ids. */
export interface PublicInvoice {
  businessName: string;
  invoiceNumber: string;
  customerFirstName: string;
  items: Omit<InvoiceItem, "id">[];
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate: string;
  paidDate: string | null;
  upiLink: string | null;
  upiId: string | null;
  payeeName: string | null;
  customerReported: boolean;
}

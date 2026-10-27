/**
 * Client for the owner's dashboard API.
 *
 * Always goes through /api/hub, which is a Next.js route handler that attaches
 * the dashboard key server-side. Nothing secret reaches the browser.
 */

import type {
  Booking,
  BookingStatus,
  ChatStats,
  ContactChannel,
  ConversationSession,
  Customer,
  CustomerNote,
  CustomerSummary,
  BusinessDocument,
  BusinessReport,
  Campaign,
  CampaignAudience,
  CampaignRecipient,
  DocumentCategory,
  FaqItem,
  InventoryItem,
  MarketingConsent,
  PaymentInvoice,
  PaymentMethod,
  PaymentSettings,
  StockMovement,
  StockReason,
} from "@/types";

export const LIVE_BUSINESS_ID = process.env.NEXT_PUBLIC_LIVE_BUSINESS_ID ?? "";

export interface DashboardStats extends ChatStats {
  openRequests: number;
  pendingBookings: number;
  business: { id: string; name: string; chatSlug: string; chatEnabled: boolean };
}

/** What the Add Customer form sends. Empty strings mean "not given". */
export interface NewCustomer {
  name: string;
  phone?: string;
  email?: string;
  /** "auto" lets bookings decide; anything else is the owner overruling that. */
  status?: "auto" | Customer["status"];
  preferred_channel?: ContactChannel | "";
  membership_plan?: string;
  notes?: string;
  tags?: string[];
}

/** A partial edit. Only the owner can send marketing_consent: "opted_in". */
export type CustomerPatch = Partial<NewCustomer> & { marketing_consent?: MarketingConsent };

export interface CustomerDetail {
  customer: CustomerSummary;
  bookings: Booking[];
  notes: CustomerNote[];
  invoices: PaymentInvoice[];
  /** False until the Payments agent exists. */
  invoicesAvailable: boolean;
}

/** What New Invoice sends. Bill a booking by leaving items empty. */
export interface NewInvoice {
  customer_id: string;
  appointment_id?: string | null;
  items?: { description: string; quantity: number; unit_price: number }[];
  /** YYYY-MM-DD. Empty means today + the business's due days. */
  due_date?: string | null;
  notes?: string;
  send_to_chat?: boolean;
}

/** What the Add / Edit product form sends. `quantity` is opening stock only. */
export interface NewInventoryItem {
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  reorder_level?: number;
  cost_price?: number;
  sale_price?: number;
  is_active?: boolean;
}

export interface CatalogService {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
}

/** Most payment actions return the invoice and whether the customer's chat got a message. */
export interface InvoiceResult {
  invoice: PaymentInvoice;
  customer_notified?: boolean;
}

export class HubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HubError";
  }
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number> } = {},
): Promise<T> {
  const params = new URLSearchParams({ business_id: LIVE_BUSINESS_ID });
  // Extra query parameters go through here rather than being glued onto
  // `path`, which would land on the wrong side of the "?" this function adds.
  for (const [key, value] of Object.entries(options.query ?? {})) {
    params.set(key, String(value));
  }

  const response = await fetch(`/api/hub/dashboard${path}?${params.toString()}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HubError(text.slice(0, 200) || "Unreadable response", response.status);
  }

  if (!response.ok) {
    const detail =
      (body as { detail?: string } | null)?.detail ?? `Request failed (${response.status})`;
    throw new HubError(detail, response.status);
  }

  return body as T;
}

/**
 * Send a file. Separate from call() because FormData must NOT get a
 * Content-Type header set by hand - the browser adds one with the multipart
 * boundary, and overriding it makes the upload unreadable at the other end.
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const params = new URLSearchParams({ business_id: LIVE_BUSINESS_ID });
  const response = await fetch(`/api/hub/dashboard${path}?${params.toString()}`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HubError(text.slice(0, 200) || "Unreadable response", response.status);
  }
  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail ?? `Upload failed (${response.status})`;
    throw new HubError(detail, response.status);
  }
  return body as T;
}

export const dashboardApi = {
  stats: () => call<DashboardStats>("/stats"),

  conversations: () =>
    call<{ conversations: ConversationSession[] }>("/conversations").then((r) => r.conversations),

  reply: (conversationId: string, body: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/reply`, {
      method: "POST",
      body: { body },
    }).then((r) => r.conversation),

  resolve: (conversationId: string) =>
    call<{ conversation: ConversationSession }>(`/conversations/${conversationId}/resolve`, {
      method: "POST",
      body: { resolved: true },
    }).then((r) => r.conversation),

  bookings: () => call<{ bookings: Booking[]; pending: number }>("/bookings"),

  /**
   * Approve or reject a booking the agent took.
   *
   * This is the only way a booking becomes "confirmed" — the agent has no tool
   * that can write it. Approving also posts a line into the customer's chat.
   */
  decideBooking: (bookingId: string, decision: "approve" | "reject", note = "") =>
    call<{ booking: Booking; customer_notified: boolean }>(
      `/bookings/${bookingId}/decision`,
      { method: "POST", body: { decision, note, decided_by: "owner" } },
    ),

  /** Move an already-decided booking, e.g. confirmed -> completed. */
  setBookingStatus: (bookingId: string, status: BookingStatus, note = "") =>
    call<{ booking: Booking }>(`/bookings/${bookingId}/status`, {
      method: "POST",
      body: { status, note },
    }).then((r) => r.booking),

  /** The client directory: status, spend and counts are calculated by the database. */
  customers: () =>
    call<{ customers: CustomerSummary[] }>("/customers").then((r) => r.customers),

  /** One profile, with bookings and what the chat assistant passed on. */
  customer: (customerId: string) => call<CustomerDetail>(`/customers/${customerId}`),

  /** Throws HubError 409 if the phone or email already belongs to someone. */
  createCustomer: (input: NewCustomer) =>
    call<{ customer: CustomerSummary }>("/customers", { method: "POST", body: input }).then(
      (r) => r.customer,
    ),

  /**
   * Edit a customer. Sending marketing_consent here is the ONLY way anyone
   * becomes "opted_in" - the chat assistant cannot, and the database refuses
   * it from anywhere but the dashboard.
   */
  updateCustomer: (customerId: string, patch: CustomerPatch) =>
    call<{ customer: CustomerSummary }>(`/customers/${customerId}`, {
      method: "PATCH",
      body: patch,
    }).then((r) => r.customer),

  /** Every invoice, plus the payment settings the screen needs to explain itself. */
  invoices: () =>
    call<{
      invoices: PaymentInvoice[];
      settings: PaymentSettings;
      /** `today` is the business's own date (IST), so "this month" matches theirs. */
      business: { name: string; today: string };
    }>("/payments/invoices"),

  /** Issue an invoice. The number comes from the database; you cannot choose it. */
  createInvoice: (input: NewInvoice) =>
    call<InvoiceResult>("/payments/invoices", { method: "POST", body: input }),

  /**
   * The ONLY way anything becomes "paid". The chat assistant has no tool for it;
   * a customer saying "I've paid" is only recorded as a claim.
   */
  markInvoicePaid: (invoiceId: string, method: PaymentMethod, reference = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/paid`, {
      method: "POST",
      body: { method, reference, send_receipt: true },
    }),

  cancelInvoice: (invoiceId: string, reason = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/cancel`, {
      method: "POST",
      body: { reason, notify: true },
    }),

  /** Record a refund you have ALREADY paid back, outside this system. */
  refundInvoice: (invoiceId: string, note = "") =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/refund`, { method: "POST", body: { note } }),

  /** Posts into the customer's own chat. 422 if they have none, 429 if reminded today. */
  remindInvoice: (invoiceId: string) =>
    call<InvoiceResult>(`/payments/invoices/${invoiceId}/remind`, { method: "POST", body: {} }),

  paymentCatalog: () =>
    call<{ services: CatalogService[] }>("/payments/catalog").then((r) => r.services),

  updatePaymentSettings: (patch: {
    upi_id?: string;
    payee_name?: string;
    invoice_prefix?: string;
    due_days?: number;
  }) =>
    call<{ settings: PaymentSettings }>("/payments/settings", { method: "PATCH", body: patch }).then(
      (r) => r.settings,
    ),

  /** Every item, plus the low-stock shortlist and total stock value. */
  inventory: () =>
    call<{ items: InventoryItem[]; lowStock: InventoryItem[]; stockValue: number }>("/inventory"),

  inventoryMovements: () =>
    call<{ movements: StockMovement[] }>("/inventory/movements").then((r) => r.movements),

  inventoryItem: (itemId: string) =>
    call<{ item: InventoryItem; movements: StockMovement[] }>(`/inventory/${itemId}`),

  createInventoryItem: (input: NewInventoryItem) =>
    call<{ item: InventoryItem }>("/inventory", { method: "POST", body: input }).then((r) => r.item),

  /** Details only. The quantity is changed through adjustStock, never here. */
  updateInventoryItem: (itemId: string, patch: Partial<NewInventoryItem>) =>
    call<{ item: InventoryItem }>(`/inventory/${itemId}`, { method: "PATCH", body: patch }).then(
      (r) => r.item,
    ),

  /**
   * Add or remove stock. The ONLY way a quantity changes.
   *
   * `idempotencyKey` makes a double click harmless: send the same key twice
   * and the stock moves once. The database refuses anything that would take
   * stock below zero, so a 409 here means exactly that.
   */
  adjustStock: (
    itemId: string,
    delta: number,
    reason: StockReason,
    note = "",
    idempotencyKey?: string,
  ) =>
    call<{ item: InventoryItem }>(`/inventory/${itemId}/adjust`, {
      method: "POST",
      body: { delta, reason, note, idempotency_key: idempotencyKey },
    }).then((r) => r.item),

  documents: () =>
    call<{ documents: BusinessDocument[]; maxUploadMb: number; quotable: number }>("/documents"),

  /** One document, including its FULL searchable text (the list only carries a preview). */
  document: (documentId: string) =>
    call<{ document: BusinessDocument }>(`/documents/${documentId}`).then((r) => r.document),

  /** Add a document by pasting its text, with no file. */
  createDocument: (input: {
    title: string;
    category: DocumentCategory;
    description?: string;
    content?: string;
    is_public?: boolean;
  }) => call<{ document: BusinessDocument }>("/documents", { method: "POST", body: input }).then((r) => r.document),

  updateDocument: (
    documentId: string,
    patch: { title?: string; category?: DocumentCategory; description?: string; content?: string; is_public?: boolean },
  ) =>
    call<{ document: BusinessDocument }>(`/documents/${documentId}`, {
      method: "PATCH",
      body: patch,
    }).then((r) => r.document),

  /** Hides it rather than destroying it - a customer may have been quoted it. */
  archiveDocument: (documentId: string) =>
    call<{ archived: boolean }>(`/documents/${documentId}`, { method: "DELETE" }),

  uploadDocument: (file: File, category: DocumentCategory, isPublic: boolean, title = "") => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title || file.name);
    form.append("category", category);
    form.append("is_public", String(isPublic));
    return upload<{ document: BusinessDocument }>("/documents/upload", form).then((r) => r.document);
  },

  /** A link that works for five minutes. The bucket itself is private. */
  documentDownloadUrl: (documentId: string) =>
    call<{ url: string }>(`/documents/${documentId}/download`).then((r) => r.url),

  campaigns: () =>
    call<{ campaigns: Campaign[]; channels: string[]; channelNote: string }>("/communication"),

  campaign: (campaignId: string) =>
    call<{ campaign: Campaign; recipients: CampaignRecipient[] }>(`/communication/${campaignId}`),

  /** Ask the model for wording. It returns TEXT; it creates and sends nothing. */
  draftCampaignBody: (intent: string, audience: CampaignAudience) =>
    call<{ body: string }>("/communication/draft", {
      method: "POST",
      body: { intent, audience },
    }).then((r) => r.body),

  createCampaign: (input: {
    name: string;
    body: string;
    audience: CampaignAudience;
    customer_ids?: string[];
  }) =>
    call<{ campaign: Campaign; plan: { total: number; will_receive: number; skipped: number } }>(
      "/communication",
      { method: "POST", body: input },
    ),

  submitCampaign: (campaignId: string) =>
    call<{ campaign: Campaign }>(`/communication/${campaignId}/submit`, { method: "POST", body: {} }).then(
      (r) => r.campaign,
    ),

  /** The owner gate. The ONLY path to a campaign that can be sent. */
  approveCampaign: (campaignId: string) =>
    call<{ campaign: Campaign }>(`/communication/${campaignId}/approve`, {
      method: "POST",
      body: { approved_by: "owner" },
    }).then((r) => r.campaign),

  sendCampaign: (campaignId: string) =>
    call<{ campaign: Campaign; sent: number; failed: number }>(`/communication/${campaignId}/send`, {
      method: "POST",
      body: {},
    }),

  cancelCampaign: (campaignId: string) =>
    call<{ campaign: Campaign }>(`/communication/${campaignId}/cancel`, { method: "POST", body: {} }).then(
      (r) => r.campaign,
    ),

  /** Every figure here is produced by SQL, never by a model. */
  report: (days = 30) => call<BusinessReport>("/reports", { query: { days } }),

  /** A separate request on purpose: loading the screen must not spend quota. */
  summariseReport: (days = 30) =>
    call<{ summary: string }>("/reports/summarise", {
      method: "POST",
      body: {},
      query: { days },
    }).then((r) => r.summary),

  knowledge: () => call<{ faqs: FaqItem[] }>("/knowledge").then((r) => r.faqs),

  createArticle: (question: string, answer: string, tags: string[] = []) =>
    call<{ faq: FaqItem }>("/knowledge", {
      method: "POST",
      body: { title: question, body: answer, tags, is_active: true },
    }).then((r) => r.faq),

  updateArticle: (id: string, question: string, answer: string, tags: string[] = []) =>
    call<{ updated: boolean }>(`/knowledge/${id}`, {
      method: "PATCH",
      body: { title: question, body: answer, tags, is_active: true },
    }),

  deleteArticle: (id: string) =>
    call<{ deleted: boolean }>(`/knowledge/${id}`, { method: "DELETE" }),

  updateChatSettings: (patch: {
    chat_greeting?: string;
    chat_enabled?: boolean;
    agent_persona?: string;
  }) => call<{ updated: string[] }>("/chat-settings", { method: "PATCH", body: patch }),
};

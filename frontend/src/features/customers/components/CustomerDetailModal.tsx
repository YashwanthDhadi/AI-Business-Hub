"use client";

import React, { useState } from "react";
import { Phone, Mail, Calendar, CreditCard, StickyNote, Send, Check, Pencil, MessageSquare } from "lucide-react";
import { Modal, Avatar, Badge, Button, Textarea, SegmentedTabs, Select } from "@/components/ui";
import type { Booking, CustomerNote, MarketingConsent, PaymentInvoice } from "@/types";
import { formatCurrency, formatDate, formatPhone, formatInstant } from "@/lib/utils";
import { customerStatusMeta, bookingStatusMeta, invoiceStatusMeta } from "@/lib/status";
import type { CustomerRow } from "./CustomerTable";

interface CustomerDetailModalProps {
  customer: CustomerRow | null;
  bookings: Booking[];
  invoices: PaymentInvoice[];
  /** False until the Payments agent exists - the Invoices tab says so instead of looking empty. */
  invoicesAvailable: boolean;
  /** What the chat assistant passed on. Read-only here. */
  notes: CustomerNote[];
  /** True while this customer's bookings and notes are still loading. */
  loading: boolean;
  onClose: () => void;
  /** Rejects if the save failed, so the draft is kept. */
  onSaveNotes: (id: string, notes: string) => Promise<void>;
  onSetConsent: (id: string, consent: MarketingConsent) => Promise<void>;
}

type Tab = "bookings" | "invoices" | "notes";

const channelLabels = { sms: "SMS", whatsapp: "WhatsApp", email: "Email" } as const;

const consentOptions = [
  { label: "Offers: not asked yet", value: "unknown" },
  { label: "Offers: yes, they told you", value: "opted_in" },
  { label: "Offers: no", value: "opted_out" },
];

const noteKindLabels: Record<CustomerNote["kind"], string> = {
  preference: "Preference",
  interest: "Interest",
  note: "Note",
};

export function CustomerDetailModal({
  customer,
  bookings,
  invoices,
  invoicesAvailable,
  notes,
  loading,
  onClose,
  onSaveNotes,
  onSetConsent,
}: CustomerDetailModalProps) {
  const [tab, setTab] = useState<Tab>("bookings");
  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  if (!customer) return null;

  const status = customerStatusMeta[customer.status];
  const outstanding = invoices.filter((i) => i.status === "pending" || i.status === "overdue").reduce((a, i) => a + i.amount, 0);

  const startEditing = () => {
    setDraft(customer.notes ?? "");
    setEditingNotes(true);
  };

  const handleClose = () => {
    setEditingNotes(false);
    setTab("bookings");
    onClose();
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await onSaveNotes(customer.id, draft.trim());
      setEditingNotes(false);
    } catch {
      // The page has already shown a toast. Keep the draft so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={handleClose} title="Customer Profile" maxWidth="lg">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={customer.name} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-white truncate">{customer.name}</span>
                <Badge variant={status.variant}>{status.label}</Badge>
                {customer.statusIsAutomatic === false && <span className="text-[10px] text-gray-500">set by you</span>}
              </div>
              <div className="text-xs text-gray-400">
                Customer since {formatInstant(customer.createdAt, { month: "short", year: "numeric" })}
                {customer.source === "chat" && <> • found through chat</>}
                {customer.membershipPlan && <> • {customer.membershipPlan}</>}
              </div>
            </div>
          </div>
          {/* The Communication agent is not built. A button that looked live would lie. */}
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled
            title="Sending messages is the Communication agent's job, and it is not built yet."
          >
            <Send className="w-3.5 h-3.5 text-indigo-400" />
            Messaging is not built yet
          </Button>
        </div>

        {/* Contact + key numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-1.5 text-sm">
            {customer.phone ? (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-gray-200 hover:text-white">
                <Phone className="w-3.5 h-3.5 text-gray-500" /> {formatPhone(customer.phone)}
              </a>
            ) : (
              <div className="flex items-center gap-2 text-gray-500">
                <Phone className="w-3.5 h-3.5" /> No phone number
              </div>
            )}
            {customer.email ? (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-gray-200 hover:text-white break-all">
                <Mail className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" /> {customer.email}
              </a>
            ) : (
              <div className="flex items-center gap-2 text-gray-500">
                <Mail className="w-3.5 h-3.5" /> No email
              </div>
            )}
            {customer.preferredChannel && (
              <div className="text-[11px] text-gray-500">Prefers {channelLabels[customer.preferredChannel]}</div>
            )}
            <Select
              aria-label="Does this customer want offers?"
              value={customer.marketingConsent ?? "unknown"}
              onChange={(v) => void onSetConsent(customer.id, v as MarketingConsent)}
              options={consentOptions}
              wrapperClassName="pt-1"
            />
            {customer.marketingConsent === "opted_out" && customer.consentSource === "chat" && (
              <div className="text-[11px] text-gray-500">They asked the chat assistant to stop offers.</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Spend", value: formatCurrency(customer.totalSpend), hint: "completed bookings" },
              { label: "Bookings", value: customer.bookingsCount, hint: `${customer.upcomingCount} upcoming` },
              {
                label: "Last Visit",
                value: customer.lastVisit ? formatDate(customer.lastVisit, { month: "short", day: "numeric" }) : "—",
                hint: "completed",
              },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</div>
                <div className="text-sm font-bold text-white mt-1">{s.value}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {outstanding > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            {formatCurrency(outstanding)} outstanding across unpaid invoices.
          </div>
        )}

        {customer.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customer.tags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                {t}
              </span>
            ))}
          </div>
        )}

        <SegmentedTabs<Tab>
          tabs={[
            { label: "Bookings", value: "bookings", count: bookings.length },
            { label: "Invoices", value: "invoices", count: invoicesAvailable ? invoices.length : undefined },
            { label: "Notes", value: "notes", count: notes.length || undefined },
          ]}
          value={tab}
          onChange={setTab}
          className="self-start w-fit"
        />

        {tab === "bookings" && (
          <ul className="space-y-2">
            {loading && <li className="text-xs text-gray-500 py-4 text-center">Loading bookings…</li>}
            {!loading && bookings.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">No bookings yet.</li>}
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calendar className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{b.serviceName}</div>
                    <div className="text-[11px] text-gray-400">
                      {formatDate(b.date, { month: "short", day: "numeric" })} • {b.time}
                    </div>
                  </div>
                </div>
                <Badge variant={bookingStatusMeta[b.status].variant}>{bookingStatusMeta[b.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}

        {tab === "invoices" && (
          <ul className="space-y-2">
            {!invoicesAvailable && (
              <li className="text-xs text-gray-500 py-4 text-center">
                Payments are switched off for this business, so there are no invoices.
              </li>
            )}
            {invoicesAvailable && invoices.length === 0 && <li className="text-xs text-gray-500 py-4 text-center">No invoices yet.</li>}
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CreditCard className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{inv.invoiceNumber}</div>
                    <div className="text-[11px] text-gray-400 truncate">{inv.items[0]?.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{formatCurrency(inv.amount)}</span>
                  <Badge variant={invoiceStatusMeta[inv.status].variant}>{invoiceStatusMeta[inv.status].label}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === "notes" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Your notes</div>
              {editingNotes ? (
                <>
                  <Textarea
                    aria-label="Customer notes"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Preferences, goals, anything to remember..."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingNotes(false)} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveNotes()} disabled={saving}>
                      <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Notes"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-2">
                      <StickyNote className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-gray-200 whitespace-pre-line">{customer.notes || "No notes yet."}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={startEditing} aria-label="Edit notes">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                Passed on by the chat assistant
              </div>
              {loading && <div className="text-xs text-gray-500 py-2">Loading…</div>}
              {!loading && notes.length === 0 && (
                <div className="text-xs text-gray-500 py-2">Nothing passed on from chat yet.</div>
              )}
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200">{n.body}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {noteKindLabels[n.kind]} • {formatInstant(n.createdAt, { day: "numeric", month: "short" })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

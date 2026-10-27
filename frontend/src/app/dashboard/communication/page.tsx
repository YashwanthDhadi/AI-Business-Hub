"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Send, CheckCircle2, Clock, Sparkles, Info, XCircle } from "lucide-react";
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  SegmentedTabs,
  Modal,
  Input,
  Select,
  Textarea,
  Badge,
  EmptyState,
  Toast,
} from "@/components/ui";
import type { Campaign, CampaignAudience, CampaignRecipient, CampaignStatus } from "@/types";
import { formatInstant } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";

type StatusFilter = CampaignStatus | "all";

const audienceLabels: Record<CampaignAudience, string> = {
  all: "Everyone",
  active: "Active members",
  leads: "Leads",
  inactive: "Inactive customers",
  unpaid_invoices: "People who owe money",
  custom: "Chosen by hand",
};

const statusMeta: Record<CampaignStatus, { label: string; variant: "success" | "warning" | "brand" | "neutral" | "danger" }> = {
  draft: { label: "Draft", variant: "neutral" },
  pending_approval: { label: "Waiting for you", variant: "warning" },
  approved: { label: "Approved", variant: "brand" },
  sent: { label: "Sent", variant: "success" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function CommunicationPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [channelNote, setChannelNote] = useState("");
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.campaigns();
      setCampaigns(data.campaigns);
      setChannelNote(data.channelNote);
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load campaigns."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [configured, refresh]);

  const replace = useCallback((updated: Campaign) => {
    setCampaigns((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
    });
    setSelected((current) => (current && current.id === updated.id ? updated : current));
  }, []);

  const open = useCallback(
    async (campaign: Campaign) => {
      setSelected(campaign);
      setRecipients(null);
      try {
        const detail = await dashboardApi.campaign(campaign.id);
        replace(detail.campaign);
        setRecipients(detail.recipients);
      } catch (error) {
        showToast(message(error, "Could not open that campaign."), "error");
        setRecipients([]);
      }
    },
    [replace, showToast],
  );

  /** One helper for every state change, so failures always reload and report. */
  const run = useCallback(
    async (action: () => Promise<Campaign>, done: string) => {
      setBusy(true);
      try {
        replace(await action());
        showToast(done);
      } catch (error) {
        showToast(message(error, "That did not work."), "error");
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, replace, showToast],
  );

  const handleSend = useCallback(
    async (campaign: Campaign) => {
      setBusy(true);
      try {
        const result = await dashboardApi.sendCampaign(campaign.id);
        replace(result.campaign);
        showToast(
          result.sent === 0
            ? "Nobody could be messaged. Check the recipient list for why."
            : `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`,
          result.sent === 0 ? "info" : "success",
        );
        if (selected?.id === campaign.id) void open(result.campaign);
      } catch (error) {
        showToast(message(error, "Could not send it."), "error");
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [open, refresh, replace, selected, showToast],
  );

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: campaigns.length, draft: 0, pending_approval: 0, approved: 0, sent: 0, cancelled: 0,
    };
    for (const campaign of campaigns) c[campaign.status] += 1;
    return c;
  }, [campaigns]);

  const filtered = useMemo(
    () => campaigns.filter((c) => statusFilter === "all" || c.status === statusFilter),
    [campaigns, statusFilter],
  );

  const waiting = campaigns.filter((c) => c.status === "pending_approval");
  const reached = campaigns.reduce((a, c) => a + c.sentCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Communication"
        description="Send one message to many customers. Nothing goes out until you approve it."
        actions={
          <Button size="sm" className="text-xs shadow-md shadow-indigo-600/20" onClick={() => setNewOpen(true)} disabled={!configured}>
            <Plus className="w-3.5 h-3.5" /> New Message
          </Button>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      {/* The honest note about channels, stated rather than implied. */}
      {channelNote && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 text-xs text-gray-400 flex gap-2">
          <Info className="w-4 h-4 flex-shrink-0 text-gray-500" />
          <span>{channelNote}</span>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <Clock className="w-4 h-4" /> {waiting.length} waiting for your approval
          </div>
          <p className="text-xs text-amber-200/80">Read the message and who it reaches, then approve it. Nothing sends until you do.</p>
          <div className="flex flex-wrap gap-2">
            {waiting.map((c) => (
              <Button key={c.id} variant="outline" size="sm" onClick={() => void open(c)}>
                {c.name} • {c.recipientCount} chosen
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Campaigns" value={campaigns.length} icon={Megaphone} tone="indigo" hint="All time" />
        <StatCard label="Waiting for you" value={counts.pending_approval} icon={Clock} tone="amber" hint="Need approval" onClick={() => setStatusFilter("pending_approval")} active={statusFilter === "pending_approval"} />
        <StatCard label="Sent" value={counts.sent} icon={CheckCircle2} tone="emerald" hint="Delivered" onClick={() => setStatusFilter("sent")} active={statusFilter === "sent"} />
        <StatCard label="People reached" value={reached} icon={Send} tone="purple" hint="Messages delivered" />
      </div>

      <section className="space-y-3" aria-label="Campaigns">
        <SegmentedTabs<StatusFilter>
          tabs={[
            { label: "All", value: "all", count: counts.all },
            { label: "Drafts", value: "draft", count: counts.draft },
            { label: "Waiting", value: "pending_approval", count: counts.pending_approval },
            { label: "Approved", value: "approved", count: counts.approved },
            { label: "Sent", value: "sent", count: counts.sent },
            { label: "Cancelled", value: "cancelled", count: counts.cancelled },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          className="self-start"
        />

        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading campaigns…</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns" description="Write one message and send it to a group of customers." />
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg divide-y divide-gray-800/80">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void open(c)}
                className="w-full text-left p-4 hover:bg-gray-800/40 transition-colors cursor-pointer group space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white group-hover:text-indigo-300">{c.name}</span>
                  <Badge variant={statusMeta[c.status].variant}>{statusMeta[c.status].label}</Badge>
                </div>
                <p className="text-[11px] text-gray-400 line-clamp-2">{c.body}</p>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500">
                  <span>{audienceLabels[c.audience]}</span>
                  <span>{c.recipientCount} chosen</span>
                  {c.sentCount > 0 && <span className="text-emerald-300">{c.sentCount} delivered</span>}
                  {c.skippedCount > 0 && <span className="text-amber-300">{c.skippedCount} skipped</span>}
                  <span>{formatInstant(c.createdAt, { day: "numeric", month: "short" })}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <CampaignModal
        campaign={selected}
        recipients={recipients}
        busy={busy}
        onClose={() => setSelected(null)}
        onSubmit={(c) => void run(() => dashboardApi.submitCampaign(c.id), "Sent for your approval.")}
        onApprove={(c) => void run(() => dashboardApi.approveCampaign(c.id), "Approved. You can send it now.")}
        onSend={(c) => void handleSend(c)}
        onCancel={(c) => void run(() => dashboardApi.cancelCampaign(c.id), "Campaign cancelled.")}
      />

      <NewCampaignModal
        key={newOpen ? "open" : "closed"}
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={async (input) => {
          const result = await dashboardApi.createCampaign(input);
          replace(result.campaign);
          showToast(
            `Draft saved. ${result.plan.will_receive} of ${result.plan.total} will receive it` +
              (result.plan.skipped ? `, ${result.plan.skipped} skipped.` : "."),
          );
        }}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

/** Read a campaign, see exactly who it reaches, then approve and send. */
function CampaignModal({
  campaign,
  recipients,
  busy,
  onClose,
  onSubmit,
  onApprove,
  onSend,
  onCancel,
}: {
  campaign: Campaign | null;
  recipients: CampaignRecipient[] | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (c: Campaign) => void;
  onApprove: (c: Campaign) => void;
  onSend: (c: Campaign) => void;
  onCancel: (c: Campaign) => void;
}) {
  if (!campaign) return null;
  const skipped = (recipients ?? []).filter((r) => r.status === "skipped");
  const willReceive = (recipients ?? []).filter((r) => r.status === "pending").length;

  return (
    <Modal isOpen onClose={onClose} title={campaign.name} description={audienceLabels[campaign.audience]} maxWidth="lg">
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge variant={statusMeta[campaign.status].variant}>{statusMeta[campaign.status].label}</Badge>
          {campaign.createdBy === "agent" && <span className="text-[11px] text-gray-500">drafted by the assistant</span>}
          {campaign.approvedBy && (
            <span className="text-[11px] text-gray-500">
              approved by {campaign.approvedBy} {campaign.approvedAt ? formatInstant(campaign.approvedAt, { day: "numeric", month: "short" }) : ""}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">The message</span>
          <p className="text-sm text-gray-100 whitespace-pre-line mt-1">{campaign.body}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Chosen", value: campaign.recipientCount },
            { label: campaign.status === "sent" ? "Delivered" : "Will receive", value: campaign.status === "sent" ? campaign.sentCount : willReceive },
            { label: "Skipped", value: campaign.skippedCount },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-950/60 p-2.5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{s.label}</div>
              <div className="text-sm font-bold text-white mt-1">{s.value}</div>
            </div>
          ))}
        </div>

        {recipients === null ? (
          <p className="text-xs text-gray-500 py-4 text-center">Loading who this reaches…</p>
        ) : skipped.length > 0 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
            <span className="text-[11px] font-semibold text-amber-300">{skipped.length} will not receive it</span>
            <ul className="text-[11px] text-amber-200/80 space-y-0.5 max-h-28 overflow-y-auto">
              {skipped.map((r) => (
                <li key={r.id}>
                  {r.customerName} — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-gray-800">
          {campaign.status === "draft" && (
            <Button size="sm" disabled={busy} onClick={() => onSubmit(campaign)}>
              <Clock className="w-3.5 h-3.5" /> Send for approval
            </Button>
          )}
          {campaign.status === "pending_approval" && (
            <Button size="sm" disabled={busy} onClick={() => onApprove(campaign)}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Approve
            </Button>
          )}
          {campaign.status === "approved" && (
            <Button size="sm" disabled={busy || willReceive === 0} onClick={() => onSend(campaign)}>
              <Send className="w-3.5 h-3.5" /> Send to {willReceive}
            </Button>
          )}
          {campaign.status !== "sent" && campaign.status !== "cancelled" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onCancel(campaign)} className="hover:text-rose-300">
              <XCircle className="w-3.5 h-3.5 text-rose-400" /> Cancel
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Write a campaign. The assistant can suggest wording; it cannot send it. */
function NewCampaignModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; body: string; audience: CampaignAudience }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<CampaignAudience>("active");
  const [body, setBody] = useState("");
  const [intent, setIntent] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      setBody(await dashboardApi.draftCampaignBody(intent, audience));
    } catch (cause) {
      setError(cause instanceof HubError ? cause.message : "Could not write a draft.");
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), body: body.trim(), audience });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Message" description="It goes into each customer's chat. You approve before anything sends." maxWidth="md">
      <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-1">
        <Input label="Name (for you, not the customer)" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. October yoga offer" required />
        <Select
          label="Who it goes to"
          value={audience}
          onChange={(v) => setAudience(v as CampaignAudience)}
          options={(Object.keys(audienceLabels) as CampaignAudience[])
            .filter((a) => a !== "custom")
            .map((a) => ({ label: audienceLabels[a], value: a }))}
        />

        <Card className="bg-gray-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs">Need words?</CardTitle>
            <CardDescription className="text-[11px]">
              Say what you want to tell them and the assistant will suggest wording. You can edit it, and nothing sends until you approve.
            </CardDescription>
          </CardHeader>
          <div className="flex gap-2">
            <Input aria-label="What do you want to say?" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="e.g. remind people their invoice is due" className="flex-1" />
            <Button type="button" variant="outline" size="md" disabled={drafting || intent.trim().length < 3} onClick={() => void draft()}>
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> {drafting ? "Writing…" : "Suggest"}
            </Button>
          </div>
        </Card>

        <Textarea label="The message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi! Just a reminder that…" required />
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || body.trim().length < 3}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

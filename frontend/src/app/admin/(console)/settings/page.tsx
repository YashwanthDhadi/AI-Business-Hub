"use client";

import React, { useState } from "react";
import { Settings, Save } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardDescription, Input, PageHeader, Select, Toggle, Toast } from "@/components/ui";
import { planLabels } from "@/data";
import { useToast } from "@/hooks/useToast";

export default function AdminSettingsPage() {
  const [form, setForm] = useState({
    platformName: "AI Business Hub",
    supportEmail: "support@aibusinesshub.com",
    defaultPlan: "starter",
    trialDays: "14",
    rateLimit: "60",
    signupsOpen: true,
    maintenance: false,
    voiceEnabled: true,
    requireMfa: true,
    latencyAlertMs: "1000",
  });
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      showToast("Platform settings saved (mock).");
    }, 700);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        icon={Settings}
        title="Platform Settings"
        description="Global configuration that applies to every tenant."
        actions={
          <Button size="sm" className="text-xs" onClick={save} isLoading={saving}>
            {!saving && <Save className="w-3.5 h-3.5" />} Save
          </Button>
        }
      />

      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>General</CardTitle>
          <CardDescription>Branding and sign-up defaults</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Platform Name" value={form.platformName} onChange={(e) => set("platformName", e.target.value)} />
          <Input label="Support Email" type="email" value={form.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} />
          <Select
            label="Default Plan"
            value={form.defaultPlan}
            onChange={(v) => set("defaultPlan", v)}
            options={Object.entries(planLabels).map(([value, label]) => ({ value, label }))}
          />
          <Input label="Trial Length (days)" type="number" min={0} value={form.trialDays} onChange={(e) => set("trialDays", e.target.value)} />
        </div>
        <div className="space-y-4 pt-2">
          <Toggle checked={form.signupsOpen} onChange={(v) => set("signupsOpen", v)} label="Allow new business sign-ups" description="When off, only invited businesses can register." />
          <Toggle
            checked={form.maintenance}
            onChange={(v) => set("maintenance", v)}
            label="Maintenance mode"
            description="Shows a maintenance banner to owners. Public customer chats stay online."
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>AI & Limits</CardTitle>
          <CardDescription>Throughput and alerting for the agent system</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Chat Rate Limit (req/min per session)"
            type="number"
            min={1}
            value={form.rateLimit}
            onChange={(e) => set("rateLimit", e.target.value)}
          />
          <Input
            label="Latency Alert Threshold (ms)"
            type="number"
            min={100}
            step={100}
            value={form.latencyAlertMs}
            onChange={(e) => set("latencyAlertMs", e.target.value)}
            helperText="Alert when p95 latency stays above this for 15 min."
          />
        </div>
        <Toggle checked={form.voiceEnabled} onChange={(v) => set("voiceEnabled", v)} label="Voice input (speech-to-text)" description="Makes the microphone available to tenants that enable it." />
      </Card>

      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>Security</CardTitle>
          <CardDescription>Access rules for admin accounts</CardDescription>
        </CardHeader>
        <Toggle checked={form.requireMfa} onChange={(v) => set("requireMfa", v)} label="Require two-factor sign-in for admins" />
      </Card>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

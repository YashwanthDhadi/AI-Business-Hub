"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, ExternalLink, Pencil, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, Input, Textarea, Toggle, Button, QrCodeGraphic } from "@/components/ui";
import type { AssistantSettings, AssistantTone, FaqItem } from "@/types";
import { cn } from "@/lib/utils";
import { getPublicChatUrl } from "@/lib/constants";
import { ChatMessageBubble } from "@/features/customer-chat/components/ChatMessageBubble";
import { DescriptionField } from "./ProfileAndHoursSettings";

const TONES: { value: AssistantTone; label: string; example: string }[] = [
  { value: "friendly", label: "Friendly", example: "Hey! Happy to help you book." },
  { value: "professional", label: "Professional", example: "Certainly. I can arrange that for you." },
  { value: "energetic", label: "Energetic", example: "Let's go! Your session is booked!" },
  { value: "calm", label: "Calm", example: "Of course. Take your time choosing." },
];

const BRAND_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#e11d48", "#7c3aed"];

interface ChatSettingsProps {
  settings: AssistantSettings;
  slug: string;
  onChange: (patch: Partial<AssistantSettings>) => void;
  onSlugChange: (slug: string) => void;
}

export function ChatSettings({ settings, slug, onChange, onSlugChange }: ChatSettingsProps) {
  // Real origin, so the prefix and the QR match the link that actually works.
  const publicUrl = getPublicChatUrl(slug);
  const prefix = publicUrl.slice(0, publicUrl.lastIndexOf("/") + 1).replace(/^https?:\/\//, "");

  return (
    <Card className="space-y-5">
      <CardHeader className="pb-0">
        <CardTitle>Customer Chat Settings</CardTitle>
        <CardDescription>Your public chat link and what customers can do in it.</CardDescription>
      </CardHeader>

      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="chat-slug" className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
            Chat Link
          </label>
          <div className="flex rounded-lg border border-gray-800 bg-gray-950/70 overflow-hidden focus-within:border-indigo-500">
            <span className="px-3 py-2 text-xs text-gray-500 bg-gray-900 border-r border-gray-800 whitespace-nowrap hidden sm:block">{prefix}</span>
            <input
              id="chat-slug"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-400">Changing this breaks links and QR codes you have already shared.</p>
        </div>
        <QrCodeGraphic value={publicUrl} svgClassName="w-16 h-16" label="" className="self-start sm:self-center p-2" />
      </div>

      <div className="space-y-4 divide-y divide-gray-800/80">
        <Toggle checked={settings.chatEnabled} onChange={(chatEnabled) => onChange({ chatEnabled })} label="Customer chat is live" description="Turn off to pause the chat. Customers will see your phone number instead." />
        <div className="pt-4">
          <Toggle checked={settings.allowBookings} onChange={(allowBookings) => onChange({ allowBookings })} label="Customers can book in the chat" description="The assistant shows open times and takes bookings." />
        </div>
        <div className="pt-4">
          <Toggle
            checked={settings.requireBookingApproval}
            onChange={(requireBookingApproval) => onChange({ requireBookingApproval })}
            disabled={!settings.allowBookings}
            label="I approve bookings first"
            description="New chat bookings arrive as Pending until you confirm them."
          />
        </div>
        <div className="pt-4">
          <Toggle checked={settings.handoffToStaff} onChange={(handoffToStaff) => onChange({ handoffToStaff })} label="Pass hard questions to my team" description="When the assistant isn't sure, it tells the customer you'll reply and flags it for you." />
        </div>
        <div className="pt-4">
          <Toggle checked={settings.voiceInputEnabled} onChange={(voiceInputEnabled) => onChange({ voiceInputEnabled })} label="Voice messages" description="Show a microphone so customers can speak instead of type." />
        </div>
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-gray-300 uppercase tracking-wider">Chat Color</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Chat color">
          {BRAND_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={settings.brandColor === c}
              aria-label={`Color ${c}`}
              onClick={() => onChange({ brandColor: c })}
              className={cn("w-8 h-8 rounded-full border-2 transition-transform cursor-pointer", settings.brandColor === c ? "border-white scale-110" : "border-transparent")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

interface AssistantBehaviorProps {
  settings: AssistantSettings;
  onChange: (patch: Partial<AssistantSettings>) => void;
}

export function AssistantBehaviorSettings({ settings, onChange }: AssistantBehaviorProps) {
  const [editingFaq, setEditingFaq] = useState<string | null>(null);

  const updateFaq = (id: string, patch: Partial<FaqItem>) => onChange({ faqs: settings.faqs.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const addFaq = () => {
    const id = `faq-${Date.now()}`;
    onChange({ faqs: [...settings.faqs, { id, question: "", answer: "" }] });
    setEditingFaq(id);
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>Assistant Personality</CardTitle>
          <CardDescription>How your assistant introduces itself and talks to customers.</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <Input label="Assistant Name" value={settings.assistantName} onChange={(e) => onChange({ assistantName: e.target.value })} />
            <Textarea label="Greeting" rows={3} value={settings.greeting} onChange={(e) => onChange({ greeting: e.target.value })} helperText="The first message customers see." />
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Live preview</span>
              <Link href="/chat/fitzone" target="_blank" className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
                Try it <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <ChatMessageBubble
              perspective="customer"
              assistantName={settings.assistantName || "Assistant"}
              message={{ id: "preview-1", sender: "assistant", text: settings.greeting || "…", timestamp: "now" }}
            />
            <ChatMessageBubble perspective="customer" message={{ id: "preview-2", sender: "customer", text: "Can I book a session?", timestamp: "now" }} />
            <ChatMessageBubble
              perspective="customer"
              assistantName={settings.assistantName || "Assistant"}
              message={{ id: "preview-3", sender: "assistant", text: TONES.find((t) => t.value === settings.tone)?.example ?? "", timestamp: "now" }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-gray-300 uppercase tracking-wider">Tone</span>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="Tone">
            {TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={settings.tone === t.value}
                onClick={() => onChange({ tone: t.value })}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors cursor-pointer",
                  settings.tone === t.value ? "border-indigo-500 bg-indigo-950/40" : "border-gray-800 bg-gray-950/60 hover:border-gray-700"
                )}
              >
                <div className="text-sm font-semibold text-white">{t.label}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">&ldquo;{t.example}&rdquo;</div>
              </button>
            ))}
          </div>
        </div>

        <DescriptionField value={settings.businessDescription} onChange={(businessDescription) => onChange({ businessDescription })} />
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <CardHeader className="pb-0">
            <CardTitle>Frequently Asked Questions</CardTitle>
            <CardDescription>Your assistant answers these exactly as you write them.</CardDescription>
          </CardHeader>
          <Button size="sm" onClick={addFaq} className="self-start">
            <Plus className="w-3.5 h-3.5" /> Add Question
          </Button>
        </div>
        <ul className="space-y-2">
          {settings.faqs.map((f) => (
            <li key={f.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
              {editingFaq === f.id ? (
                <div className="space-y-2">
                  <Input label="Question" id={`${f.id}-q`} value={f.question} onChange={(e) => updateFaq(f.id, { question: e.target.value })} placeholder="e.g. Do you have showers?" autoFocus />
                  <Textarea label="Answer" id={`${f.id}-a`} rows={2} value={f.answer} onChange={(e) => updateFaq(f.id, { answer: e.target.value })} />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setEditingFaq(null)}>
                      <Check className="w-3.5 h-3.5" /> Done
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{f.question || "Untitled question"}</div>
                    <p className="text-xs text-gray-400 mt-0.5">{f.answer || "No answer yet."}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setEditingFaq(f.id)} aria-label={`Edit ${f.question}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange({ faqs: settings.faqs.filter((x) => x.id !== f.id) })}
                      aria-label={`Delete ${f.question}`}
                      className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

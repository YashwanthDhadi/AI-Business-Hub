"use client";

import React, { useEffect, useState } from "react";
import { Settings, Save, RotateCcw, Building2, Clock, LayoutGrid, MessageSquare, Sparkles } from "lucide-react";
import { Button, PageHeader, Toast } from "@/components/ui";
import { ProfileSettings, HoursSettings } from "@/features/settings/components/ProfileAndHoursSettings";
import { ServicesSettings } from "@/features/settings/components/ServicesSettings";
import { ChatSettings, AssistantBehaviorSettings } from "@/features/settings/components/AssistantSettingsPanel";
import { mockBusiness, mockAssistantSettings } from "@/data";
import type { AssistantSettings, BusinessProfile } from "@/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";

type Section = "profile" | "hours" | "services" | "chat" | "assistant";

const SECTIONS: { id: Section; label: string; icon: typeof Settings }[] = [
  { id: "profile", label: "Business Profile", icon: Building2 },
  { id: "hours", label: "Working Hours", icon: Clock },
  { id: "services", label: "Services", icon: LayoutGrid },
  { id: "chat", label: "Customer Chat", icon: MessageSquare },
  { id: "assistant", label: "AI Assistant", icon: Sparkles },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("profile");
  const [saved, setSaved] = useState<{ profile: BusinessProfile; assistant: AssistantSettings }>({
    profile: mockBusiness,
    assistant: mockAssistantSettings,
  });
  const [profile, setProfile] = useState<BusinessProfile>(mockBusiness);
  const [assistant, setAssistant] = useState<AssistantSettings>(mockAssistantSettings);
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const dirty = JSON.stringify(profile) !== JSON.stringify(saved.profile) || JSON.stringify(assistant) !== JSON.stringify(saved.assistant);

  const patchProfile = (patch: Partial<BusinessProfile>) => setProfile((p) => ({ ...p, ...patch }));
  const patchAssistant = (patch: Partial<AssistantSettings>) => setAssistant((a) => ({ ...a, ...patch }));

  /** Knowledge lives in the database; the rest of this screen is still mock. */
  useEffect(() => {
    if (!LIVE_BUSINESS_ID) return;
    (async () => {
      try {
        const faqs = await dashboardApi.knowledge();
        setAssistant((a) => ({ ...a, faqs }));
        setSaved((s) => ({ ...s, assistant: { ...s.assistant, faqs } }));
      } catch {
        showToast("Could not load the knowledge base.", "error");
      }
    })();
  }, [showToast]);

  const save = async () => {
    if (!profile.name.trim()) {
      setSection("profile");
      showToast("Business name can't be empty.", "error");
      return;
    }
    setSaving(true);

    try {
      // --- knowledge base: diff the FAQ list against what we last saved ---
      const before = new Map(saved.assistant.faqs.map((f) => [f.id, f]));
      const after = new Map(assistant.faqs.map((f) => [f.id, f]));
      let created = 0;

      for (const faq of assistant.faqs) {
        const question = faq.question.trim();
        const answer = faq.answer.trim();
        // The editor adds an empty row on "Add"; skip half-typed ones rather
        // than sending a 422 back to the owner.
        if (question.length < 3 || answer.length < 3) continue;

        const previous = before.get(faq.id);
        if (!previous) {
          await dashboardApi.createArticle(question, answer);
          created += 1;
        } else if (previous.question !== question || previous.answer !== answer) {
          await dashboardApi.updateArticle(faq.id, question, answer);
        }
      }

      for (const faq of saved.assistant.faqs) {
        if (!after.has(faq.id)) await dashboardApi.deleteArticle(faq.id);
      }

      // --- chat settings that live on the businesses row ---
      await dashboardApi.updateChatSettings({
        chat_greeting: assistant.greeting,
        chat_enabled: assistant.chatEnabled,
      });

      // Re-read so local ids are replaced by real database ids.
      const faqs = await dashboardApi.knowledge();
      const next = { ...assistant, faqs };
      setAssistant(next);
      setSaved({ profile, assistant: next });
      showToast(
        created > 0
          ? `Saved. The assistant can now answer ${created} new question${created === 1 ? "" : "s"}.`
          : "Settings saved. Your customer chat is updated.",
      );
    } catch (error) {
      showToast(error instanceof HubError ? error.message : "Could not save.", "error");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setProfile(saved.profile);
    setAssistant(saved.assistant);
    showToast("Changes discarded.", "info");
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Your business details, hours, services and how your customer chat behaves."
        actions={
          <Button size="sm" onClick={() => void save()} isLoading={saving} disabled={!dirty} className="text-xs">
            {!saving && <Save className="w-3.5 h-3.5" />} Save Changes
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
        {/* Section nav: horizontal scroll on mobile, vertical list on desktop */}
        <nav aria-label="Settings sections" className="lg:col-span-1">
          <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible bg-gray-900/60 border border-gray-800 rounded-xl p-1 lg:sticky lg:top-20">
            {SECTIONS.map((s) => (
              <li key={s.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={section === s.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                    section === s.id ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
                  )}
                >
                  <s.icon className="w-4 h-4" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-3 min-w-0">
          {section === "profile" && <ProfileSettings profile={profile} onChange={patchProfile} onNotify={(m) => showToast(m, "info")} />}
          {section === "hours" && <HoursSettings hours={profile.workingHours} onChange={(workingHours) => patchProfile({ workingHours })} />}
          {section === "services" && <ServicesSettings services={profile.services} onChange={(services) => patchProfile({ services })} />}
          {section === "chat" && (
            <ChatSettings settings={assistant} slug={profile.slug} onChange={patchAssistant} onSlugChange={(slug) => patchProfile({ slug })} />
          )}
          {section === "assistant" && <AssistantBehaviorSettings settings={assistant} onChange={patchAssistant} />}
        </div>
      </div>

      {/* Unsaved changes bar */}
      {dirty && (
        <div className="fixed bottom-4 left-4 right-4 md:left-[calc(16rem+1.5rem)] md:right-6 z-40 rounded-xl border border-indigo-500/40 bg-gray-900/95 backdrop-blur px-4 py-3 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-sm text-gray-200">You have unsaved changes.</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={discard}>
              <RotateCcw className="w-3.5 h-3.5" /> Discard
            </Button>
            <Button size="sm" onClick={() => void save()} isLoading={saving}>
              {!saving && <Save className="w-3.5 h-3.5" />} Save
            </Button>
          </div>
        </div>
      )}
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

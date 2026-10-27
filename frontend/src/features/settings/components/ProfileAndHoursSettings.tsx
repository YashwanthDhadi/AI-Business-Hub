"use client";

import React, { useRef } from "react";
import { Upload, Copy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, Input, Select, Textarea, Toggle, Button } from "@/components/ui";
import type { BusinessProfile, WorkingHours } from "@/types";
import { cn, getInitials } from "@/lib/utils";

const TIME_OPTIONS = Array.from({ length: 38 }, (_, i) => {
  const minutes = 5 * 60 + i * 30; // 5:00 AM → 11:30 PM
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  const label = `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
  return { label, value: label };
});

interface ProfileSettingsProps {
  profile: BusinessProfile;
  onChange: (patch: Partial<BusinessProfile>) => void;
  onNotify: (message: string) => void;
}

export function ProfileSettings({ profile, onChange, onNotify }: ProfileSettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const field = (key: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ [key]: e.target.value });

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>Business Profile</CardTitle>
          <CardDescription>How your business appears to customers in the chat and on messages.</CardDescription>
        </CardHeader>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-lg font-bold shadow-md flex-shrink-0">
            {getInitials(profile.name) || "?"}
          </div>
          <div className="space-y-1">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Upload Logo
            </Button>
            <p className="text-[11px] text-gray-500">PNG or JPG, square works best.</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onNotify(`${f.name} selected. Logos will be saved once accounts are connected (demo).`);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Business Name" value={profile.name} onChange={field("name")} required />
          <Input label="Business Type" value={profile.type} onChange={field("type")} />
        </div>
        <Input label="Tagline" value={profile.tagline} onChange={field("tagline")} helperText="One line shown at the top of your customer chat." />
      </Card>

      <Card className="space-y-4">
        <CardHeader className="pb-0">
          <CardTitle>Business Information</CardTitle>
          <CardDescription>Contact details your assistant shares when customers ask.</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Email" type="email" value={profile.email} onChange={field("email")} />
          <Input label="Phone" value={profile.phone} onChange={field("phone")} />
          <Input label="Street Address" value={profile.address} onChange={field("address")} />
          <Input label="City" value={profile.city} onChange={field("city")} />
        </div>
        <Select
          label="Currency"
          value={profile.currency}
          onChange={(currency) => onChange({ currency })}
          options={[
            { label: "Indian Rupee (₹ INR)", value: "INR" },
            { label: "US Dollar (USD)", value: "USD" },
            { label: "Euro (EUR)", value: "EUR" },
            { label: "British Pound (GBP)", value: "GBP" },
          ]}
          wrapperClassName="sm:w-64"
        />
      </Card>
    </div>
  );
}

interface HoursSettingsProps {
  hours: WorkingHours[];
  onChange: (hours: WorkingHours[]) => void;
}

export function HoursSettings({ hours, onChange }: HoursSettingsProps) {
  const update = (day: WorkingHours["day"], patch: Partial<WorkingHours>) =>
    onChange(hours.map((h) => (h.day === day ? { ...h, ...patch } : h)));

  const copyMondayToWeekdays = () => {
    const monday = hours.find((h) => h.day === "Monday");
    if (!monday) return;
    onChange(hours.map((h) => (["Tuesday", "Wednesday", "Thursday", "Friday"].includes(h.day) ? { ...h, isOpen: monday.isOpen, openTime: monday.openTime, closeTime: monday.closeTime } : h)));
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <CardHeader className="pb-0">
          <CardTitle>Working Hours</CardTitle>
          <CardDescription>Your customer chat only offers booking times inside these hours.</CardDescription>
        </CardHeader>
        <Button variant="ghost" size="sm" onClick={copyMondayToWeekdays} className="self-start">
          <Copy className="w-3.5 h-3.5" /> Copy Monday to weekdays
        </Button>
      </div>
      <ul className="divide-y divide-gray-800/80">
        {hours.map((h) => (
          <li key={h.day} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center justify-between sm:w-44 gap-3">
              <span className={cn("text-sm font-medium", h.isOpen ? "text-white" : "text-gray-500")}>{h.day}</span>
              <Toggle checked={h.isOpen} onChange={(isOpen) => update(h.day, { isOpen })} ariaLabel={`${h.day} open`} />
            </div>
            {h.isOpen ? (
              <div className="flex items-center gap-2 flex-1">
                <Select aria-label={`${h.day} opening time`} value={h.openTime} onChange={(openTime) => update(h.day, { openTime })} options={TIME_OPTIONS} wrapperClassName="flex-1 sm:max-w-36" />
                <span className="text-xs text-gray-500">to</span>
                <Select aria-label={`${h.day} closing time`} value={h.closeTime} onChange={(closeTime) => update(h.day, { closeTime })} options={TIME_OPTIONS} wrapperClassName="flex-1 sm:max-w-36" />
              </div>
            ) : (
              <span className="text-xs text-gray-500">Closed all day</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DescriptionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Textarea
      label="Business Description"
      rows={4}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText="Your assistant uses this to describe your business to customers."
    />
  );
}

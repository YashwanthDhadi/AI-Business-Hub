"use client";

import React, { useState } from "react";
import { ScrollText } from "lucide-react";
import { Card, PageHeader, SearchInput, Select, SegmentedTabs } from "@/components/ui";
import { ActivityFeed } from "@/features/admin/components/ActivityFeed";
import { mockPlatformActivity } from "@/data";
import type { PlatformActivityEvent } from "@/types";

type Severity = PlatformActivityEvent["severity"] | "all";

export default function AdminActivityPage() {
  const [severity, setSeverity] = useState<Severity>("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const count = (s: PlatformActivityEvent["severity"]) => mockPlatformActivity.filter((e) => e.severity === s).length;
  const events = mockPlatformActivity
    .filter((e) => {
      const q = search.trim().toLowerCase();
      return (
        (severity === "all" || e.severity === severity) &&
        (category === "all" || e.category === category) &&
        (!q || e.message.toLowerCase().includes(q) || e.actor.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-6">
      <PageHeader icon={ScrollText} title="Activity" description="Audit log of tenant, billing, AI, security and system events." />
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs<Severity>
          tabs={[
            { label: "All", value: "all", count: mockPlatformActivity.length },
            { label: "Critical", value: "critical", count: count("critical") },
            { label: "Warning", value: "warning", count: count("warning") },
            { label: "Success", value: "success", count: count("success") },
            { label: "Info", value: "info", count: count("info") },
          ]}
          value={severity}
          onChange={setSeverity}
          className="self-start"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search events or actors..." className="w-full sm:w-64" />
          <Select
            aria-label="Filter by category"
            value={category}
            onChange={setCategory}
            options={[
              { label: "All categories", value: "all" },
              { label: "Tenant", value: "tenant" },
              { label: "Billing", value: "billing" },
              { label: "AI", value: "ai" },
              { label: "Security", value: "security" },
              { label: "System", value: "system" },
            ]}
            wrapperClassName="w-full sm:w-40"
          />
        </div>
      </div>
      <Card>
        <ActivityFeed events={events} showBadges />
      </Card>
    </div>
  );
}

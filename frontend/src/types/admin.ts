export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  plan: "starter" | "growth" | "enterprise";
  status: "active" | "suspended" | "trial";
  createdAt: string;
  monthlyRevenue: number;
  aiRequestsCount: number;
  totalCustomersCount: number;
  industry?: string;
  staffCount?: number;
  /** Monthly AI request allowance for the plan. */
  aiRequestLimit?: number;
  lastActiveAt?: string;
}

export interface AiAgentStatus {
  agentId: string;
  name: string;
  role: string;
  status: "operational" | "degraded" | "offline";
  uptimePercent: number;
  totalRequestsToday: number;
  averageLatencyMs: number;
  errorRatePercent: number;
  /** "agent" = a capability agent; "router" = internal orchestration; "input" = voice/speech. */
  kind?: "agent" | "router" | "input";
  errorsToday?: number;
  p95LatencyMs?: number;
  /** Average latency per hour over the last 12 hours (oldest first). */
  latencyHistory?: number[];
}

export interface PlatformHealthMetric {
  totalBusinesses: number;
  activeBusinesses: number;
  totalUsers: number;
  totalAiRequestsToday: number;
  platformUptimePercent: number;
  activeAiAgents: number;
  totalRevenueMtd: number;
}

export interface PlatformUserRecord {
  id: string;
  name: string;
  email: string;
  role: "platform_admin" | "business_owner" | "staff";
  businessId?: string;
  businessName?: string;
  status: "active" | "invited" | "suspended";
  lastActiveAt?: string;
  createdAt: string;
}

export interface PlatformServiceHealth {
  id: string;
  name: string;
  status: "operational" | "degraded" | "offline";
  latencyMs: number;
  detail: string;
}

export interface PlatformActivityEvent {
  id: string;
  at: string;
  severity: "info" | "warning" | "critical" | "success";
  category: "tenant" | "billing" | "ai" | "security" | "system";
  message: string;
  actor: string;
}

export interface PlatformMonthlyMetric {
  month: string;
  mrr: number;
  businesses: number;
  aiRequests: number;
}

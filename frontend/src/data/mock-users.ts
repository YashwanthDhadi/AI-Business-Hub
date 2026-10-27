import { User } from "@/types";

export const mockUsers: User[] = [
  {
    id: "usr-owner-1",
    name: "Yashwanth",
    email: "yash@fitzone.com",
    role: "business_owner",
    businessId: "biz-fitzone-001",
    createdAt: "2026-01-15T08:00:00Z",
  },
  {
    id: "usr-admin-1",
    name: "System Administrator",
    email: "admin@aibusinesshub.com",
    role: "platform_admin",
    createdAt: "2025-11-01T00:00:00Z",
  },
  {
    id: "usr-staff-1",
    name: "Alex Rivera",
    email: "alex@fitzone.com",
    role: "staff",
    businessId: "biz-fitzone-001",
    createdAt: "2026-02-01T10:00:00Z",
  },
];

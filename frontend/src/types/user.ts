export type UserRole = "platform_admin" | "business_owner" | "staff";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  businessId?: string;
  avatarUrl?: string;
  createdAt: string;
}

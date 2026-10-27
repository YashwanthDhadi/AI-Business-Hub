export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  category?: string;
}

export interface WorkingHours {
  day: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export interface BusinessCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface BusinessProfile {
  id: string;
  name: string;
  slug: string;
  type: string;
  tagline: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  currency: string;
  logoUrl?: string;
  workingHours: WorkingHours[];
  services: ServiceItem[];
  enabledCapabilities: string[];
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export type AssistantTone = "friendly" | "professional" | "energetic" | "calm";

export interface AssistantSettings {
  assistantName: string;
  greeting: string;
  tone: AssistantTone;
  businessDescription: string;
  faqs: FaqItem[];
  allowBookings: boolean;
  requireBookingApproval: boolean;
  handoffToStaff: boolean;
  voiceInputEnabled: boolean;
  chatEnabled: boolean;
  brandColor: string;
}

export interface MembershipPlan {
  id: string;
  name: string;
  pricePerMonth: number;
  includes: string;
}

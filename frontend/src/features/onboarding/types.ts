import { ServiceItem } from "@/types";

export interface OnboardingState {
  // Step 1: Info
  businessName: string;
  businessSlug: string;
  businessType: string;
  phone: string;
  city: string;
  address: string;
  description: string;

  // Step 2: Hours & Services
  workingHoursSummary: string;
  services: ServiceItem[];

  // Step 3: AI Capabilities
  selectedCapabilities: string[];
}

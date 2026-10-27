import React from "react";
import { Input, Button } from "@/components/ui";
import { OnboardingState } from "../types";
import { ArrowRight, Building } from "lucide-react";

interface StepBusinessProfileProps {
  data: OnboardingState;
  onChange: (updates: Partial<OnboardingState>) => void;
  onNext: () => void;
}

export function StepBusinessProfile({
  data,
  onChange,
  onNext,
}: StepBusinessProfileProps) {
  const businessTypes = [
    "Fitness & Gym",
    "Dental & Clinic",
    "Salon & Spa",
    "Legal & Accounting",
    "Automotive & Repair",
    "Consulting & Coaching",
    "Restaurant & Cafe",
    "Retail & Goods",
  ];

  const handleNameChange = (name: string) => {
    // Generate clean slug from business name if user hasn't explicitly customized slug
    const generatedSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    onChange({ businessName: name, businessSlug: generatedSlug });
  };

  const isFormValid =
    data.businessName.trim().length > 0 &&
    data.businessSlug.trim().length > 0 &&
    data.phone.trim().length > 0 &&
    data.city.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-800 pb-4">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Building className="w-5 h-5 text-indigo-400" />
          Business Information
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Tell us about your company. This information will help configure your AI customer assistant.
        </p>
      </div>

      <div className="space-y-4">
        {/* Business Name */}
        <Input
          label="Business Name"
          placeholder="e.g. FitZone Fitness Club"
          value={data.businessName}
          onChange={(e) => handleNameChange(e.target.value)}
          required
        />

        {/* Business Slug */}
        <div className="w-full space-y-1.5">
          <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
            Customer Chat Link Slug
          </label>
          <div className="flex rounded-lg border border-gray-800 bg-gray-950/70 overflow-hidden focus-within:border-indigo-500">
            <span className="inline-flex items-center px-3 text-xs text-gray-500 bg-gray-900 border-r border-gray-800 font-mono">
              aibusinesshub.com/chat/
            </span>
            <input
              type="text"
              className="flex-1 bg-transparent px-3 py-2 text-sm text-indigo-300 font-mono focus:outline-none"
              placeholder="fitzone"
              value={data.businessSlug}
              onChange={(e) => onChange({ businessSlug: e.target.value })}
              required
            />
          </div>
          <p className="text-[11px] text-gray-500">
            This will be your business&apos;s unique customer chat URL.
          </p>
        </div>

        {/* Business Type */}
        <div className="w-full space-y-1.5">
          <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
            Industry / Business Type
          </label>
          <select
            value={data.businessType}
            onChange={(e) => onChange({ businessType: e.target.value })}
            className="w-full rounded-lg bg-gray-950/70 border border-gray-800 px-3.5 py-2 text-sm text-gray-100 transition-colors focus:border-indigo-500 focus:outline-none"
          >
            {businessTypes.map((type) => (
              <option key={type} value={type} className="bg-gray-900">
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Phone & City */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Business Phone"
            type="tel"
            placeholder="98765 43210"
            value={data.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            required
          />
          <Input
            label="City, State"
            placeholder="Austin, TX"
            value={data.city}
            onChange={(e) => onChange({ city: e.target.value })}
            required
          />
        </div>

        {/* Physical Address */}
        <Input
          label="Street Address"
          placeholder="742 Evergreen Terrace, Suite 100"
          value={data.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />

        {/* Description */}
        <div className="w-full space-y-1.5">
          <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
            Business Overview & Tone
          </label>
          <textarea
            rows={3}
            className="w-full rounded-lg bg-gray-950/70 border border-gray-800 px-3.5 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none"
            placeholder="Describe what services you provide and what tone the AI should use (e.g., high-energy, friendly, elite coaching)..."
            value={data.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-gray-800">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!isFormValid}
          onClick={onNext}
        >
          Continue to Hours & Services
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

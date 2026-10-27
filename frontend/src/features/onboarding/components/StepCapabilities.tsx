import React from "react";
import { Button } from "@/components/ui";
import { OnboardingState } from "../types";
import {
  MessageSquare,
  Calendar,
  CreditCard,
  Package,
  TrendingUp,
  FileText,
  Send,
  Check,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StepCapabilitiesProps {
  data: OnboardingState;
  onChange: (updates: Partial<OnboardingState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepCapabilities({
  data,
  onChange,
  onNext,
  onBack,
}: StepCapabilitiesProps) {
  const capabilities = [
    {
      id: "Customer Support",
      name: "Answer Customer Questions",
      description: "Direct customer-facing web chat to answer FAQs, hours, and directions 24/7.",
      icon: MessageSquare,
    },
    {
      id: "Bookings",
      name: "Take Bookings",
      description: "Checks appointment availability and confirms customer reservations.",
      icon: Calendar,
    },
    {
      id: "Payments",
      name: "Track Payments & Invoices",
      description: "Generates invoice summaries, tracks pending customer bills, and shares payment links.",
      icon: CreditCard,
    },
    {
      id: "Inventory",
      name: "Watch Stock Levels",
      description: "Monitors catalog levels and warns staff when products drop below thresholds.",
      icon: Package,
    },
    {
      id: "Reports",
      name: "Weekly Business Reports",
      description: "Generates weekly executive summaries, revenue trends, and conversion metrics.",
      icon: TrendingUp,
    },
    {
      id: "Documents",
      name: "Answer From Your Documents",
      description: "Reads your waivers, PDFs, and price lists so your assistant quotes accurate information.",
      icon: FileText,
    },
    {
      id: "Communication",
      name: "Send Reminders & Messages",
      description: "Dispatches automated appointment reminders and broadcasts to customers.",
      icon: Send,
    },
  ];

  const toggleCapability = (id: string) => {
    const exists = data.selectedCapabilities.includes(id);
    if (exists) {
      onChange({
        selectedCapabilities: data.selectedCapabilities.filter((c) => c !== id),
      });
    } else {
      onChange({
        selectedCapabilities: [...data.selectedCapabilities, id],
      });
    }
  };

  const selectAll = () => {
    onChange({
      selectedCapabilities: capabilities.map((c) => c.id),
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            Select AI Capabilities
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Choose which AI capabilities you want enabled in your business operating system.
          </p>
        </div>
        <button
          type="button"
          onClick={selectAll}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium self-start sm:self-center cursor-pointer"
        >
          Select All Capabilities
        </button>
      </div>

      {/* Capabilities Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {capabilities.map((cap) => {
          const isSelected = data.selectedCapabilities.includes(cap.id);
          const IconComponent = cap.icon;

          return (
            <div
              key={cap.id}
              onClick={() => toggleCapability(cap.id)}
              className={cn(
                "p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none",
                isSelected
                  ? "bg-indigo-950/30 border-indigo-500/50 shadow-sm"
                  : "bg-gray-900/40 border-gray-800 hover:border-gray-700 opacity-70 hover:opacity-100"
              )}
            >
              <div
                className={cn(
                  "w-5 h-5 rounded flex items-center justify-center mt-0.5 transition-colors border",
                  isSelected
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "border-gray-700 bg-gray-950"
                )}
              >
                {isSelected && <Check className="w-3.5 h-3.5" />}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <IconComponent className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-sm font-semibold text-white">{cap.name}</h4>
                </div>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {cap.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-800">
        <Button type="button" variant="outline" size="md" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={data.selectedCapabilities.length === 0}
          onClick={onNext}
        >
          Generate Customer Link & Finish
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot, Sparkles, ArrowLeft } from "lucide-react";
import { OnboardingState } from "@/features/onboarding/types";
import { StepIndicator } from "@/features/onboarding/components/StepIndicator";
import { StepBusinessProfile } from "@/features/onboarding/components/StepBusinessProfile";
import { StepServicesHours } from "@/features/onboarding/components/StepServicesHours";
import { StepCapabilities } from "@/features/onboarding/components/StepCapabilities";
import { StepCompletion } from "@/features/onboarding/components/StepCompletion";
import { mockBusiness } from "@/data/mock-business";

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [state, setState] = useState<OnboardingState>({
    businessName: "",
    businessSlug: "",
    businessType: "Fitness & Gym",
    phone: "",
    city: "",
    address: "",
    description: "",
    workingHoursSummary: "Mon-Fri: 06:00 AM - 10:00 PM | Sat: 07:00 AM - 08:00 PM | Sun: 08:00 AM - 06:00 PM",
    services: [],
    selectedCapabilities: [
      "Customer Support",
      "Bookings",
      "Payments",
      "Inventory",
      "Reports",
      "Documents",
      "Communication",
    ],
  });

  const stepLabels = [
    "Business Info",
    "Hours & Services",
    "AI Capabilities",
    "Customer Link",
  ];

  const updateState = (updates: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  };

  // Instant demo data loader for quick testing
  const handlePreFillFitZone = () => {
    setState({
      businessName: mockBusiness.name,
      businessSlug: mockBusiness.slug,
      businessType: mockBusiness.type,
      phone: mockBusiness.phone,
      city: mockBusiness.city,
      address: mockBusiness.address,
      description: mockBusiness.description,
      workingHoursSummary: "Mon-Fri: 06:00 AM - 10:00 PM | Sat: 07:00 AM - 08:00 PM | Sun: 08:00 AM - 06:00 PM",
      services: [...mockBusiness.services],
      selectedCapabilities: [...mockBusiness.enabledCapabilities],
    });
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top Header */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Exit Setup
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Bot className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold text-white tracking-tight">
            AI Business Hub Setup
          </span>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-3xl mx-auto w-full my-6 sm:my-8">
        {/* Pre-fill Shortcut Banner (visible in steps 1-3) */}
        {currentStep < 4 && (
          <div className="mb-6 flex justify-end">
            <button
              type="button"
              onClick={handlePreFillFitZone}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/40 text-xs text-indigo-300 hover:bg-indigo-900/40 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Pre-fill with FitZone Gym Demo Data
            </button>
          </div>
        )}

        {/* Step Indicator */}
        <StepIndicator
          currentStep={currentStep}
          totalSteps={4}
          steps={stepLabels}
        />

        {/* Step Body Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {currentStep === 1 && (
            <StepBusinessProfile
              data={state}
              onChange={updateState}
              onNext={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <StepServicesHours
              data={state}
              onChange={updateState}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 3 && (
            <StepCapabilities
              data={state}
              onChange={updateState}
              onNext={() => setCurrentStep(4)}
              onBack={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 4 && <StepCompletion data={state} />}
        </div>
      </div>

      <div className="text-center text-xs text-gray-600">
        AI Business Hub • Guided Onboarding
      </div>
    </div>
  );
}

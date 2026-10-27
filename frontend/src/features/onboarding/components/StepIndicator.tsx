import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  steps: string[];
}

export function StepIndicator({
  currentStep,
  totalSteps,
  steps,
}: StepIndicatorProps) {
  return (
    <div className="w-full mb-8">
      {/* Step Numbers & Labels */}
      <div className="flex items-center justify-between max-w-2xl mx-auto relative">
        {/* Continuous connector line behind circles */}
        <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-800 -z-0" />
        <div
          className="absolute top-4 left-0 h-0.5 bg-indigo-600 transition-all duration-300 -z-0"
          style={{
            width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%`,
          }}
        />

        {steps.map((label, index) => {
          const stepNum = index + 1;
          const isCompleted = currentStep > stepNum;
          const isCurrent = currentStep === stepNum;

          return (
            <div key={label} className="flex flex-col items-center relative z-10">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 border-2",
                  isCompleted && "bg-indigo-600 border-indigo-600 text-white",
                  isCurrent && "bg-gray-900 border-indigo-500 text-indigo-400 ring-4 ring-indigo-500/20",
                  !isCompleted && !isCurrent && "bg-gray-900 border-gray-700 text-gray-500"
                )}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium mt-2 hidden sm:block whitespace-nowrap",
                  isCurrent && "text-white font-semibold",
                  isCompleted && "text-gray-300",
                  !isCompleted && !isCurrent && "text-gray-500"
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

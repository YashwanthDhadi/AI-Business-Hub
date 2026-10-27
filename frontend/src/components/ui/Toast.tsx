"use client";

import React from "react";
import { CheckCircle2, Info, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToastMessage } from "@/hooks/useToast";

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  if (!toast) return null;
  const Icon = toast.tone === "error" ? AlertCircle : toast.tone === "info" ? Info : CheckCircle2;
  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm z-[60] flex items-start gap-2.5 rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur px-4 py-3 shadow-2xl"
    >
      <Icon
        className={cn(
          "w-4 h-4 flex-shrink-0 mt-0.5",
          toast.tone === "error" ? "text-rose-400" : toast.tone === "info" ? "text-indigo-400" : "text-emerald-400"
        )}
      />
      <p className="text-sm text-gray-100 flex-1">{toast.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-gray-500 hover:text-white cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

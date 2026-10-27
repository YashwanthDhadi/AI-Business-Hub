import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-2xl border border-gray-800 bg-gray-900/40 p-10 sm:p-12 text-center space-y-3", className)}>
      <div className="w-12 h-12 rounded-xl bg-gray-800 text-gray-500 flex items-center justify-center mx-auto">
        <Icon className="w-6 h-6" />
      </div>
      <h4 className="text-base font-bold text-white">{title}</h4>
      {description && <p className="text-xs text-gray-400 max-w-sm mx-auto">{description}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

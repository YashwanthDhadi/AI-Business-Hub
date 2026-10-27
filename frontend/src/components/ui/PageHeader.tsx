import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  className?: string;
}

/** Standard page title block used at the top of every dashboard page. */
export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800/80 pb-5",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          {Icon && <Icon className="w-6 h-6 text-indigo-400 flex-shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        {description && <p className="text-xs sm:text-sm text-gray-400 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

import React from "react";
import Link from "next/link";
import { ArrowRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface RoleSelectCardProps {
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  href: string;
  badgeText: string;
  badgeVariant?: "brand" | "neutral" | "warning";
  accentColor?: "indigo" | "emerald" | "amber";
}

export function RoleSelectCard({
  title,
  subtitle,
  description,
  icon: Icon,
  href,
  badgeText,
  accentColor = "indigo",
}: RoleSelectCardProps) {
  const accentBorderHover = {
    indigo: "hover:border-indigo-500/60 hover:shadow-indigo-500/10",
    emerald: "hover:border-emerald-500/60 hover:shadow-emerald-500/10",
    amber: "hover:border-amber-500/60 hover:shadow-amber-500/10",
  };

  const iconBg = {
    indigo: "bg-indigo-600/15 text-indigo-400 border-indigo-500/30",
    emerald: "bg-emerald-600/15 text-emerald-400 border-emerald-500/30",
    amber: "bg-amber-600/15 text-amber-400 border-amber-500/30",
  };

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col justify-between rounded-2xl border border-gray-800 bg-gray-900/60 p-6 sm:p-8 transition-all duration-200 hover:-translate-y-1 shadow-lg cursor-pointer backdrop-blur-sm",
        accentBorderHover[accentColor]
      )}
    >
      <div>
        <div className="flex items-center justify-between mb-5">
          <div
            className={cn(
              "w-12 h-12 rounded-xl border flex items-center justify-center transition-transform group-hover:scale-105",
              iconBg[accentColor]
            )}
          >
            <Icon className="w-6 h-6" />
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-700 bg-gray-800/80 text-gray-300">
            {badgeText}
          </span>
        </div>

        <h3 className="text-xl font-bold text-white group-hover:text-indigo-300 transition-colors">
          {title}
        </h3>
        <p className="text-xs font-medium text-gray-400 mt-1 uppercase tracking-wider">
          {subtitle}
        </p>
        <p className="text-sm text-gray-400 mt-3 leading-relaxed">
          {description}
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-800/80 flex items-center justify-between text-sm font-medium text-gray-300 group-hover:text-white">
        <span>Proceed to Sign In</span>
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1 text-indigo-400" />
      </div>
    </Link>
  );
}

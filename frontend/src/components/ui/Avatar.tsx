import React from "react";
import { cn, getInitials } from "@/lib/utils";

const palette = [
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-purple-600",
  "bg-blue-600",
  "bg-teal-600",
];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const index = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % palette.length;
  const sizes = { sm: "w-7 h-7 text-[10px]", md: "w-9 h-9 text-xs", lg: "w-12 h-12 text-sm" };
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center text-white font-bold flex-shrink-0",
        palette[index],
        sizes[size],
        className
      )}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  );
}

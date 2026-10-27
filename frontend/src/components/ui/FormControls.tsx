import React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg bg-gray-950/80 border border-gray-800 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-50";

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
      {children}
    </label>
  );
}

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

export function SearchInput({ value, onChange, className, placeholder = "Search...", ...props }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(fieldBase, "pl-8 pr-3 py-1.5")}
        {...props}
      />
    </div>
  );
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  wrapperClassName?: string;
}

export function Select({ label, options, value, onChange, className, wrapperClassName, id, ...props }: SelectProps) {
  const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  return (
    <div className={cn(label && "space-y-1.5", wrapperClassName)}>
      {label && <FieldLabel htmlFor={selectId}>{label}</FieldLabel>}
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldBase, "px-2.5 py-1.5 text-gray-200 cursor-pointer", label && "py-2", className)}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, helperText, className, id, rows = 4, ...props }, ref) => {
    const areaId = id || (label ? `textarea-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
    return (
      <div className="w-full space-y-1.5">
        {label && <FieldLabel htmlFor={areaId}>{label}</FieldLabel>}
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          className={cn(fieldBase, "px-3.5 py-2 text-sm resize-y leading-relaxed", className)}
          {...props}
        />
        {helperText && <p className="text-xs text-gray-400">{helperText}</p>}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export interface SegmentedTab<T extends string> {
  label: string;
  value: T;
  count?: number;
}

export interface SegmentedTabsProps<T extends string> {
  tabs: SegmentedTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Pill-style tab switcher (same style as the Bookings status tabs). */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className }: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1 bg-gray-900/90 p-1 rounded-xl border border-gray-800 overflow-x-auto max-w-full",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5",
              isActive ? "bg-indigo-600 text-white shadow-sm font-semibold" : "text-gray-400 hover:text-white hover:bg-gray-800"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "text-[10px] px-1.5 rounded-full",
                  isActive ? "bg-white/20 text-white" : "bg-gray-800 text-gray-400"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Accessible name when no visible label is shown. */
  ariaLabel?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, ariaLabel }: ToggleProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-50")}>
      {(label || description) && (
        <div className="min-w-0">
          {label && <span className="block text-sm font-medium text-gray-200">{label}</span>}
          {description && <span className="block text-xs text-gray-400 mt-0.5">{description}</span>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border transition-colors cursor-pointer mt-0.5",
          checked ? "bg-indigo-600 border-indigo-500" : "bg-gray-800 border-gray-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}

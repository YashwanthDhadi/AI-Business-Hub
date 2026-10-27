import React from "react";
import { X } from "lucide-react";
import { SearchInput, Select, SegmentedTabs } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { BookingStatusFilter, BookingChannelFilter, BookingDateFilter } from "../types";

interface BookingFiltersProps {
  searchTerm: string;
  onSearchChange: (val: string) => void;
  statusFilter: BookingStatusFilter;
  onStatusFilterChange: (status: BookingStatusFilter) => void;
  statusCounts: Record<BookingStatusFilter, number>;
  serviceFilter: string;
  onServiceFilterChange: (serviceId: string) => void;
  serviceOptions: { id: string; name: string }[];
  dateFilter: BookingDateFilter;
  onDateFilterChange: (filter: BookingDateFilter) => void;
  selectedDate: string | null;
  channelFilter: BookingChannelFilter;
  onChannelFilterChange: (channel: BookingChannelFilter) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function BookingFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  serviceFilter,
  onServiceFilterChange,
  serviceOptions,
  dateFilter,
  onDateFilterChange,
  selectedDate,
  channelFilter,
  onChannelFilterChange,
  hasActiveFilters,
  onClearFilters,
}: BookingFiltersProps) {
  const statusTabs: { label: string; value: BookingStatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "Confirmed", value: "confirmed" },
    { label: "Pending", value: "pending" },
    { label: "Completed", value: "completed" },
    { label: "Cancelled", value: "cancelled" },
  ];

  const dateOptions = [
    { label: "All dates", value: "all" },
    { label: "Today", value: "today" },
    { label: "Upcoming", value: "upcoming" },
    { label: "Past", value: "past" },
    ...(selectedDate
      ? [{ label: formatDate(selectedDate, { weekday: "short", month: "short", day: "numeric" }), value: "selected" }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <SegmentedTabs
          tabs={statusTabs.map((t) => ({ ...t, count: statusCounts[t.value] }))}
          value={statusFilter}
          onChange={onStatusFilterChange}
          className="self-start"
        />
        <SearchInput
          value={searchTerm}
          onChange={onSearchChange}
          placeholder="Search customer, service or phone..."
          className="w-full lg:w-72"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by date"
          value={dateFilter}
          onChange={(v) => onDateFilterChange(v as BookingDateFilter)}
          options={dateOptions}
          wrapperClassName="w-[calc(50%-4px)] sm:w-40"
        />
        <Select
          aria-label="Filter by service"
          value={serviceFilter}
          onChange={onServiceFilterChange}
          options={[{ label: "All services", value: "all" }, ...serviceOptions.map((s) => ({ label: s.name, value: s.id }))]}
          wrapperClassName="w-[calc(50%-4px)] sm:w-60"
        />
        <Select
          aria-label="Filter by booking source"
          value={channelFilter}
          onChange={(v) => onChannelFilterChange(v as BookingChannelFilter)}
          options={[
            { label: "All sources", value: "all" },
            { label: "Booked via Customer Chat", value: "customer_chat" },
            { label: "Booked in Dashboard", value: "dashboard" },
            { label: "Walk-in / Phone", value: "manual" },
          ]}
          wrapperClassName="w-full sm:w-52"
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

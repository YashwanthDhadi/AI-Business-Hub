"use client";

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Card } from "@/components/ui";
import { Booking } from "@/types";
import { cn, toDateKey, timeToMinutes } from "@/lib/utils";
import { bookingStatusMeta } from "@/lib/status";
import { todayISO, LOCALE } from "@/lib/constants";

interface BookingCalendarProps {
  bookings: Booking[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onSelectBooking: (booking: Booking) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BookingCalendar({ bookings, selectedDate, onSelectDate, onSelectBooking }: BookingCalendarProps) {
  // Read once per mount. Recomputing on every render would make the "today"
  // highlight jump if the page were left open across midnight, but it would
  // also churn the memos below for no gain.
  const [today] = useState(todayISO);
  const [year, month] = today.split("-").map(Number);
  const [viewMonth, setViewMonth] = useState({ year, month: month - 1 });

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    }
    return map;
  }, [bookings]);

  const cells = useMemo(() => {
    const first = new Date(viewMonth.year, viewMonth.month, 1);
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const leading = first.getDay();
    const total = Math.ceil((leading + daysInMonth) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const date = new Date(viewMonth.year, viewMonth.month, i - leading + 1);
      return { key: toDateKey(date), day: date.getDate(), inMonth: date.getMonth() === viewMonth.month };
    });
  }, [viewMonth]);

  const monthLabel = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" }).format(
    new Date(viewMonth.year, viewMonth.month, 1)
  );

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const goToToday = () => {
    setViewMonth({ year, month: month - 1 });
    onSelectDate(today);
  };

  const agendaDate = selectedDate ?? today;
  const agenda = bookingsByDate.get(agendaDate) ?? [];
  const agendaLabel = new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(Number(agendaDate.slice(0, 4)), Number(agendaDate.slice(5, 7)) - 1, Number(agendaDate.slice(8, 10)))
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Month grid */}
      <Card className="xl:col-span-2 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">{monthLabel}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToToday}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-800 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 pb-1.5">
          {WEEKDAYS.map((d) => (
            <div key={d}>
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const dayBookings = bookingsByDate.get(cell.key) ?? [];
            const isToday = cell.key === today;
            const isSelected = cell.key === selectedDate;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onSelectDate(isSelected ? null : cell.key)}
                aria-pressed={isSelected}
                aria-label={`${cell.key}: ${dayBookings.length} bookings`}
                className={cn(
                  "min-h-12 sm:min-h-20 rounded-lg border p-1 sm:p-1.5 text-left flex flex-col transition-colors cursor-pointer",
                  cell.inMonth ? "bg-gray-950/50 border-gray-800/80" : "bg-transparent border-transparent opacity-40",
                  "hover:border-gray-600",
                  isSelected && "border-indigo-500 bg-indigo-950/40 hover:border-indigo-400"
                )}
              >
                <span
                  className={cn(
                    "text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center",
                    isToday ? "bg-indigo-600 text-white" : "text-gray-300"
                  )}
                >
                  {cell.day}
                </span>

                {/* Mobile: status dots */}
                {dayBookings.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-auto sm:hidden">
                    {dayBookings.slice(0, 4).map((b) => (
                      <span key={b.id} className={cn("w-1.5 h-1.5 rounded-full", bookingStatusMeta[b.status].dot)} />
                    ))}
                  </div>
                )}

                {/* Tablet / desktop: time chips */}
                <div className="hidden sm:flex flex-col gap-0.5 mt-1 w-full min-w-0">
                  {dayBookings.slice(0, 2).map((b) => (
                    <span
                      key={b.id}
                      className={cn(
                        "flex items-center gap-1 text-[10px] leading-tight rounded px-1 py-0.5 bg-gray-900/90 text-gray-300 truncate",
                        b.status === "cancelled" && "line-through opacity-60"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", bookingStatusMeta[b.status].dot)} />
                      <span className="truncate">
                        {b.time.replace(":00", "").replace(/^0/, "")} {b.customerName.split(" ")[0]}
                      </span>
                    </span>
                  ))}
                  {dayBookings.length > 2 && (
                    <span className="text-[10px] text-indigo-300 px-1">+{dayBookings.length - 2} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3 mt-3 border-t border-gray-800/80 text-[11px] text-gray-400">
          {Object.entries(bookingStatusMeta).map(([key, meta]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
              {meta.label}
            </span>
          ))}
        </div>
      </Card>

      {/* Day agenda */}
      <Card className="p-4 sm:p-5 flex flex-col">
        <div className="pb-3 border-b border-gray-800/80">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {agendaDate === today ? "Today" : "Selected day"}
          </span>
          <h3 className="text-sm font-semibold text-white">{agendaLabel}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {agenda.length === 0 ? "No appointments" : `${agenda.length} appointment${agenda.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex-1 space-y-2 pt-3 xl:max-h-[26rem] overflow-y-auto">
          {agenda.length === 0 && (
            <p className="text-xs text-gray-500 py-6 text-center">
              This day is open. Customers can book it through your customer chat.
            </p>
          )}
          {agenda.map((b) => {
            const meta = bookingStatusMeta[b.status];
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelectBooking(b)}
                className="w-full text-left flex gap-3 p-2.5 rounded-xl border border-gray-800 bg-gray-950/60 hover:border-gray-700 hover:bg-gray-900/60 transition-colors cursor-pointer"
              >
                <div className="w-14 flex-shrink-0 text-[11px] font-mono text-indigo-300 pt-0.5">{b.time}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white truncate">{b.customerName}</span>
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} title={meta.label} />
                  </div>
                  <p className="text-[11px] text-gray-400 truncate">{b.serviceName}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {b.durationMinutes} min • {b.staffAssigned ?? "Unassigned"} • {meta.label}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

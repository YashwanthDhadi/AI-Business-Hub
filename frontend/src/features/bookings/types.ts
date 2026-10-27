import type { BookingStatus } from "@/types";

export type BookingStatusFilter = BookingStatus | "all";

export type BookingChannelFilter = "all" | "customer_chat" | "dashboard" | "manual";

/** "selected" means the date picked on the calendar. */
export type BookingDateFilter = "all" | "today" | "upcoming" | "past" | "selected";

/** Shortcuts applied by clicking a summary card. */
export type BookingQuickView = "today" | "upcoming" | "pending" | "completed";

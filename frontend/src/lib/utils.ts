import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LOCALE, TIME_ZONE } from "./constants";

/**
 * Combines Tailwind class names cleanly, resolving conflicts with tailwind-merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats an amount of money, Indian style: 120000 -> "₹1,20,000".
 */
export function formatCurrency(amount: number, currency: string = "INR"): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    // Rupee prices here are whole numbers; "₹9,000.00" is just noise.
    maximumFractionDigits: currency === "INR" ? 0 : 2,
  }).format(amount);
}

/**
 * Formats a count with Indian digit grouping: 1234567 -> "12,34,567".
 */
export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}

/**
 * "6:00 pm" -> "6:00 PM".
 *
 * en-IN writes am/pm in lower case. The backend and every booking label use
 * upper case, so we normalise here and the whole app reads the same way.
 */
function upperMeridiem(text: string): string {
  return text.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
}

/**
 * Formats a MOCK date string (e.g. "23 Sept 2026").
 *
 * Mock data stores business-local times with a "Z" suffix, so full timestamps
 * are formatted in UTC here to show the time the mock intended. Real
 * timestamps from the API are true UTC - use formatInstant for those.
 * Plain "YYYY-MM-DD" dates are parsed as local dates.
 */
export function formatDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
): string {
  const isPlainDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  return upperMeridiem(
    new Intl.DateTimeFormat(LOCALE, isPlainDate ? options : { timeZone: "UTC", ...options }).format(
      parseDate(dateString)
    )
  );
}

/**
 * Formats a REAL moment from the API (a UTC timestamp) in Indian time.
 *
 * "2026-09-26T19:00:00Z" is 12:30 AM on the 27th in India. Formatting it in
 * UTC would show the 26th - wrong for five and a half hours every night.
 */
export function formatInstant(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
): string {
  if (!iso) return "";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  return upperMeridiem(new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options }).format(moment));
}

/**
 * Today's date in India as "YYYY-MM-DD", optionally moved by some days.
 *
 * For date inputs and due dates. The viewer's own clock would be wrong for an
 * owner travelling abroad, and toISOString() is UTC - yesterday, in India,
 * until 5:30 every morning. en-CA is used only because it writes YYYY-MM-DD.
 */
export function isoDateInIndia(offsetDays = 0): string {
  const moment = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(moment);
}

/**
 * Formats a stored phone number for reading: "+919876500011" -> "+91 98765 00011".
 *
 * The database keeps one form (+<digits>) so the unique index works; this is
 * only for display. Anything that is not an Indian mobile is shown unchanged.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

/**
 * Parses "YYYY-MM-DD" as a LOCAL date (plain `new Date("2026-09-23")` is UTC and
 * shows the previous day in US timezones). Full ISO timestamps are passed through.
 */
export function parseDate(dateString: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(dateString);
}

/** Converts a Date to a local "YYYY-MM-DD" key. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Converts "hh:mm AM" to minutes after midnight, for sorting. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return 0;
  let hours = Number(match[1]) % 12;
  if (match[3]?.toUpperCase() === "PM") hours += 12;
  if (!match[3]) hours = Number(match[1]);
  return hours * 60 + Number(match[2]);
}

/** Formats a byte count as KB / MB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for avatar bubbles, e.g. "Marcus Vance" -> "MV". */
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/**
 * Formats a clock time in 12-hour Indian style (e.g. "9:30 AM").
 */
export function formatTime(timeString: string): string {
  // If already formatted like '10:00 AM'
  if (timeString.includes("AM") || timeString.includes("PM")) {
    return timeString.replace(/^0/, "");
  }
  const [hours, minutes] = timeString.split(":");
  const date = new Date();
  date.setHours(parseInt(hours, 10));
  date.setMinutes(parseInt(minutes, 10));
  return upperMeridiem(
    new Intl.DateTimeFormat(LOCALE, {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date)
  );
}

/**
 * Current local wall-clock time as an ISO string with a "Z" suffix.
 * Mock data stores business-local times this way, and `formatDate` renders
 * timestamps in UTC, so new records display the time the user actually saw.
 */
export function localNowIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
}

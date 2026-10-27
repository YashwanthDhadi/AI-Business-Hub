/**
 * Frontend-wide constants.
 */

/**
 * Every business on this platform is in India. Money, numbers, dates and times
 * are all formatted from these two, so changing country is a two-line edit.
 *
 * en-IN gives ₹, lakh/crore grouping (₹1,20,000) and day-month-year order
 * (26 Sept 2026). Asia/Kolkata is IST, UTC+05:30, with no daylight saving.
 */
export const LOCALE = "en-IN";
export const TIME_ZONE = "Asia/Kolkata";

/** Fixed "today" used by the remaining mock screens so they render deterministically. */
export const MOCK_TODAY = "2026-09-23";

/**
 * The real date, as YYYY-MM-DD in the viewer's own timezone.
 *
 * Screens backed by the API use this instead of MOCK_TODAY. Built from the
 * local parts rather than toISOString(), which converts to UTC first and so
 * reports yesterday for anyone east of Greenwich for part of every evening.
 */
export function todayISO(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The public chat link an owner shares.
 *
 * Uses the real origin in the browser so the link works in development and in
 * production without configuration. Falls back to the configured site URL when
 * rendering on the server.
 */
export function getPublicChatUrl(slug: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  return `${origin}/chat/${slug}`;
}

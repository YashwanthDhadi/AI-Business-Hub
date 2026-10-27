/**
 * Client for the PUBLIC pay page API.
 *
 * Like the public chat, it calls FastAPI directly: there is no secret to hide.
 * The 32-character token in the page's URL is the only permission, and it
 * unlocks one invoice.
 */

import type { PublicInvoice } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://127.0.0.1:8000";

export class PayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PayApiError";
  }
}

async function call(path: string, init?: RequestInit): Promise<PublicInvoice> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/pay${path}`, {
      ...init,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new PayApiError("Could not reach the server. Check your connection and try again.", 0);
  }

  const body = (await response.json().catch(() => null)) as
    | { invoice?: PublicInvoice; detail?: string }
    | null;

  if (!response.ok || !body?.invoice) {
    throw new PayApiError(body?.detail ?? "Something went wrong. Please try again.", response.status);
  }
  return body.invoice;
}

export const payApi = {
  get: (token: string) => call(`/${encodeURIComponent(token)}`),

  /** "I have paid." Recorded for the business to check - it does not mark the invoice paid. */
  claim: (token: string, reference: string) =>
    call(`/${encodeURIComponent(token)}/claim`, { method: "POST", body: JSON.stringify({ reference }) }),
};

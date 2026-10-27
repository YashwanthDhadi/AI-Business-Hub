import { chatApi, ChatApiError } from "@/lib/api/chat";
import type { AssistantSettings, BusinessProfile } from "@/types";

export interface PublicBusiness {
  profile: BusinessProfile;
  assistant: AssistantSettings;
}

/**
 * Resolves a public chat slug to a business.
 *
 * Runs on the Next.js server (called from a server component), so the browser
 * never sees this request and there is no CORS involved.
 *
 * Returns null for an unknown slug, a paused business, or a backend that is
 * down — the page renders its not-found state for all three, because from the
 * customer's point of view they are the same thing.
 */
export async function getPublicBusiness(slug: string): Promise<PublicBusiness | null> {
  try {
    const { profile, assistant } = await chatApi.business(slug);
    return { profile, assistant };
  } catch (error) {
    if (error instanceof ChatApiError && error.status === 404) return null;
    // Log for you; show the customer the same friendly page either way.
    console.error(`[chat] could not load business "${slug}":`, error);
    return null;
  }
}

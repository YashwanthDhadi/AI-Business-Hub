/**
 * Client for the public chat API.
 *
 * The only file that talks to FastAPI's /api/v1/chat routes, and the only one
 * that touches localStorage.
 *
 * The public chat calls FastAPI directly rather than through a Next.js proxy:
 * this API is public by design, there is no secret to hide, and the browser's
 * own CORS check is exactly the right mechanism for "which sites may call
 * this". The owner's dashboard is the opposite case and uses /api/hub.
 */

import type { AssistantSettings, BusinessProfile } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://127.0.0.1:8000";
const PREFIX = "/api/v1/chat";

/* ------------------------------------------------------------------- types */

export interface PublicBusinessResponse {
  profile: BusinessProfile;
  assistant: AssistantSettings;
}

export interface ChatSession {
  session_token: string;
  conversation_id: string;
  business: { name: string; chat_slug?: string; accent?: string; location?: string };
  greeting: string;
}

export interface ChatTurn {
  id: string;
  role: "customer" | "agent";
  author: "customer" | "agent" | "owner" | "system";
  body: string;
  created_at: string;
}

export interface ChatHistory {
  business: { name: string; accent?: string };
  handed_over: boolean;
  messages: ChatTurn[];
}

export interface ChatReply {
  reply: string | null;
  handed_over: boolean;
  notice: string | null;
  latency_ms?: number;
}

export interface ChatVoiceReply extends ChatReply {
  transcript: string;
}

/* ------------------------------------------------------------------ errors */

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Seconds to wait, from the Retry-After header. 0 when not rate limited. */
    readonly retryAfter = 0,
  ) {
    super(message);
    this.name = "ChatApiError";
  }

  /** The session is gone; the page should quietly start a new one. */
  get isExpiredSession() {
    return this.status === 401;
  }
}

/* ----------------------------------------------------------------- storage */

const storageKey = (slug: string) => `aibh.chat.${slug}`;

/** localStorage throws in some private-browsing modes — never let that crash the page. */
export function readToken(slug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

export function writeToken(slug: string, token: string) {
  try {
    window.localStorage.setItem(storageKey(slug), token);
  } catch {
    /* the session simply will not survive a reload */
  }
}

export function clearToken(slug: string) {
  try {
    window.localStorage.removeItem(storageKey(slug));
  } catch {
    /* nothing to do */
  }
}

/* --------------------------------------------------------------- transport */

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = (body as { detail?: string } | null)?.detail ?? fallback;
    const retryAfter = Number(response.headers.get("Retry-After") ?? 0) || 0;
    throw new ChatApiError(detail, response.status, retryAfter);
  }

  return body as T;
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${PREFIX}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Chat-Session": token } : {}),
        ...(headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ChatApiError(
      "Could not reach the assistant. Please check your connection.",
      0,
    );
  }

  return parse<T>(response, `Something went wrong (${response.status}).`);
}

/* ------------------------------------------------------------------- calls */

export const chatApi = {
  /** Called from the SERVER component — no token, no localStorage. */
  business: (slug: string) =>
    request<PublicBusinessResponse>(`/business/${encodeURIComponent(slug)}`),

  startSession: (slug: string) =>
    request<ChatSession>("/session", {
      method: "POST",
      body: JSON.stringify({ chat_slug: slug }),
    }),

  sendMessage: (token: string, message: string) =>
    request<ChatReply>("/message", {
      method: "POST",
      token,
      body: JSON.stringify({ message }),
    }),

  history: (token: string) => request<ChatHistory>("/history", { token }),

  sendVoice: async (token: string, audio: Blob): Promise<ChatVoiceReply> => {
    const form = new FormData();
    // The filename extension matters — the backend maps it for Whisper.
    const extension = audio.type.includes("mp4") ? "mp4" : "webm";
    form.append("file", audio, `recording.${extension}`);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${PREFIX}/voice`, {
        method: "POST",
        // NO Content-Type header: the browser must set the multipart boundary.
        headers: { "X-Chat-Session": token },
        body: form,
        cache: "no-store",
      });
    } catch {
      throw new ChatApiError("Could not reach the assistant.", 0);
    }

    return parse<ChatVoiceReply>(response, "Could not send that recording.");
  },
};

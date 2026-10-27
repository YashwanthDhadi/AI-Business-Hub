"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Mic,
  Check,
  CalendarPlus,
  LayoutGrid,
  BadgePercent,
  HelpCircle,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import type { AssistantSettings, BusinessProfile, ChatMessage } from "@/types";
import { cn, formatInstant, getInitials } from "@/lib/utils";
import { ChatMessageBubble } from "./ChatMessageBubble";
import {
  ChatApiError,
  chatApi,
  clearToken,
  readToken,
  writeToken,
  type ChatTurn,
} from "@/lib/api/chat";
import { useVoiceRecorder } from "../useVoiceRecorder";

type UiMessage = ChatMessage;

interface CustomerChatAppProps {
  /** URL segment, used to key this business's session token. */
  slug: string;
  business: BusinessProfile;
  assistant: AssistantSettings;
}

/** Message times are the business's time (IST), whatever timezone the visitor's device is in. */
function timeLabel(iso: string) {
  return formatInstant(iso, { hour: "numeric", minute: "2-digit" });
}

function nowLabel() {
  return timeLabel(new Date().toISOString());
}

let idCounter = 0;
const nextId = () => `m-${++idCounter}-${Date.now()}`;

/** A stored turn from the API -> the shape the bubbles already expect. */
function toUiMessage(turn: ChatTurn): UiMessage {
  return {
    id: turn.id,
    sender:
      turn.author === "customer"
        ? "customer"
        : turn.author === "owner"
          ? "staff"
          : turn.author === "system"
            ? "system"
            : "assistant",
    text: turn.body,
    timestamp: timeLabel(turn.created_at),
  };
}

export function CustomerChatApp({ slug, business, assistant }: CustomerChatAppProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [booting, setBooting] = useState(true);
  const [handedOver, setHandedOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const token = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------ bootstrap */

  const openSession = useCallback(async () => {
    const session = await chatApi.startSession(slug);
    token.current = session.session_token;
    writeToken(slug, session.session_token);
    setMessages([{ id: "greeting", sender: "assistant", text: session.greeting, timestamp: nowLabel() }]);
    setHandedOver(false);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const existing = readToken(slug);

        if (existing) {
          try {
            const past = await chatApi.history(existing);
            if (cancelled) return;
            token.current = existing;
            setMessages(past.messages.map(toUiMessage));
            setHandedOver(past.handed_over);
            setBooting(false);
            return;
          } catch (cause) {
            // Expired or unknown token: fall through and open a fresh session.
            if (!(cause instanceof ChatApiError) || !cause.isExpiredSession) throw cause;
            clearToken(slug);
          }
        }

        await openSession();
        if (!cancelled) setBooting(false);
      } catch {
        if (cancelled) return;
        setBooting(false);
        setError("We couldn't start the chat. Please refresh the page.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, openSession]);

  /* --------------------------------------------------------------- effects */

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // When a human has taken over, the agent is silent — so poll for their reply.
  useEffect(() => {
    if (!handedOver) return;

    const timer = setInterval(async () => {
      if (!token.current) return;
      try {
        const past = await chatApi.history(token.current);
        setMessages(past.messages.map(toUiMessage));
        setHandedOver(past.handed_over);
      } catch {
        /* transient: keep the last good state and try again next tick */
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [handedOver]);

  /* --------------------------------------------------------------- sending */

  const appendAgent = (text: string, sender: UiMessage["sender"] = "assistant") =>
    setMessages((prev) => [...prev, { id: nextId(), sender, text, timestamp: nowLabel() }]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || typing || cooldown > 0 || !token.current) return;

      setError(null);
      setInput("");
      setMessages((prev) => [...prev, { id: nextId(), sender: "customer", text: clean, timestamp: nowLabel() }]);
      setTyping(true);

      try {
        const result = await chatApi.sendMessage(token.current, clean);
        if (result.reply) appendAgent(result.reply);
        if (result.notice) appendAgent(result.notice, "system");
        if (result.handed_over) setHandedOver(true);
      } catch (cause) {
        if (cause instanceof ChatApiError) {
          if (cause.isExpiredSession) {
            // Silently start over rather than showing the customer a 401.
            clearToken(slug);
            try {
              await openSession();
              setError("Your session timed out, so we started a new chat.");
            } catch {
              setError("This chat is not available right now.");
            }
          } else {
            setError(cause.message);
            if (cause.retryAfter > 0) setCooldown(cause.retryAfter);
          }
        } else {
          setError("Something went wrong. Please try again.");
        }
      } finally {
        setTyping(false);
        inputRef.current?.focus();
      }
    },
    [typing, cooldown, slug, openSession],
  );

  /* ----------------------------------------------------------------- voice */

  const sendRecording = useCallback(async (audio: Blob) => {
    if (!token.current) return;
    setError(null);
    setTyping(true);

    try {
      const result = await chatApi.sendVoice(token.current, audio);

      // Show what we heard as the customer's own message.
      setMessages((prev) => [
        ...prev,
        { id: nextId(), sender: "customer", text: result.transcript, timestamp: nowLabel() },
      ]);

      if (result.reply) appendAgent(result.reply);
      if (result.notice) appendAgent(result.notice, "system");
      if (result.handed_over) setHandedOver(true);
    } catch (cause) {
      if (cause instanceof ChatApiError) {
        setError(cause.message);
        if (cause.retryAfter > 0) setCooldown(cause.retryAfter);
      } else {
        setError("Could not send that recording.");
      }
    } finally {
      setTyping(false);
    }
  }, []);

  const recorder = useVoiceRecorder({
    onRecorded: sendRecording,
    onError: (message) => setError(message),
  });

  /* --------------------------------------------------------------- render */

  const chatOff = !assistant.chatEnabled;
  const disabled = typing || cooldown > 0 || booting || chatOff;

  const quickActions = [
    { label: "View Services", icon: LayoutGrid, text: "What services do you offer?" },
    { label: "Membership", icon: BadgePercent, text: "Tell me about memberships" },
    { label: "Opening Hours", icon: Clock, text: "What are your opening hours?" },
    { label: "Book Appointment", icon: CalendarPlus, text: "I want to book an appointment" },
    { label: "Ask a Question", icon: HelpCircle, text: null },
  ];

  const clock = `${String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:${String(
    recorder.seconds % 60,
  ).padStart(2, "0")}`;

  return (
    <div className="min-h-[100dvh] bg-[#0b0f19] flex sm:items-center sm:justify-center sm:p-4">
      <div className="w-full sm:max-w-lg h-[100dvh] sm:h-[calc(100dvh-2rem)] sm:max-h-[52rem] flex flex-col bg-gray-950 sm:rounded-3xl sm:border sm:border-gray-800 sm:shadow-2xl overflow-hidden relative">
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950/95 backdrop-blur"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md"
            style={{ backgroundColor: assistant.brandColor }}
            aria-hidden="true"
          >
            {getInitials(business.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white truncate">{business.name}</h1>
            <div
              className={cn(
                "text-[11px] flex items-center gap-1.5",
                handedOver ? "text-amber-400" : "text-emerald-400",
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", handedOver ? "bg-amber-400" : "bg-emerald-400")} />
              {handedOver
                ? "A team member is replying"
                : `${assistant.assistantName} is online • replies instantly`}
            </div>
          </div>
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
              aria-label={`Call ${business.name}`}
            >
              <Phone className="w-4 h-4" />
            </a>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4" aria-live="polite">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-3 text-center space-y-1">
            <p className="text-xs text-gray-300">{business.tagline}</p>
            {business.city && (
              <p className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {business.city}
              </p>
            )}
          </div>

          {booting && (
            <p className="text-center text-xs text-gray-500 flex w-full items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting…
            </p>
          )}

          {messages.map((m) => (
            <ChatMessageBubble
              key={m.id}
              message={m}
              perspective="customer"
              assistantName={assistant.assistantName}
            />
          ))}

          {typing && (
            <div
              className="flex items-center gap-2 text-gray-500 text-xs pl-9"
              aria-label={`${assistant.assistantName} is typing`}
            >
              <span className="flex gap-1 bg-gray-800 rounded-2xl px-3 py-2.5">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </span>
            </div>
          )}

          {error && (
            <p className="mx-auto max-w-sm rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-center text-xs text-amber-300">
              {error}
              {cooldown > 0 ? ` Try again in ${cooldown}s.` : ""}
            </p>
          )}
        </div>

        {/* Quick actions */}
        {!chatOff && !booting && (
          <div className="px-3 pt-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {quickActions.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => (q.text ? void send(q.text) : inputRef.current?.focus())}
                disabled={disabled}
                className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-gray-700 bg-gray-900 text-gray-200 hover:border-indigo-500/60 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <q.icon className="w-3.5 h-3.5 text-indigo-400" />
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="p-3 flex items-center gap-2"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {assistant.voiceInputEnabled && recorder.supported && (
            <button
              type="button"
              onClick={() => (recorder.state === "recording" ? recorder.stop() : void recorder.start())}
              disabled={disabled || recorder.state === "working"}
              aria-label={recorder.state === "recording" ? "Stop recording" : "Record a voice message"}
              aria-pressed={recorder.state === "recording"}
              className={cn(
                "h-11 rounded-full flex items-center justify-center flex-shrink-0 gap-1.5 transition-colors cursor-pointer disabled:opacity-50",
                recorder.state === "recording"
                  ? "bg-rose-600 text-white px-3"
                  : "w-11 bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700",
              )}
            >
              {recorder.state === "working" ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
              {recorder.state === "recording" && (
                <span className="text-xs font-medium tabular-nums">{clock}</span>
              )}
            </button>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              chatOff
                ? "Chat is currently offline"
                : cooldown > 0
                  ? `Please wait ${cooldown}s…`
                  : "Type your message..."
            }
            aria-label="Message"
            disabled={disabled}
            enterKeyHint="send"
            className="flex-1 min-w-0 rounded-full bg-gray-900 border border-gray-700 px-4 py-2.5 text-base sm:text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || disabled}
            aria-label="Send message"
            className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-[10px] text-gray-600 pb-2 -mt-1 px-4">
          <Sparkles className="w-3 h-3 inline-block mr-1" />
          You are chatting with an AI assistant. Replies may not always be accurate.
        </p>

        {/* Listening overlay */}
        {recorder.state === "recording" && (
          <div
            className="absolute inset-x-0 bottom-0 z-10 bg-gray-950/95 backdrop-blur border-t border-gray-800 p-6 pb-10 flex flex-col items-center gap-4"
            role="dialog"
            aria-label="Listening"
          >
            <div className="flex items-end gap-1 h-10" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-indigo-500 animate-pulse"
                  style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
            <p className="text-sm text-white text-center">Listening… speak now</p>
            <p className="text-[11px] text-gray-500 tabular-nums">{clock} · tap Done when you finish</p>
            <button
              type="button"
              onClick={() => recorder.stop()}
              className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" /> Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

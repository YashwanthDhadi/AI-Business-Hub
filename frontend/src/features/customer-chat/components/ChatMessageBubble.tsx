import React from "react";
import { Bot, CalendarCheck, Clock, User } from "lucide-react";
import { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";

export interface BookingCardData {
  serviceName: string;
  date: string;
  time: string;
  staff?: string;
  price?: string;
}

/** Booking confirmation card shown inside chat transcripts. */
export function BookingConfirmationCard({ data, compact }: { data: BookingCardData; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5", compact ? "text-[11px]" : "text-xs")}>
      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
        <CalendarCheck className="w-3.5 h-3.5" /> Booking confirmed
      </div>
      <div className="text-white font-semibold">{data.serviceName}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-300">
        <span>{data.date}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {data.time}
        </span>
        {data.staff && <span>with {data.staff}</span>}
        {data.price && <span className="text-white font-medium">{data.price}</span>}
      </div>
    </div>
  );
}

function readBookingData(message: ChatMessage): BookingCardData | null {
  if (message.metadata?.actionType !== "show_booking_confirmation" || !message.metadata.data) return null;
  const d = message.metadata.data as Record<string, unknown>;
  if (typeof d.serviceName !== "string") return null;
  return {
    serviceName: d.serviceName,
    date: String(d.date ?? ""),
    time: String(d.time ?? ""),
    staff: typeof d.staff === "string" ? d.staff : undefined,
    price: typeof d.price === "string" ? d.price : undefined,
  };
}

// http(s) only - a message can never become a javascript: link. Trailing
// punctuation stays outside, so "…/pay/abc." links to "…/pay/abc".
const LINK = /(https?:\/\/[^\s]*[^\s.,;:!?)])/g;

/** Message text with its web links made tappable - the pay-page link has to be. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(LINK).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
            {part}
          </a>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  /** "owner": owner reviewing a transcript. "customer": the public chat UI. */
  perspective?: "owner" | "customer";
  assistantName?: string;
  children?: React.ReactNode;
}

export function ChatMessageBubble({ message, perspective = "owner", assistantName = "Assistant", children }: ChatMessageBubbleProps) {
  if (message.sender === "system") {
    return (
      <div className="flex justify-center">
        <span className="text-[11px] text-gray-500 bg-gray-900 border border-gray-800 rounded-full px-3 py-1"><Linkified text={message.text} /></span>
      </div>
    );
  }

  const isCustomer = message.sender === "customer";
  const isStaff = message.sender === "staff";
  const booking = readBookingData(message);
  const alignRight = isCustomer === (perspective === "customer");

  return (
    <div className={cn("flex gap-2 items-end", alignRight ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white",
          isCustomer ? "bg-gray-700" : isStaff ? "bg-emerald-600" : "bg-indigo-600"
        )}
        aria-hidden="true"
      >
        {isCustomer ? <User className="w-3.5 h-3.5" /> : isStaff ? <span className="text-[10px] font-bold">FZ</span> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn("max-w-[80%] space-y-1.5", alignRight && "items-end flex flex-col")}>
        <div className={cn("text-[10px] text-gray-500 px-1", alignRight && "text-right")}>
          {isCustomer ? (perspective === "customer" ? "You" : "Customer") : isStaff ? "FitZone Team" : assistantName} • {message.timestamp}
        </div>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line",
            alignRight ? "rounded-br-md" : "rounded-bl-md",
            isCustomer
              ? perspective === "customer"
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-100"
              : isStaff
                ? "bg-emerald-900/40 border border-emerald-500/30 text-gray-100"
                : perspective === "customer"
                  ? "bg-gray-800 text-gray-100"
                  : "bg-indigo-950/60 border border-indigo-500/20 text-gray-100"
          )}
        >
          <Linkified text={message.text} />
        </div>
        {booking && <BookingConfirmationCard data={booking} compact={perspective === "owner"} />}
        {children}
      </div>
    </div>
  );
}

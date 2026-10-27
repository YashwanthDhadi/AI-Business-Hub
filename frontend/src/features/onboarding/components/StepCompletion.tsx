"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  QrCode,
  ArrowRight,
  Share2,
} from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { OnboardingState } from "../types";

interface StepCompletionProps {
  data: OnboardingState;
}

export function StepCompletion({ data }: StepCompletionProps) {
  const [copied, setCopied] = useState(false);

  const slug = data.businessSlug || "fitzone";
  // Direct relative URL for public chat
  const publicChatPath = `/chat/${slug}`;
  const fullPublicUrl = typeof window !== "undefined"
    ? `${window.location.origin}${publicChatPath}`
    : `http://localhost:3000${publicChatPath}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fullPublicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-8 text-center max-w-xl mx-auto py-2">
      {/* Celebration Header */}
      <div className="space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Your Business is Live on AI Business Hub!
        </h2>
        <p className="text-sm text-gray-400 max-w-md mx-auto leading-relaxed">
          <strong className="text-white">{data.businessName || "Your Business"}</strong> has been configured.
          Your customer-facing AI assistant is ready to handle inquiries and bookings.
        </p>
      </div>

      {/* Generated Link Card */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-5 text-left space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              Your Public Customer Chat Link
            </span>
          </div>
          <Badge variant="brand">Active & Ready</Badge>
        </div>

        {/* Link Input Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl p-1.5 pl-3">
          <span className="text-xs font-mono text-gray-200 truncate flex-1 py-1">
            {fullPublicUrl}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="text-xs flex-1 sm:flex-initial"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Link href={publicChatPath} target="_blank">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs flex-1 sm:flex-initial"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Chat
              </Button>
            </Link>
          </div>
        </div>

        <p className="text-[11px] text-gray-400">
          Tip: Place this link in your Instagram bio, Google Maps listing, or text message it directly to your clients.
        </p>
      </div>

      {/* QR Code Section */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 flex flex-col sm:flex-row items-center justify-between gap-5 text-left">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <QrCode className="w-4 h-4 text-indigo-400" />
            Printable Countertop QR Code
          </h4>
          <p className="text-xs text-gray-400">
            Customers can scan this QR code with their phone camera at your front desk to open the AI chat instantly.
          </p>
        </div>

        {/* Simulated SVG QR Code Graphic */}
        <div className="flex-shrink-0 flex flex-col items-center bg-white p-3 rounded-xl shadow-md">
          <svg
            className="w-24 h-24 text-gray-900"
            viewBox="0 0 100 100"
            fill="currentColor"
          >
            {/* Top-left position marker */}
            <rect x="10" y="10" width="26" height="26" fill="black" rx="3" />
            <rect x="15" y="15" width="16" height="16" fill="white" rx="2" />
            <rect x="19" y="19" width="8" height="8" fill="black" rx="1" />

            {/* Top-right position marker */}
            <rect x="64" y="10" width="26" height="26" fill="black" rx="3" />
            <rect x="69" y="15" width="16" height="16" fill="white" rx="2" />
            <rect x="73" y="19" width="8" height="8" fill="black" rx="1" />

            {/* Bottom-left position marker */}
            <rect x="10" y="64" width="26" height="26" fill="black" rx="3" />
            <rect x="15" y="69" width="16" height="16" fill="white" rx="2" />
            <rect x="19" y="73" width="8" height="8" fill="black" rx="1" />

            {/* Simulated Data matrix dots */}
            <rect x="42" y="12" width="6" height="6" fill="black" />
            <rect x="52" y="18" width="6" height="6" fill="black" />
            <rect x="42" y="28" width="6" height="6" fill="black" />
            <rect x="50" y="38" width="8" height="8" fill="black" />
            <rect x="12" y="44" width="6" height="6" fill="black" />
            <rect x="24" y="48" width="6" height="6" fill="black" />
            <rect x="40" y="48" width="6" height="6" fill="black" />
            <rect x="70" y="44" width="6" height="6" fill="black" />
            <rect x="80" y="52" width="8" height="6" fill="black" />
            <rect x="44" y="62" width="6" height="6" fill="black" />
            <rect x="54" y="70" width="6" height="6" fill="black" />
            <rect x="74" y="66" width="6" height="6" fill="black" />
            <rect x="82" y="78" width="6" height="6" fill="black" />
            <rect x="44" y="82" width="8" height="6" fill="black" />
            <rect x="62" y="84" width="6" height="6" fill="black" />
          </svg>
          <span className="text-[9px] font-bold text-gray-800 tracking-wider uppercase mt-1">
            Scan to Chat
          </span>
        </div>
      </div>

      {/* Primary Action to Enter Dashboard */}
      <div className="pt-4">
        <Link href="/dashboard">
          <Button variant="primary" size="lg" className="w-full sm:w-auto shadow-xl shadow-indigo-600/20">
            Open Business Owner Dashboard
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

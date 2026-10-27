"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Copy, Check, ExternalLink, QrCode, Printer, Link2 } from "lucide-react";
import { Button, Card, Modal, QrCodeGraphic } from "@/components/ui";
import { getPublicChatUrl } from "@/lib/constants";

interface ChatLinkCardProps {
  businessName: string;
  slug: string;
  onCopied?: () => void;
}

export function ChatLinkCard({ businessName, slug, onCopied }: ChatLinkCardProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const publicUrl = getPublicChatUrl(slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      // Clipboard can be blocked (e.g. insecure origin). The link stays visible to copy manually.
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Link2 className="w-4 h-4 text-indigo-400" /> Your Customer Chat Link
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Share this link on Instagram, Google Maps, WhatsApp or your website. Customers don&apos;t need an account.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 font-mono text-xs text-indigo-300 truncate" title={publicUrl}>
              {publicUrl}
            </div>
            <div className="flex gap-2">
              <Button variant={copied ? "secondary" : "primary"} size="sm" onClick={copy} className="flex-1 sm:flex-none">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
              <Link href={`/chat/${slug}`} target="_blank" className="flex-1 sm:flex-none">
                <Button variant="outline" size="sm" className="w-full">
                  <ExternalLink className="w-3.5 h-3.5" /> Open Chat
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => setQrOpen(true)} className="flex-1 sm:flex-none">
                <QrCode className="w-3.5 h-3.5" /> QR Code
              </Button>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setQrOpen(true)} className="hidden md:block cursor-pointer" aria-label="Show QR code">
          <QrCodeGraphic value={publicUrl} svgClassName="w-20 h-20" />
        </button>
      </div>

      <Modal isOpen={qrOpen} onClose={() => setQrOpen(false)} title="Printable QR Code" description="Place this at your front desk so customers can scan and chat." maxWidth="sm">
        <div className="space-y-4">
          <div className="print-area rounded-xl bg-white p-6 text-center text-gray-900 space-y-3">
            <div className="text-base font-bold">{businessName}</div>
            <QrCodeGraphic value={publicUrl} svgClassName="w-44 h-44" className="shadow-none p-0" label="" />
            <div className="text-sm font-semibold">Scan to chat with us</div>
            <div className="text-[11px] text-gray-600">Book appointments, ask questions, check prices, 24/7</div>
            <div className="text-[10px] font-mono text-gray-500 break-all">{publicUrl}</div>
          </div>
          <Button className="w-full" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print QR Code
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

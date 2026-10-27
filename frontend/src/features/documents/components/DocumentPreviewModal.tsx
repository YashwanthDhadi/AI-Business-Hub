"use client";

import React, { useState } from "react";
import { Download, Trash2, MessageSquare, Save } from "lucide-react";
import { Modal, Badge, Button, DetailList, Textarea, Toggle } from "@/components/ui";
import type { BusinessDocument } from "@/types";
import { formatFileSize, formatInstant } from "@/lib/utils";
import { documentCategoryLabels, fileTypeLabels, fileTypeOf } from "./DocumentList";

interface DocumentPreviewModalProps {
  document: BusinessDocument | null;
  /** The full text, fetched when the modal opens. Null while loading. */
  content: string | null;
  onClose: () => void;
  onSaveContent: (id: string, content: string) => Promise<void>;
  onTogglePublic: (id: string, isPublic: boolean) => Promise<void>;
  onDownload: (doc: BusinessDocument) => void;
  onArchive: (id: string) => Promise<void>;
}

export function DocumentPreviewModal({
  document: doc,
  content,
  onClose,
  onSaveContent,
  onTogglePublic,
  onDownload,
  onArchive,
}: DocumentPreviewModalProps) {
  // null means "the owner has not typed anything yet", so the box simply shows
  // whatever text arrived. Deriving it this way needs no effect: an effect that
  // copies a prop into state causes an extra render and gets out of step the
  // moment the prop changes. The parent gives this modal a key per document,
  // so opening a different one starts clean.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!doc) return null;

  const value = draft ?? content ?? "";

  const kind = fileTypeOf(doc);
  const quotable = doc.isPublic && doc.isSearchable;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // The page shows the error; keep the modal as it is.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={doc.title} description={doc.description || undefined} maxWidth="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{documentCategoryLabels[doc.category]}</Badge>
          <Badge variant={quotable ? "brand" : "neutral"}>
            {quotable ? "Customer chat can quote this" : "Not used by chat"}
          </Badge>
          {doc.hasFile && !doc.isSearchable && (
            <Badge variant="warning">No readable text</Badge>
          )}
        </div>

        <DetailList
          items={[
            { label: "Type", value: fileTypeLabels[kind] },
            { label: "File", value: doc.hasFile ? `${doc.fileName} (${formatFileSize(doc.sizeBytes)})` : "Typed in, no file" },
            { label: "Added", value: formatInstant(doc.createdAt, { day: "numeric", month: "short", year: "numeric" }) },
            { label: "Added by", value: doc.uploadedBy },
            { label: "Searchable text", value: doc.contentLength ? `${doc.contentLength} characters` : "None yet" },
          ]}
        />

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3 space-y-2">
          <Toggle
            checked={doc.isPublic}
            onChange={(value) => void run(() => onTogglePublic(doc.id, value))}
            disabled={busy}
            label="Let the customer chat quote this"
            description="Off by default. Only turn this on for documents a customer may read."
          />
          {doc.isPublic && !doc.isSearchable && (
            <p className="text-[11px] text-amber-400/90">
              Published, but there is no readable text yet, so the assistant still cannot quote it.
              Paste the text below.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              Text the assistant can quote
            </span>
            {doc.hasFile && !doc.isSearchable && (
              <span className="text-[10px] text-gray-500">
                PDFs and Word files are stored but not read — paste the text here
              </span>
            )}
          </div>
          {content === null ? (
            <p className="text-xs text-gray-500 py-6 text-center">Loading…</p>
          ) : (
            <>
              <Textarea
                aria-label="Document text"
                rows={8}
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Paste the policy, price list or terms here…"
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={busy || value === (content ?? "")} onClick={() => void run(() => onSaveContent(doc.id, value))}>
                  <Save className="w-3.5 h-3.5" /> Save text
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-gray-800">
          {doc.hasFile && (
            <Button variant="outline" size="sm" onClick={() => onDownload(doc)}>
              <Download className="w-3.5 h-3.5" /> Download
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => onArchive(doc.id))} className="hover:text-rose-300">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Remove
          </Button>
          {quotable && (
            <span className="inline-flex items-center gap-1 text-[11px] text-purple-300 mr-auto">
              <MessageSquare className="w-3.5 h-3.5" /> Customers can be quoted this
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

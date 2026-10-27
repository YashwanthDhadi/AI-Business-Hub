"use client";

import React, { useRef, useState } from "react";
import { UploadCloud, Loader2, FilePlus2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import type { DocumentCategory } from "@/types";
import { documentCategoryLabels } from "./DocumentList";

interface UploadDropzoneProps {
  /** Uploads one file. Rejects with the server's message. */
  onUpload: (file: File, category: DocumentCategory, isPublic: boolean) => Promise<void>;
  /** Opens the "paste text instead" form. */
  onPasteInstead: () => void;
  maxUploadMb: number;
}

export function UploadDropzone({ onUpload, onPasteInstead, maxUploadMb }: UploadDropzoneProps) {
  const [category, setCategory] = useState<DocumentCategory>("policy");
  const [isPublic, setIsPublic] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        await onUpload(file, category, isPublic);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Could not upload ${file.name}.`);
        break;
      } finally {
        setBusy(null);
      }
    }
    if (input.current) input.current.value = "";
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-indigo-500 bg-indigo-500/5" : "border-gray-700 bg-gray-900/40"
        }`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-sm text-gray-300">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            Uploading {busy}…
          </div>
        ) : (
          <>
            <UploadCloud className="w-8 h-8 text-gray-500 mx-auto" />
            <p className="text-sm text-gray-300 mt-2">
              Drag a file here, or{" "}
              <button type="button" onClick={() => input.current?.click()} className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
                choose one
              </button>
            </p>
            <p className="text-[11px] text-gray-500 mt-1">
              Up to {maxUploadMb} MB. Text and Markdown can be read and quoted straight away; PDFs and
              Word files are stored for download, and you paste their text to make them quotable.
            </p>
          </>
        )}
        <input
          ref={input}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files && void send(e.target.files)}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <Select
          label="File in"
          value={category}
          onChange={(v) => setCategory(v as DocumentCategory)}
          options={(Object.keys(documentCategoryLabels) as DocumentCategory[]).map((c) => ({
            label: documentCategoryLabels[c],
            value: c,
          }))}
          wrapperClassName="w-full sm:w-52"
        />
        <label className="flex items-center gap-2 text-xs text-gray-300 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-indigo-600"
          />
          Let the customer chat quote it
        </label>
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={onPasteInstead}>
          <FilePlus2 className="w-3.5 h-3.5" /> Paste text instead
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

import React from "react";
import { FileText, FileSpreadsheet, FileImage, File, MessageSquare, EyeOff, ChevronRight } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import type { BusinessDocument, DocumentCategory, DocumentFileType } from "@/types";
import { formatFileSize, formatInstant } from "@/lib/utils";

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  price_list: "Price lists",
  policy: "Policies",
  form: "Forms",
  guide: "Guides",
  receipt: "Receipts",
  other: "Other",
};

export const fileTypeLabels: Record<DocumentFileType, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Spreadsheet",
  image: "Image",
  text: "Text",
  none: "Typed in",
};

/** Work out a file kind from the name and type the server reported. */
export function fileTypeOf(doc: BusinessDocument): DocumentFileType {
  if (!doc.hasFile) return "none";
  const name = (doc.fileName || "").toLowerCase();
  const mime = doc.mimeType || "";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (/\.(docx?|odt)$/.test(name) || mime.includes("word")) return "docx";
  if (/\.(xlsx?|csv|ods)$/.test(name) || mime.includes("sheet") || mime === "text/csv") return "xlsx";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(name) || mime.startsWith("image/")) return "image";
  return "text";
}

const icons: Record<DocumentFileType, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  image: FileImage,
  text: FileText,
  none: File,
};

interface DocumentListProps {
  documents: BusinessDocument[];
  onSelect: (document: BusinessDocument) => void;
}

export function DocumentList({ documents, onSelect }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No Documents Found"
        description="Nothing matched your search. Upload a file, or paste a policy so the assistant can quote it."
      />
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg divide-y divide-gray-800/80">
      {documents.map((doc) => {
        const kind = fileTypeOf(doc);
        const Icon = icons[kind];
        // Quotable means BOTH: published to the chat, and we have its text.
        const quotable = doc.isPublic && doc.isSearchable;
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => onSelect(doc)}
            className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-800/40 transition-colors cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0 text-gray-400">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white truncate group-hover:text-indigo-300 transition-colors">
                  {doc.title}
                </span>
                <Badge variant="neutral">{documentCategoryLabels[doc.category]}</Badge>
                {quotable ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-purple-300">
                    <MessageSquare className="w-3 h-3" /> Used by chat
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                    <EyeOff className="w-3 h-3" /> Private
                  </span>
                )}
              </div>
              {doc.description && <p className="text-[11px] text-gray-400 truncate">{doc.description}</p>}
              <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500">
                <span>{fileTypeLabels[kind]}</span>
                {doc.hasFile && <span>{formatFileSize(doc.sizeBytes)}</span>}
                <span>{formatInstant(doc.createdAt, { day: "numeric", month: "short", year: "numeric" })}</span>
                {doc.hasFile && !doc.isSearchable && (
                  <span className="text-amber-400/90">Text not readable — paste it to make it quotable</span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300 flex-shrink-0 mt-2" />
          </button>
        );
      })}
    </div>
  );
}

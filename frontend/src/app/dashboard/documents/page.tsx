"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, MessageSquare, HardDrive, EyeOff } from "lucide-react";
import { PageHeader, StatCard, SearchInput, Select, SegmentedTabs, Toast, Modal, Button, Input, Textarea } from "@/components/ui";
import { UploadDropzone } from "@/features/documents/components/UploadDropzone";
import { DocumentList, documentCategoryLabels, fileTypeLabels, fileTypeOf } from "@/features/documents/components/DocumentList";
import { DocumentPreviewModal } from "@/features/documents/components/DocumentPreviewModal";
import type { BusinessDocument, DocumentCategory, DocumentFileType } from "@/types";
import { formatFileSize } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { dashboardApi, HubError, LIVE_BUSINESS_ID } from "@/lib/api/dashboard";

type CategoryFilter = DocumentCategory | "all";

function message(error: unknown, fallback: string): string {
  return error instanceof HubError ? error.message : fallback;
}

export default function DocumentsPage() {
  const configured = Boolean(LIVE_BUSINESS_ID);

  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [maxUploadMb, setMaxUploadMb] = useState(10);
  const [loading, setLoading] = useState(configured);
  const [loadError, setLoadError] = useState<string | null>(
    configured ? null : "Set NEXT_PUBLIC_LIVE_BUSINESS_ID in frontend/.env.local, then restart npm run dev.",
  );

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<BusinessDocument | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await dashboardApi.documents();
      setDocuments(data.documents);
      setMaxUploadMb(data.maxUploadMb);
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error, "Could not load documents."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    // `refresh` awaits before it sets state, so nothing is set synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [configured, refresh]);

  const replace = useCallback((updated: BusinessDocument) => {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === updated.id);
      return exists ? prev.map((d) => (d.id === updated.id ? updated : d)) : [updated, ...prev];
    });
    setSelected((current) => (current && current.id === updated.id ? updated : current));
  }, []);

  /** Open a document AND fetch its full text - the list only carries a preview. */
  const open = useCallback(
    async (doc: BusinessDocument) => {
      setSelected(doc);
      setSelectedContent(null);
      try {
        const full = await dashboardApi.document(doc.id);
        replace(full);
        setSelectedContent(full.content ?? "");
      } catch (error) {
        showToast(message(error, "Could not open that document."), "error");
        setSelectedContent("");
      }
    },
    [replace, showToast],
  );

  const handleUpload = useCallback(
    async (file: File, category: DocumentCategory, isPublic: boolean) => {
      const created = await dashboardApi.uploadDocument(file, category, isPublic);
      replace(created);
      showToast(
        created.isSearchable
          ? `${created.title} uploaded. The assistant can quote it.`
          : `${created.title} uploaded. Paste its text to make it quotable.`,
      );
    },
    [replace, showToast],
  );

  const handleSaveContent = useCallback(
    async (id: string, content: string) => {
      try {
        const saved = await dashboardApi.updateDocument(id, { content });
        replace(saved);
        setSelectedContent(content);
        showToast("Text saved.");
      } catch (error) {
        showToast(message(error, "Could not save the text."), "error");
        throw error;
      }
    },
    [replace, showToast],
  );

  const handleTogglePublic = useCallback(
    async (id: string, isPublic: boolean) => {
      try {
        const saved = await dashboardApi.updateDocument(id, { is_public: isPublic });
        replace(saved);
        showToast(
          isPublic ? "The customer chat can now quote this." : "The customer chat will no longer use this.",
          "info",
        );
      } catch (error) {
        showToast(message(error, "Could not change that."), "error");
        throw error;
      }
    },
    [replace, showToast],
  );

  const handleDownload = useCallback(
    async (doc: BusinessDocument) => {
      try {
        const url = await dashboardApi.documentDownloadUrl(doc.id);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(message(error, "Could not create a download link."), "error");
      }
    },
    [showToast],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await dashboardApi.archiveDocument(id);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        setSelected(null);
        showToast("Document removed. It is hidden, not deleted.");
      } catch (error) {
        showToast(message(error, "Could not remove it."), "error");
        throw error;
      }
    },
    [showToast],
  );

  const counts = useMemo(() => {
    const c = { all: documents.length } as Record<CategoryFilter, number>;
    (Object.keys(documentCategoryLabels) as DocumentCategory[]).forEach(
      (k) => (c[k] = documents.filter((d) => d.category === k).length),
    );
    return c;
  }, [documents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents
      .filter(
        (d) =>
          (!q ||
            d.title.toLowerCase().includes(q) ||
            d.description.toLowerCase().includes(q) ||
            d.preview.toLowerCase().includes(q)) &&
          (categoryFilter === "all" || d.category === categoryFilter) &&
          (typeFilter === "all" || fileTypeOf(d) === typeFilter),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [documents, search, categoryFilter, typeFilter]);

  const quotable = documents.filter((d) => d.isPublic && d.isSearchable).length;
  const privateCount = documents.filter((d) => !d.isPublic).length;
  const storage = documents.reduce((a, d) => a + d.sizeBytes, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        title="Documents"
        description="Price lists, policies and forms. Publish one and the assistant can quote it to customers."
      />

      {loadError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">{loadError}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Documents" value={documents.length} icon={FolderOpen} tone="indigo" hint={`${Object.keys(documentCategoryLabels).length} categories`} />
        <StatCard label="Used by Customer Chat" value={quotable} icon={MessageSquare} tone="purple" hint="Published and readable" />
        <StatCard label="Private" value={privateCount} icon={EyeOff} tone="amber" hint="Never shown to customers" />
        <StatCard label="Storage Used" value={formatFileSize(storage)} icon={HardDrive} tone="blue" hint="Files you uploaded" />
      </div>

      <UploadDropzone onUpload={handleUpload} onPasteInstead={() => setPasteOpen(true)} maxUploadMb={maxUploadMb} />

      <section className="space-y-3" aria-label="Documents">
        <SegmentedTabs<CategoryFilter>
          tabs={[
            { label: "All", value: "all", count: counts.all },
            ...(Object.keys(documentCategoryLabels) as DocumentCategory[]).map((c) => ({
              label: documentCategoryLabels[c],
              value: c,
              count: counts[c],
            })),
          ]}
          value={categoryFilter}
          onChange={setCategoryFilter}
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search documents..." className="w-full sm:w-72" />
          <Select
            aria-label="Filter by file type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { label: "All file types", value: "all" },
              ...(Object.keys(fileTypeLabels) as DocumentFileType[]).map((t) => ({ label: fileTypeLabels[t], value: t })),
            ]}
            wrapperClassName="w-full sm:w-40"
          />
        </div>
        {loading ? (
          <p className="text-xs text-gray-500 px-1 py-10 text-center">Loading documents…</p>
        ) : (
          <DocumentList documents={filtered} onSelect={(d) => void open(d)} />
        )}
      </section>

      <DocumentPreviewModal
        key={selected?.id ?? "none"}
        document={selected}
        content={selectedContent}
        onClose={() => setSelected(null)}
        onSaveContent={handleSaveContent}
        onTogglePublic={handleTogglePublic}
        onDownload={(d) => void handleDownload(d)}
        onArchive={handleArchive}
      />

      <PasteDocumentModal
        isOpen={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onCreate={async (input) => {
          const created = await dashboardApi.createDocument(input);
          replace(created);
          showToast(`${created.title} saved.`);
        }}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

/** Add a document by typing its text, with no file at all. */
function PasteDocumentModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    category: DocumentCategory;
    description: string;
    content: string;
    is_public: boolean;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("policy");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), category, description: description.trim(), content, is_public: isPublic });
      setTitle("");
      setDescription("");
      setContent("");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Paste a document" description="For a policy or price list you want the assistant to quote." maxWidth="md">
      <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-1">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cancellation Policy" required />
        <Select
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as DocumentCategory)}
          options={(Object.keys(documentCategoryLabels) as DocumentCategory[]).map((c) => ({
            label: documentCategoryLabels[c],
            value: c,
          }))}
        />
        <Input label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <Textarea label="The text" rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the full policy or price list here…" required />
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-indigo-600" />
          Let the customer chat quote this
        </label>
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save document"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

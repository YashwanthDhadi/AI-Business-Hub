/** What kind of document this is. Matches the database's own list. */
export type DocumentCategory = "price_list" | "policy" | "form" | "guide" | "receipt" | "other";

export type DocumentFileType = "pdf" | "docx" | "xlsx" | "image" | "text" | "none";

export interface BusinessDocument {
  id: string;
  businessId: string;
  /** What the owner called it. Unique per business. */
  title: string;
  category: DocumentCategory;
  description: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Whether a file was uploaded, as opposed to text pasted in. */
  hasFile: boolean;
  /**
   * Whether the assistant can QUOTE this. True only when there is extracted
   * text: a scanned PDF is downloadable but not quotable until someone pastes
   * its text.
   */
  isSearchable: boolean;
  /** Whether the owner published it to the customer chat. False by default. */
  isPublic: boolean;
  isActive: boolean;
  /** First few hundred characters of the searchable text. */
  preview: string;
  contentLength: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt?: string;
  /** Only on the single-document endpoint: the full searchable text. */
  content?: string;
}

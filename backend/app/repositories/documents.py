"""
Business documents: price lists, policies, forms.

NO RAG, and that is a decision rather than a shortcut. A small business has
tens of documents, not millions. Postgres full-text search answers "what does
the refund policy say?" in one query, with no embedding model, no vector
database and nothing extra to pay for or keep running. The moment this grows
to tens of thousands of documents, embeddings become worth their cost - not
before.

Two things live in one row:

  content       the searchable TEXT. This is what the assistant can quote.
  storage_path  the FILE in Supabase Storage, for the owner to download.

A row can have either, or both. A pasted policy has text and no file; a
scanned PDF has a file and no text, so the assistant cannot quote it - and
the screen says so rather than pretending.
"""

from __future__ import annotations

import logging
import re
import uuid

from app.db import db, one, rows

logger = logging.getLogger("aibh.documents")

BUCKET = "business-documents"

CATEGORIES = {"price_list", "policy", "form", "guide", "receipt", "other"}

EDITABLE = {"title", "category", "description", "content", "is_public", "is_active"}

# Text we can read ourselves. Anything else is stored and downloadable, but the
# owner has to paste the text if they want the assistant to be able to quote it.
READABLE_TYPES = {"text/plain", "text/markdown", "text/csv", "application/json"}

RULES = {
    "documents_title_uidx": "A document with that title already exists.",
    "documents_category_check": "That is not one of the allowed categories.",
    "documents_title_check": "A document needs a title.",
}


class DocumentRefused(Exception):
    def __init__(self, rule: str, message: str) -> None:
        self.rule = rule
        super().__init__(message)


def _explain(exc: Exception) -> Exception:
    text = str(exc)
    for rule, message in RULES.items():
        if rule in text:
            return DocumentRefused(rule, message)
    return exc


def _run(query):
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


def _clean(fields: dict) -> dict:
    out: dict = {}
    for key, value in fields.items():
        if key not in EDITABLE:
            continue
        if key in {"is_public", "is_active"}:
            out[key] = bool(value)
        elif key == "category":
            category = (value or "other").strip().lower()
            if category not in CATEGORIES:
                raise DocumentRefused("documents_category_check", RULES["documents_category_check"])
            out[key] = category
        else:
            out[key] = (value or "").strip()
    return out


# ----------------------------------------------------------------------- read


def get(business_id: str, document_id: str) -> dict | None:
    return one(
        db.table("documents")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", document_id)
        .limit(1)
        .execute()
    )


def list_documents(business_id: str, *, include_inactive: bool = False) -> list[dict]:
    query = (
        db.table("documents")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(500)
    )
    if not include_inactive:
        query = query.eq("is_active", True)
    return rows(query.execute())


def search(business_id: str, query: str, *, limit: int = 4, public_only: bool = True) -> list[dict]:
    """
    Ranked full-text search inside ONE business's documents.

    business_id is not optional and never defaulted: there is no code path in
    this project that searches across businesses.
    """
    text = (query or "").strip()
    if len(text) < 2:
        return []
    try:
        return rows(
            db.rpc(
                "search_documents",
                {
                    "p_business_id": business_id,
                    "p_query": text,
                    "p_limit": limit,
                    "p_public_only": public_only,
                },
            ).execute()
        )
    except Exception:  # noqa: BLE001
        # websearch_to_tsquery rejects some punctuation-only input. A failed
        # search must not break a customer's chat, so it returns nothing and
        # the agent says it could not find anything.
        logger.exception("search_documents failed for %s", business_id)
        return []


# ---------------------------------------------------------------------- write


def create(business_id: str, fields: dict) -> dict:
    row = _clean(fields)
    if not row.get("title"):
        raise DocumentRefused("documents_title_check", RULES["documents_title_check"])
    row["business_id"] = business_id
    row.setdefault("category", "other")
    created = one(_run(db.table("documents").insert(row)))
    if created is None:
        raise RuntimeError("Could not create the document")
    logger.info("Document %s created", created["title"])
    return created


def update(business_id: str, document_id: str, fields: dict) -> dict | None:
    patch = _clean(fields)
    if patch:
        _run(
            db.table("documents")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", document_id)
        )
    return get(business_id, document_id)


def attach_file(
    business_id: str,
    document_id: str,
    *,
    storage_path: str,
    file_name: str,
    mime_type: str,
    size_bytes: int,
) -> dict | None:
    """
    Point a document row at a stored file.

    Separate from update() because these four columns are not the owner's to
    edit - they describe what is actually in the bucket, and only the upload
    route sets them.
    """
    db.table("documents").update(
        {
            "storage_path": storage_path,
            "file_name": file_name,
            "mime_type": mime_type,
            "size_bytes": size_bytes,
        }
    ).eq("business_id", business_id).eq("id", document_id).execute()
    return get(business_id, document_id)


def archive(business_id: str, document_id: str) -> dict | None:
    """
    Hide a document rather than deleting it.

    The file stays in storage and the row stays in the table, because "we
    deleted the policy the customer was quoted" is a bad conversation to have.
    """
    return update(business_id, document_id, {"is_active": False})


# -------------------------------------------------------------------- storage


def _safe_name(name: str) -> str:
    """A storage-safe file name. Keeps the extension, drops everything odd."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "file").strip())[:80]
    return cleaned.strip("-. ") or "file"


def upload_file(business_id: str, file_name: str, data: bytes, mime_type: str) -> str:
    """
    Put a file in the private bucket and return its path.

    The path always starts with the business id, so one business's files can
    never be listed or fetched under another's prefix even by accident.
    """
    path = f"{business_id}/{uuid.uuid4().hex}-{_safe_name(file_name)}"
    db.storage.from_(BUCKET).upload(
        path, data, {"content-type": mime_type or "application/octet-stream"}
    )
    logger.info("Uploaded %s (%s bytes)", path, len(data))
    return path


def signed_url(storage_path: str, expires_in: int = 300) -> str | None:
    """
    A link that works for a few minutes, then stops.

    The bucket is private. Nothing returns a permanent public URL, so an
    uploaded contract does not become world-readable because a link leaked.
    """
    if not storage_path:
        return None
    try:
        response = db.storage.from_(BUCKET).create_signed_url(storage_path, expires_in)
        return response.get("signedURL") or response.get("signedUrl")
    except Exception:  # noqa: BLE001
        logger.exception("Could not sign %s", storage_path)
        return None


def remove_file(storage_path: str) -> None:
    if storage_path:
        try:
            db.storage.from_(BUCKET).remove([storage_path])
        except Exception:  # noqa: BLE001
            logger.exception("Could not remove %s", storage_path)


def extract_text(file_name: str, data: bytes, mime_type: str) -> str:
    """
    The text we can read without another library.

    Plain text and Markdown are read directly. A PDF or a Word file is stored
    and stays downloadable, but returns "" - so the assistant cannot quote it
    until someone pastes the text. That is the honest limit of not adding a
    PDF parser, and the screen tells the owner exactly that.
    """
    looks_texty = (mime_type or "") in READABLE_TYPES or file_name.lower().endswith(
        (".txt", ".md", ".csv", ".json")
    )
    if not looks_texty:
        return ""
    try:
        return data.decode("utf-8", errors="replace")[:100_000]
    except Exception:  # noqa: BLE001
        return ""

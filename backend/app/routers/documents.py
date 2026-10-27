"""
The owner's documents screen: /api/v1/dashboard/documents.

Files live in a PRIVATE Supabase Storage bucket. Nothing here ever returns a
permanent public URL - downloads are signed links that expire in five minutes,
and only the owner (who has the dashboard key) can ask for one.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.repositories import businesses as business_repo
from app.repositories import documents as document_repo
from app.schemas import DocumentInput, DocumentPatch
from app.security import business_scope, require_dashboard_key

logger = logging.getLogger("aibh.router.documents")

router = APIRouter(
    prefix="/api/v1/dashboard/documents",
    tags=["documents"],
    dependencies=[Depends(require_dashboard_key)],
)

MAX_UPLOAD_MB = 10


def _is_uuid(value: str | None) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _document(row: dict) -> dict:
    """documents row -> the frontend's BusinessDocument type."""
    content = row.get("content") or ""
    return {
        "id": row["id"],
        "businessId": row["business_id"],
        "title": row["title"],
        "category": row.get("category") or "other",
        "description": row.get("description") or "",
        "fileName": row.get("file_name") or "",
        "mimeType": row.get("mime_type") or "",
        "sizeBytes": int(row.get("size_bytes") or 0),
        "hasFile": bool(row.get("storage_path")),
        # Whether the ASSISTANT can quote it. A stored PDF with no extracted
        # text is downloadable but not quotable, and the screen says so.
        "isSearchable": bool(content.strip()),
        "isPublic": bool(row.get("is_public")),
        "isActive": bool(row.get("is_active", True)),
        "preview": content[:400],
        "contentLength": len(content),
        "uploadedBy": row.get("uploaded_by") or "owner",
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _load(business_id: str, document_id: str) -> dict:
    doc = document_repo.get(business_id, document_id) if _is_uuid(document_id) else None
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("")
def list_documents(business_id: str = Depends(business_scope)) -> dict:
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    docs = [_document(d) for d in document_repo.list_documents(business_id)]
    return {
        "documents": docs,
        "maxUploadMb": MAX_UPLOAD_MB,
        # Honest counts for the screen's summary.
        "quotable": sum(1 for d in docs if d["isSearchable"] and d["isPublic"]),
    }


@router.get("/{document_id}")
def get_document(document_id: str, business_id: str = Depends(business_scope)) -> dict:
    doc = _load(business_id, document_id)
    shaped = _document(doc)
    shaped["content"] = doc.get("content") or ""
    return {"document": shaped}


@router.get("/{document_id}/download")
def download_document(document_id: str, business_id: str = Depends(business_scope)) -> dict:
    """A link that works for five minutes. Never a permanent public URL."""
    doc = _load(business_id, document_id)
    if not doc.get("storage_path"):
        raise HTTPException(status_code=404, detail="This document has no file attached.")
    url = document_repo.signed_url(doc["storage_path"], expires_in=300)
    if not url:
        raise HTTPException(status_code=502, detail="Could not create a download link.")
    return {"url": url, "expiresInSeconds": 300}


@router.post("", status_code=201)
def create_document(payload: DocumentInput, business_id: str = Depends(business_scope)) -> dict:
    """Add a document by pasting its text. For a file, use /upload."""
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        created = document_repo.create(business_id, payload.model_dump())
    except document_repo.DocumentRefused as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"document": _document(created)}


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    category: str = Form("other"),
    description: str = Form(""),
    is_public: bool = Form(False),
    business_id: str = Depends(business_scope),
) -> dict:
    """
    Upload a file.

    Text and Markdown are read so the assistant can quote them. A PDF or Word
    file is stored and stays downloadable, but its text is NOT extracted -
    adding a PDF parser was not worth a new dependency for this project. The
    response says `isSearchable: false` so the screen can tell the owner to
    paste the text if they want it quotable.
    """
    if business_repo.get_business(business_id) is None:
        raise HTTPException(status_code=404, detail="Business not found")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail=f"Files must be under {MAX_UPLOAD_MB} MB."
        )

    name = file.filename or "document"
    content = document_repo.extract_text(name, data, file.content_type or "")

    try:
        path = document_repo.upload_file(business_id, name, data, file.content_type or "")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Upload failed")
        raise HTTPException(status_code=502, detail=f"Could not store the file: {exc}") from exc

    try:
        created = document_repo.create(
            business_id,
            {
                "title": (title or "").strip() or name,
                "category": category,
                "description": description,
                "content": content,
                "is_public": is_public,
            },
        )
    except document_repo.DocumentRefused as error:
        # The row was refused, so the file we just stored has nothing pointing
        # at it. Remove it rather than leaving an orphan in the bucket.
        document_repo.remove_file(path)
        raise HTTPException(status_code=409, detail=str(error)) from error

    fresh = (
        document_repo.attach_file(
            business_id,
            created["id"],
            storage_path=path,
            file_name=name,
            mime_type=file.content_type or "",
            size_bytes=len(data),
        )
        or created
    )
    logger.info("Document %s uploaded (%s bytes, searchable=%s)", name, len(data), bool(content))
    return {"document": _document(fresh)}


@router.patch("/{document_id}")
def update_document(
    document_id: str, payload: DocumentPatch, business_id: str = Depends(business_scope)
) -> dict:
    _load(business_id, document_id)
    try:
        updated = document_repo.update(
            business_id, document_id, payload.model_dump(exclude_none=True)
        )
    except document_repo.DocumentRefused as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"document": _document(updated)} if updated else {"document": None}


@router.delete("/{document_id}")
def archive_document(document_id: str, business_id: str = Depends(business_scope)) -> dict:
    """
    Hide it, do not destroy it.

    A customer may have been quoted this policy last week. Keeping the row
    means that conversation still makes sense.
    """
    _load(business_id, document_id)
    archived = document_repo.archive(business_id, document_id)
    return {"document": _document(archived) if archived else None, "archived": True}

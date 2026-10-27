# Guide 7 — The Documents Agent (STEP 63 → STEP 67)

The business's own written material: price lists, policies, forms. Publish one
and the assistant can quote it to a customer instead of inventing something
that sounds about right.

---

## The decision that shapes this guide: no RAG

The textbook answer is embeddings and a vector database. We are not doing that,
on purpose.

| | Full-text search (what we built) | RAG with embeddings |
| --- | --- | --- |
| Documents a gym actually has | 10–50 | designed for 100,000+ |
| Extra services | none | embedding model + vector store |
| Cost | ₹0 | per-document and per-query |
| Moving parts | one SQL function | model, store, re-indexing, drift |
| Answer to "what does the refund policy say?" | correct | correct |

Postgres already ships with `tsvector`, `websearch_to_tsquery` and ranking. For
tens of documents it is instant and free.

**When to change your mind:** tens of thousands of documents, or questions
phrased so differently from the text that keyword search misses them
("can I get my money back?" versus a policy that only says "refund"). At that
point embeddings earn their cost. Not before.

> The database from migration 001 already has a dormant `embedding vector(384)`
> column, created early and never used. It is still unused. Adding a column is
> not the same as building RAG.

---

## What the agent can and cannot do

| Can | Cannot |
| --- | --- |
| Search documents the owner **published** | See private documents |
| Quote their text | Send anyone a file |
| Say which document it came from | Guess when nothing matches |

`is_public` defaults to **false**. A salary sheet uploaded by mistake is not
quotable until somebody decides it should be.

---

## STEP 63 — The documents migration

### Goal

One table, a search index kept up to date by a trigger, a search function, and
a private storage bucket.

### Architecture

Two independent things live in one row:

```
  content        the searchable TEXT   -> what the assistant can quote
  storage_path   the FILE in Storage   -> what the owner can download
```

A row can have either, or both:

| What the owner did | content | file | Assistant can quote it? |
| --- | --- | --- | --- |
| Pasted a policy | yes | no | yes |
| Uploaded `prices.txt` | yes (read automatically) | yes | yes |
| Uploaded `policy.pdf` | **no** | yes | **no**, until they paste the text |

That last row is the honest limit of not adding a PDF parser, and the screen
says so rather than silently failing.

### Files involved

```
database/migrations/
└── 006_documents_agent.sql     ← new
```

### Code

**`database/migrations/006_documents_agent.sql`** — complete file:

```sql
-- ============================================================================
-- 006_documents_agent.sql
-- Business documents for the Documents Agent.
-- Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- There is NO RAG here, and that is deliberate. A small business has tens of
-- documents, not millions. Postgres full-text search over the extracted text
-- answers "what does the refund policy say?" in one query, with no embedding
-- model, no vector database and no extra cost. If this ever grows to tens of
-- thousands of documents, that is the moment to add embeddings - not before.
-- ============================================================================

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,

  title         text not null check (char_length(btrim(title)) between 1 and 200),
  category      text not null default 'other'
                  check (category in ('price_list', 'policy', 'form', 'guide', 'receipt', 'other')),
  description   text not null default '',

  -- The file itself, in Supabase Storage. Null when the owner pasted text
  -- instead of uploading a file, which is allowed and common.
  storage_path  text,
  file_name     text,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),

  -- The searchable text. For a .txt or .md upload this is the file; for a PDF
  -- the owner can paste it. Empty means "the agent cannot quote this one".
  content       text not null default '',

  -- May the chat assistant quote this to a customer? Defaults to FALSE.
  -- A document is private until the owner decides otherwise: an internal
  -- salary sheet uploaded by mistake must not become quotable by default.
  is_public     boolean not null default false,
  is_active     boolean not null default true,

  uploaded_by   text not null default 'owner',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Filled by the trigger below. Never written by hand.
  search_vector tsvector
);

create index if not exists documents_business_idx
  on public.documents (business_id, is_active, created_at desc);

create index if not exists documents_search_idx
  on public.documents using gin (search_vector);

-- One document per title per business, so re-uploading replaces rather than
-- silently duplicating.
create unique index if not exists documents_title_uidx
  on public.documents (business_id, lower(btrim(title)))
  where is_active;

-- ------------------------------------------------- keep the index in step
create or replace function public.update_document_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
      setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.content, '')), 'C');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists documents_search_vector_update on public.documents;
create trigger documents_search_vector_update
  before insert or update of title, description, content on public.documents
  for each row execute function public.update_document_search_vector();

-- Backfill anything already there.
update public.documents set title = title where search_vector is null;

alter table public.documents enable row level security;
drop policy if exists documents_member_access on public.documents;
create policy documents_member_access on public.documents
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- --------------------------------------------------------------- searching
-- Ranked full-text search, restricted to ONE business and to documents the
-- owner marked public. The business_id argument is not optional: there is no
-- code path that searches every business's documents.
create or replace function public.search_documents(
  p_business_id uuid,
  p_query       text,
  p_limit       int default 4,
  p_public_only boolean default true
)
returns table (
  id          uuid,
  title       text,
  category    text,
  description text,
  content     text,
  rank        real
)
language sql
stable
as $$
  select
    d.id,
    d.title,
    d.category,
    d.description,
    -- Long documents are cut down: the agent needs an answer, not a novel.
    left(d.content, 1200) as content,
    ts_rank(d.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from public.documents d
  where d.business_id = p_business_id
    and d.is_active
    and (not p_public_only or d.is_public)
    and d.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc, d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 4), 10));
$$;

revoke execute on function public.search_documents(uuid, text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.search_documents(uuid, text, int, boolean)
  to service_role;

-- ------------------------------------------------------------ file storage
-- A private bucket. Files are reached through short-lived signed URLs created
-- by the backend, never by a public link, so an uploaded contract does not
-- become world-readable because someone guessed a path.
insert into storage.buckets (id, name, public)
values ('business-documents', 'business-documents', false)
on conflict (id) do nothing;

-- --------------------------------------------- switch it on for the demo gym
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
select id, 'documents', true, '{"max_file_mb": 10}'::jsonb
  from public.businesses
on conflict (business_id, agent_key) do update set is_active = true;

notify pgrst, 'reload schema';

select
  (select count(*) from public.documents) as documents,
  (select count(*) from storage.buckets where id = 'business-documents') as bucket,
  (select bool_and(is_active) from public.agent_subscriptions
    where agent_key = 'documents') as documents_active;
```

### Explain the code

```sql
new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
  || setweight(to_tsvector('english', coalesce(new.description, '')), 'B')
  || setweight(to_tsvector('english', coalesce(new.content, '')), 'C');
```
Weights, so a match in the **title** outranks one buried in the body. A
document called "Cancellation Policy" beats one that merely mentions
cancellation in passing.

```sql
before insert or update of title, description, content on public.documents
```
Only those three columns re-index. Publishing a document, or attaching a file,
does not waste work rebuilding an index that has not changed.

```sql
    and (not p_public_only or d.is_public)
```
The search function takes `p_public_only`, and the chat tool always passes
`true`. The owner's own screen passes `false`. One function, two callers, and
the difference is explicit rather than hidden.

```sql
insert into storage.buckets (id, name, public)
values ('business-documents', 'business-documents', false)
```
**`false`** is the whole point. A public bucket means a leaked path is a leaked
document, forever. Downloads go through five-minute signed links instead.

```sql
  limit greatest(1, least(coalesce(p_limit, 4), 10));
```
A caller cannot ask for 10,000 rows. Bounds belong next to the query, not in
the hope that every caller behaves.

### Expected result

```
documents | bucket | documents_active
----------+--------+------------------
0         | 1      | true
```

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `relation "storage.buckets" does not exist` | Storage not enabled | It is enabled by default on Supabase; check the Storage tab. |
| `bucket` is 0 | The insert was skipped | `select * from storage.buckets;` — create `business-documents` (private) by hand. |

---

## STEP 64 — The repository, and the tool

### Files involved

```
backend/app/
├── repositories/documents.py         ← new
└── agents/tools/document_tools.py    ← new
```

### Code

**`backend/app/repositories/documents.py`** — complete file:

```python
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
```

**`backend/app/agents/tools/document_tools.py`** — complete file:

```python
"""
Tools for the Documents capability.

ONE tool, and it only reads documents the owner has marked PUBLIC:

    look_up_document - what does our written policy actually say?

This is the same idea as search_knowledge, for longer material. The knowledge
base holds short answers the owner typed; documents hold the real price list
and the real policy. Both exist so the assistant quotes what the business
wrote instead of inventing something plausible.

Two things it deliberately cannot do:

  * see private documents. `is_public` defaults to FALSE, so a salary sheet
    uploaded by mistake is not quotable until someone decides otherwise.
  * hand out a file. It returns TEXT. Download links are signed, short-lived
    and owner-only, so a customer cannot be given a link to the raw file.
"""

from __future__ import annotations

import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.agents.tools.support_tools import AgentContext
from app.repositories import documents as document_repo

logger = logging.getLogger("aibh.tools.documents")

CATEGORY_WORDS = {
    "price_list": "price list",
    "policy": "policy",
    "form": "form",
    "guide": "guide",
    "receipt": "receipt",
    "other": "document",
}


class DocumentArgs(BaseModel):
    query: str = Field(
        description="Keywords describing what the customer wants to know, in their "
        "own words plus obvious synonyms, e.g. 'refund cancellation policy'. "
        "Not a full sentence."
    )


def _look_up(ctx: AgentContext, query: str) -> dict:
    found = document_repo.search(ctx.business_id, query, limit=3, public_only=True)

    if not found:
        return {
            "found": 0,
            "instruction": "No document covers this. Do NOT guess. Say you will check "
            "with the team and offer to take their number, or call escalate_to_human.",
        }

    return {
        "found": len(found),
        "documents": [
            {
                "title": doc["title"],
                "kind": CATEGORY_WORDS.get(doc.get("category") or "other", "document"),
                "text": (doc.get("content") or "")[:900],
            }
            for doc in found
        ],
        "instruction": "Answer using ONLY the text above, and say which document it "
        "came from (for example 'our cancellation policy says...'). Do not add "
        "conditions it does not mention, and do not offer to send the file.",
    }


def build_tools(ctx: AgentContext) -> list[StructuredTool]:
    """Document tools, bound to this business."""

    def wrap(fn, name: str, description: str, args_schema: type[BaseModel]) -> StructuredTool:
        def safe(**kwargs) -> dict:
            try:
                return fn(ctx, **kwargs)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Tool %s failed", name)
                return {"error": f"{name} failed: {exc}"}

        return StructuredTool.from_function(
            func=safe, name=name, description=description, args_schema=args_schema
        )

    return [
        wrap(
            _look_up,
            "look_up_document",
            "Search the business's written documents - price lists, policies, forms - "
            "for what they actually say. Use this for detailed questions about rules, "
            "refunds, cancellations, terms or prices where search_knowledge gave you "
            "nothing. Returns text only; you cannot send anyone a file.",
            DocumentArgs,
        ),
    ]
```

### Explain the code

```python
    path = f"{business_id}/{uuid.uuid4().hex}-{_safe_name(file_name)}"
```
Every path starts with the business id, so one business's files can never be
listed under another's prefix. The random hex means two files called
`prices.pdf` do not collide.

```python
def signed_url(storage_path, expires_in=300):
```
Five minutes. Long enough to download, short enough that a link pasted into a
group chat stops working.

```python
    except Exception:
        logger.exception("search_documents failed for %s", business_id)
        return []
```
`websearch_to_tsquery` rejects some punctuation-only input. A customer typing
"???" must not break their chat, so a failed search returns nothing and the
agent says it could not find anything.

```python
    looks_texty = (mime_type or "") in READABLE_TYPES or file_name.lower().endswith(...)
```
Deliberately narrow. Decoding a PDF as UTF-8 would produce pages of rubbish,
and the assistant would then quote that rubbish to a customer. Better to know
we cannot read it.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `Bucket not found` | Migration 006 not applied | Run it. |
| Search finds nothing for an obvious word | The document is private, or has no text | Publish it, and check `isSearchable`. |

---

## STEP 65 — The owner's API

### Files involved

```
backend/app/
├── routers/documents.py    ← new
├── schemas.py              ← edit
└── main.py                 ← edit
```

### Code

**`backend/app/routers/documents.py`** — complete file:

```python
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
```

### Explain the code

```python
    except document_repo.DocumentRefused as error:
        document_repo.remove_file(path)
        raise HTTPException(status_code=409, detail=str(error)) from error
```
The file was stored, then the row was refused (a duplicate title). Without this
the bucket slowly fills with files nothing points at.

```python
@router.delete("/{document_id}")
def archive_document(...):
    """Hide it, do not destroy it."""
```
A customer may have been quoted this policy last week. Keeping the row means
that conversation still makes sense.

```python
        "isSearchable": bool(content.strip()),
```
Sent to the screen so it can say *"stored, but I cannot quote it"* instead of
leaving the owner to wonder why the assistant ignores their PDF.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Upload gives 422 | `python-multipart` missing | `pip install python-multipart` (it is already in the venv). |
| Uploaded file is corrupt | The Next.js proxy read the body as text | STEP 67's proxy fix. |

---

## STEP 66 — Test it

### Code

**`backend/scripts/check_documents.py`** — complete file:

```python
"""
The documents rules, proven against the real database. No LLM.

What this checks:
  * full-text search finds the right document, and ranks it
  * PRIVATE documents are invisible to the chat assistant
  * a file with no extracted text is stored but not quotable
  * one business cannot search or read another's documents
  * files go into a private bucket and are reached by short-lived signed links

Runs in a throwaway sandbox business. Run from backend/:

    python scripts\\check_documents.py
"""

# Make "app" importable when this file is run from backend/ as
# "python scripts/<name>.py" - Python puts scripts/ on sys.path, not backend/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.tools import document_tools
from app.agents.tools.support_tools import AgentContext
from app.db import db, one
from app.repositories import documents as document_repo
from sandbox import create_sandbox, destroy_sandbox

REFUND_POLICY = (
    "Refund and cancellation policy. Memberships may be cancelled with 30 days "
    "written notice. Personal training sessions cancelled less than 24 hours "
    "before the appointment are charged in full. We do not refund joining fees."
)
PRICE_LIST = (
    "Price list 2026-27. Monthly membership 1800 rupees. Personal training pack "
    "of 12 sessions 9000 rupees. Yoga add-on 600 rupees per month."
)
STAFF_ONLY = "Staff salary review notes. Trainer salaries increase 8 percent in April."

failures = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<54} {detail}")


def refused_with(rule: str, fn) -> bool:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        return rule in str(exc) or getattr(exc, "rule", "") == rule
    return False


sandbox = create_sandbox("documents")
other = create_sandbox("documents-other")
bid = sandbox["id"]

try:
    print("\ndocuments")
    policy = document_repo.create(
        bid,
        {"title": "Cancellation Policy", "category": "policy", "content": REFUND_POLICY,
         "is_public": True},
    )
    prices = document_repo.create(
        bid,
        {"title": "Price List", "category": "price_list", "content": PRICE_LIST, "is_public": True},
    )
    private = document_repo.create(
        bid, {"title": "Salary Notes", "category": "other", "content": STAFF_ONLY}
    )
    check("created", bool(policy["id"]) and bool(prices["id"]))
    check("a new document is PRIVATE by default", private["is_public"] is False)
    check("same title again -> refused",
          refused_with("documents_title_uidx",
                       lambda: document_repo.create(bid, {"title": "cancellation policy"})))
    check("an unknown category -> refused",
          refused_with("documents_category_check",
                       lambda: document_repo.create(bid, {"title": "X", "category": "secret"})))
    check("no title -> refused",
          refused_with("documents_title_check", lambda: document_repo.create(bid, {"title": " "})))

    print("\nsearching")
    found = document_repo.search(bid, "cancellation refund")
    check("finds the policy by its words", found and found[0]["title"] == "Cancellation Policy",
          [d["title"] for d in found])
    check("  ...and returns the text to quote", "30 days" in (found[0]["content"] if found else ""))
    check("finds the price list by a different word",
          any(d["title"] == "Price List" for d in document_repo.search(bid, "membership price")))
    check("nonsense finds nothing", document_repo.search(bid, "helicopter maintenance") == [])
    check("punctuation only does not crash", document_repo.search(bid, "???") == [])

    print("\nprivate documents stay private")
    check("a private document is NOT searchable by the assistant",
          not any(d["title"] == "Salary Notes" for d in document_repo.search(bid, "salary trainer")))
    check("  ...but the owner can still find it",
          any(d["title"] == "Salary Notes"
              for d in document_repo.search(bid, "salary trainer", public_only=False)))
    document_repo.update(bid, private["id"], {"is_public": True})
    check("published -> now visible to the assistant",
          any(d["title"] == "Salary Notes" for d in document_repo.search(bid, "salary trainer")))
    document_repo.update(bid, private["id"], {"is_public": False})

    print("\none business cannot read another's")
    check("search in the other business finds nothing",
          document_repo.search(other["id"], "cancellation refund") == [])
    check("get with the wrong business_id -> nothing",
          document_repo.get(other["id"], policy["id"]) is None)
    check("the other business lists nothing", document_repo.list_documents(other["id"]) == [])

    print("\nthe chat tool")
    ctx = AgentContext(business_id=bid, conversation_id="dry-run", business=sandbox)
    tools = {t.name: t for t in document_tools.build_tools(ctx)}
    check("exactly one tool, and it only reads", list(tools) == ["look_up_document"], list(tools))

    answer = tools["look_up_document"].invoke({"query": "cancellation refund"})
    check("the tool finds the policy", answer.get("found", 0) >= 1, answer.get("found"))
    check("  ...and tells the model to quote it",
          "ONLY the text above" in answer.get("instruction", ""))
    check("  ...and not to offer the file", "do not offer to send" in answer.get("instruction", ""))

    hidden = tools["look_up_document"].invoke({"query": "salary trainer percent"})
    check("the tool cannot see private documents", hidden.get("found", 0) == 0, hidden.get("found"))
    nothing = tools["look_up_document"].invoke({"query": "helicopter maintenance"})
    check("nothing found -> told NOT to guess", "Do NOT guess" in nothing.get("instruction", ""))

    print("\nfiles")
    text_path = document_repo.upload_file(bid, "hours.txt", b"We open at 7 AM.", "text/plain")
    check("uploaded into the business's own folder", text_path.startswith(f"{bid}/"), text_path[:40])
    url = document_repo.signed_url(text_path, expires_in=60)
    check("download link is signed, not public", bool(url) and "token=" in (url or ""),
          (url or "")[:60])

    readable = document_repo.extract_text("hours.txt", b"We open at 7 AM.", "text/plain")
    check("text files are read, so the assistant can quote them", readable == "We open at 7 AM.")
    pdf = document_repo.extract_text("policy.pdf", b"%PDF-1.4 binary", "application/pdf")
    check("a PDF is stored but NOT read (honest limit)", pdf == "", repr(pdf))

    document_repo.remove_file(text_path)

    print("\narchiving")
    document_repo.archive(bid, prices["id"])
    check("archived -> gone from the list",
          not any(d["id"] == prices["id"] for d in document_repo.list_documents(bid)))
    check("  ...and gone from search", not any(d["title"] == "Price List"
                                               for d in document_repo.search(bid, "membership price")))
    check("  ...but the row is still there, not deleted",
          document_repo.get(bid, prices["id"]) is not None)

finally:
    destroy_sandbox(sandbox)
    destroy_sandbox(other)
    gone = one(db.table("businesses").select("id").eq("id", bid).execute())
    print(f"\nsandbox removed: {gone is None}")

print("\nALL PASS" if failures == 0 else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
```

### Expected result

```
private documents stay private
  PASS  a private document is NOT searchable by the assistant
  PASS    ...but the owner can still find it
  PASS  published -> now visible to the assistant

files
  PASS  uploaded into the business's own folder    e2eef1d6-.../24c...
  PASS  download link is signed, not public        https://...token=
  PASS  text files are read, so the assistant can quote them
  PASS  a PDF is stored but NOT read (honest limit)   ''
...
ALL PASS
```

This runs against **real** Supabase Storage: it uploads a file, signs a link,
and deletes it.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `download link is signed` fails | The bucket is public | It must be private; check the Storage tab. |
| Search tests fail | The trigger did not fire | `update documents set title = title;` to rebuild the index. |

---

## STEP 67 — Wire the screen, and fix the proxy

### Goal

Upload, publish, paste text, download.

### The bug this step exists to fix

The Next.js proxy read every request body as **text**:

```ts
const body = ... await request.text();
headers: { "Content-Type": "application/json", ... }
```

That works for JSON and destroys everything else. A `multipart/form-data`
upload would arrive with its binary mangled and its boundary marker replaced.
Found by reading the proxy before writing the upload, rather than by debugging
a corrupted PDF afterwards.

**The fix:**

```ts
const body = hasBody ? await request.arrayBuffer() : undefined;
const contentType = request.headers.get("content-type") ?? "application/json";
```

Bytes, and the caller's own content type so the multipart boundary survives.

And in the API client, the matching half:

```ts
// FormData must NOT get a Content-Type header set by hand - the browser adds
// one with the multipart boundary, and overriding it makes the upload
// unreadable at the other end.
```

### Files involved

```
frontend/src/
├── app/api/hub/[...path]/route.ts                  ← edit (bytes, not text)
├── types/document.ts                               ← edit
├── lib/api/dashboard.ts                            ← edit (upload helper)
├── app/dashboard/documents/page.tsx                ← edit
└── features/documents/components/                  ← edit all three
```

`src/data/mock-documents.ts` is **deleted**: the screen is fully live, and its
`documentStatusMeta` ("processing") described a fake upload progress bar that no
longer exists.

### Explain the code

```tsx
const [draft, setDraft] = useState<string | null>(null);
const value = draft ?? content ?? "";
```
`null` means "the owner has not typed anything yet", so the box shows whatever
text arrived. The first version copied `content` into state inside a
`useEffect`, which lint correctly rejected: an effect that copies a prop into
state causes an extra render and gets out of step the moment the prop changes.

### How to test

| # | Do this | Expect |
| --- | --- | --- |
| 1 | **Paste text instead** → title "Cancellation Policy", paste a policy, tick publish | Appears, marked **Used by chat** |
| 2 | Public chat: *"what's your cancellation policy?"* | Quotes it, and says where from |
| 3 | Upload a `.txt` file | Uploads and is quotable straight away |
| 4 | Upload a `.pdf` | Uploads, marked **No readable text** |
| 5 | Open it, paste the text, **Save text** | Now quotable |
| 6 | Untick publish, ask in a **new** chat | The assistant no longer knows it |
| 7 | **Download** on a file | Opens; the link expires in 5 minutes |
| 8 | **Remove** | Gone from the list, but the row is kept |

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| Upload fails with 502 | The bucket is missing | Migration 006. |
| Download opens a broken file | Old proxy still deployed | The `arrayBuffer` fix, then restart `npm run dev`. |
| Assistant ignores a published PDF | It has no text | Paste the text; the list warns about this. |

---

## Checklist

- [ ] `006_documents_agent.sql` applied; `bucket = 1`
- [ ] `python scripts\check_documents.py` → `ALL PASS` (30 checks)
- [ ] A published policy is quoted in chat; a private one is not
- [ ] A PDF uploads, says "no readable text", and becomes quotable once pasted

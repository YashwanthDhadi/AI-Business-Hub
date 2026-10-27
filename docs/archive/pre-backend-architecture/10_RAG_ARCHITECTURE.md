# 10 — RAG architecture

## RAG does not exist in this project

Stated plainly, because the user's instruction requires it: **there is no
retrieval-augmented generation in this repository.** Not partially, not
scaffolded, not disabled behind a flag. None of the components exist.

Verified by searching every tracked file (`git ls-files`, all `.ts`, `.tsx`,
`.sql`, `.json`, `.mjs`):

| Component | Present? |
| --- | --- |
| Embedding model or embedding call | **No** — 0 occurrences of `embedding`, `embed(`, `text-embedding` |
| Vector database | **No** — 0 occurrences of Pinecone, Chroma, Weaviate, Qdrant, FAISS, Milvus, LanceDB |
| `pgvector` extension | **No** — the only extensions created are `pgcrypto` (`migrations/20260910120000_enums.sql:12`) and `pgtap` (`tests/rls.test.sql:16`, test-only) |
| A `vector` column anywhere | **No** — 0 columns of type `vector` across 24 tables |
| Chunking / splitting logic | **No** — 0 occurrences of `chunk`, `splitter`, `overlap` |
| Similarity search (cosine, dot product, `<=>`, `<->`) | **No** |
| Reranking | **No** |
| A retriever, index, or query pipeline | **No** |
| Document ingestion or loaders | **No** |
| Metadata filtering for retrieval | **No** |

There is also nothing for RAG to retrieve *from*: no document corpus, no FAQ
file, no policy text, no uploaded-file store. `config.features.attachments` is
`true` but no upload handler exists.

---

## What might look like RAG and is not

Three things could be mistaken for retrieval. Each is something else.

### 1. "Knowledge base" as a string

`lib/mock/agents.ts:39` — the Support Agent's `tools` array contains
`"Knowledge base"`. `lib/mock/capabilities.ts:37` — the `customer_support`
capability's `connectedTools` contains `"Business knowledge base"`. Both are
display strings rendered as chips in the UI. No knowledge base exists, and no
code resolves either string to anything.

Same strings are carried into `supabase/seed.sql` (`capabilities.connected_tools`
and `agents.tools`, both `text[]` columns) — still just text.

### 2. A Postgres full-text index

`supabase/migrations/20260910120500_indexes.sql:21-25` is the only search
infrastructure in the project:

```sql
-- Powers the search box on the customers table.
create index customers_search_idx
  on public.customers using gin (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(email, '')
      || ' ' || coalesce(phone, ''))
  );
```

This is lexical full-text search over three customer columns — a GIN index for a
`WHERE to_tsvector(...) @@ to_tsquery(...)` lookup. It is keyword matching, not
semantic retrieval: no embeddings, no vectors, no similarity ranking. The
`'simple'` configuration means no stemming and no stop-word removal either.

It is also **currently unused by any query.** The customers search box
(`app/app/customers/page.tsx`) filters the in-memory mock array with
`String.includes`, in `lib/services/customer-service.ts`. The index exists for the
future Postgres-backed query.

### 3. `datasetFor()` — direct lookup, not retrieval

`lib/mock/business-data.ts:566` returns a tenant's whole dataset from a `Map`.
The step builder then reads from it with `.filter()` and `.find()`. That is a
keyed lookup over exact data, which is the opposite of retrieval: no ranking, no
approximation, no relevance score.

---

## What the system does instead of retrieval

The command pipeline grounds itself in **direct structured queries**, not
retrieved text. When the screen says "17 overdue customers found", the 17 came
from `overduePayments(businessId)` filtering a typed array — the exact rows, not
a similarity search over a document store.

For this product's actual jobs, that is the right primitive and RAG is not
obviously needed:

| Job | Grounding it needs |
| --- | --- |
| Find overdue invoices | A `WHERE status = 'overdue'` query |
| Show today's bookings | A date-range query |
| Reorder low stock | A `WHERE quantity <= reorder_level` query |
| Draft a payment reminder | Structured fields: name, amount, due date, invoice number |

None of those is a semantic-search problem.

---

## Where RAG would genuinely help, if it is ever added

Two of the nine capabilities in `lib/mock/capabilities.ts` describe work that
structured queries cannot do:

1. **`customer_support`** — its own description says the agent *"answers questions
   about pricing, timings, availability and services using your business
   information"*. That business information is unstructured, per-tenant, and
   supplied by the owner. Answering from it is a retrieval problem. This is why
   `"Business knowledge base"` is already in the capability's tool list: the
   product design anticipates it. Nothing implements it.
2. **`documents`** — invoices, quotes and receipts. Retrieval over past documents
   would let an agent answer "what did we charge them last time".

If it is built, the pieces that would have to be added, none of which exist
today:

| Piece | Where it would go | Tenant constraint |
| --- | --- | --- |
| `create extension vector` | A new migration | — |
| A `knowledge_documents` table with `business_id` + `content` + `embedding vector(n)` | New migration | `business_id not null`, RLS policy identical to the other 24 tables |
| An ingestion path (upload → chunk → embed → insert) | A server route handler; none exist yet | Must run as the caller, not the service role |
| A retrieval tool | The tool surface in `09_TOOL_ARCHITECTURE.md` | **Must filter by `business_id` before the similarity search, not after** |
| Citations in the step card | `WorkflowStep.records[]` already fits | — |

That fourth row is the one that matters most. Every one of the 50 RLS policies in
`supabase/migrations/*_rls.sql` scopes on `business_id`. A vector index that
searched across all tenants and filtered afterwards would leak one business's
documents into another's answers — the single worst failure this product could
have. Any RAG addition must keep the tenant predicate inside the query. See
`15_SECURITY_ARCHITECTURE.md`.

---

## Related documents

- `09_TOOL_ARCHITECTURE.md` — the structured queries used instead
- `11_DATABASE_ARCHITECTURE.md` — the 24 tables, extensions, and indexes
- `15_SECURITY_ARCHITECTURE.md` — the tenant boundary any retrieval must respect
- `32_UNKNOWN_BROKEN_INCOMPLETE.md` — the unused full-text index

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

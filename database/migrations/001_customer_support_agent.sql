-- ============================================================================
-- 001_customer_support_agent.sql
-- AI Business Hub — schema for the Customer Support Agent (web chat)
--
-- Corrected version:
--   - Fixes PostgreSQL "generation expression is not immutable"
--   - Uses a trigger for knowledge_articles.search_vector
--   - Safe to re-run
-- ============================================================================


-- ============================================================================
-- EXTENSIONS
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists vector;


-- ============================================================================
-- ENUM TYPES
-- ============================================================================

do $$
begin
  create type channel_kind as enum (
    'web',
    'voice',
    'whatsapp',
    'dashboard'
  );
exception
  when duplicate_object then null;
end $$;


do $$
begin
  create type message_direction as enum (
    'inbound',
    'outbound'
  );
exception
  when duplicate_object then null;
end $$;


do $$
begin
  create type message_author as enum (
    'customer',
    'agent',
    'owner',
    'system'
  );
exception
  when duplicate_object then null;
end $$;


do $$
begin
  create type support_kind as enum (
    'escalation',
    'callback'
  );
exception
  when duplicate_object then null;
end $$;


do $$
begin
  create type support_state as enum (
    'open',
    'in_progress',
    'resolved',
    'dismissed'
  );
exception
  when duplicate_object then null;
end $$;


-- ============================================================================
-- BUSINESSES
-- ============================================================================

create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  business_type   text not null default 'other',
  description     text not null default '',
  location        text not null default '',
  timezone        text not null default 'Asia/Kolkata',
  currency        text not null default 'INR',

  -- Opening hours:
  -- [
  --   {
  --     "day": 0,
  --     "open": "10:00",
  --     "close": "20:00",
  --     "closed": false
  --   }
  -- ]
  --
  -- day 0 = Sunday
  -- day 6 = Saturday
  hours          jsonb not null default '[]'::jsonb,

  -- Public chat channel
  chat_slug      text not null unique,
  chat_enabled   boolean not null default true,
  chat_greeting  text not null default 'Hi! How can I help you today?',
  chat_accent    text not null default 'indigo',

  owner_name     text not null default '',
  owner_phone    text,
  owner_email    text,

  -- Free-text instructions provided by the business owner
  -- to the AI workforce.
  agent_persona  text not null default '',

  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);


create index if not exists businesses_chat_slug_idx
  on public.businesses (chat_slug);


-- ============================================================================
-- BUSINESS USERS
-- ============================================================================

create table if not exists public.business_members (
  id          uuid primary key default gen_random_uuid(),

  business_id uuid not null
    references public.businesses(id)
    on delete cascade,

  user_id     uuid not null,

  role        text not null default 'owner'
    check (role in ('owner', 'manager', 'staff')),

  created_at  timestamptz not null default now(),

  unique (business_id, user_id)
);


create index if not exists business_members_user_idx
  on public.business_members (user_id);


-- ============================================================================
-- AGENT SUBSCRIPTIONS
-- ============================================================================

create table if not exists public.agent_subscriptions (
  id            uuid primary key default gen_random_uuid(),

  business_id   uuid not null
    references public.businesses(id)
    on delete cascade,

  agent_key     text not null,

  is_active     boolean not null default true,

  activated_at  timestamptz not null default now(),

  settings      jsonb not null default '{}'::jsonb,

  unique (business_id, agent_key)
);


-- ============================================================================
-- CUSTOMERS
-- ============================================================================

create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),

  business_id   uuid not null
    references public.businesses(id)
    on delete cascade,

  name          text,

  phone         text,

  email         text,

  notes         text not null default '',

  tags          text[] not null default '{}',

  created_at    timestamptz not null default now(),

  last_seen_at  timestamptz not null default now()
);


create index if not exists customers_business_idx
  on public.customers (business_id);


create unique index if not exists customers_business_phone_uidx
  on public.customers (business_id, phone)
  where phone is not null;


create unique index if not exists customers_business_email_uidx
  on public.customers (business_id, email)
  where email is not null;


-- ============================================================================
-- BUSINESS SERVICES
-- ============================================================================

create table if not exists public.business_services (
  id                uuid primary key default gen_random_uuid(),

  business_id       uuid not null
    references public.businesses(id)
    on delete cascade,

  name              text not null,

  description       text not null default '',

  duration_minutes  int not null default 30,

  price             numeric(12,2) not null default 0,

  price_note        text not null default '',

  is_active         boolean not null default true,

  sort_order        int not null default 0,

  created_at        timestamptz not null default now()
);


create index if not exists business_services_business_idx
  on public.business_services (business_id);


-- ============================================================================
-- KNOWLEDGE ARTICLES
-- ============================================================================

create table if not exists public.knowledge_articles (
  id           uuid primary key default gen_random_uuid(),

  business_id  uuid not null
    references public.businesses(id)
    on delete cascade,

  title        text not null,

  body         text not null,

  tags         text[] not null default '{}',

  is_active    boolean not null default true,

  -- Will be used for semantic search later.
  embedding    vector(384),

  created_at   timestamptz not null default now(),

  updated_at   timestamptz not null default now()
);


-- ============================================================================
-- KNOWLEDGE ARTICLE FULL-TEXT SEARCH
--
-- IMPORTANT:
-- PostgreSQL generated columns require immutable expressions.
--
-- Therefore we DO NOT use:
--
--   generated always as (
--     to_tsvector('english', ...)
--   ) stored
--
-- Instead:
--   1. search_vector is a normal tsvector column
--   2. A trigger automatically updates it
-- ============================================================================


-- If an earlier failed version created search_vector as a generated column,
-- remove it so we can create the corrected normal column.
--
-- search_vector contains derived data only, so dropping it does not delete
-- the actual knowledge article title/body/tags.
alter table public.knowledge_articles
  drop column if exists search_vector;


alter table public.knowledge_articles
  add column search_vector tsvector;


-- ============================================================================
-- FUNCTION: UPDATE KNOWLEDGE SEARCH VECTOR
-- ============================================================================

create or replace function public.update_knowledge_search_vector()
returns trigger
language plpgsql
as $$
begin

  new.search_vector :=
    to_tsvector(
      'english'::regconfig,
      coalesce(new.title, '') || ' ' ||
      coalesce(new.body, '') || ' ' ||
      coalesce(array_to_string(new.tags, ' '), '')
    );

  return new;

end;
$$;


-- ============================================================================
-- TRIGGER: AUTOMATIC SEARCH VECTOR UPDATE
-- ============================================================================

drop trigger if exists knowledge_search_vector_update
on public.knowledge_articles;


create trigger knowledge_search_vector_update
before insert or update
on public.knowledge_articles
for each row
execute function public.update_knowledge_search_vector();


-- ============================================================================
-- POPULATE SEARCH VECTOR FOR EXISTING KNOWLEDGE ARTICLES
-- ============================================================================

update public.knowledge_articles
set search_vector =
  to_tsvector(
    'english'::regconfig,
    coalesce(title, '') || ' ' ||
    coalesce(body, '') || ' ' ||
    coalesce(array_to_string(tags, ' '), '')
  );


-- ============================================================================
-- FULL-TEXT SEARCH INDEX
-- ============================================================================

create index if not exists knowledge_search_idx
  on public.knowledge_articles
  using gin (search_vector);


create index if not exists knowledge_business_idx
  on public.knowledge_articles (business_id);


-- ============================================================================
-- CONVERSATIONS
-- ============================================================================

create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),

  business_id          uuid not null
    references public.businesses(id)
    on delete cascade,

  customer_id          uuid
    references public.customers(id)
    on delete set null,

  channel              channel_kind not null default 'web',

  status               text not null default 'open'
    check (status in ('open', 'closed')),

  -- True when a human has taken over the conversation.
  human_takeover       boolean not null default false,

  -- Display label before the visitor is identified.
  visitor_label        text not null default '',

  last_message_at      timestamptz not null default now(),

  last_message_preview text not null default '',

  message_count        int not null default 0,

  created_at           timestamptz not null default now()
);


create index if not exists conversations_business_recent_idx
  on public.conversations (
    business_id,
    last_message_at desc
  );


-- ============================================================================
-- MESSAGES
-- ============================================================================

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),

  business_id     uuid not null
    references public.businesses(id)
    on delete cascade,

  conversation_id uuid not null
    references public.conversations(id)
    on delete cascade,

  direction       message_direction not null,

  author          message_author not null,

  body            text not null default '',

  -- Extra metadata:
  -- tool calls, latency, voice information, etc.
  meta            jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);


create index if not exists messages_conversation_idx
  on public.messages (
    conversation_id,
    created_at asc
  );


-- ============================================================================
-- CHAT SESSIONS
-- ============================================================================

create table if not exists public.chat_sessions (
  id               uuid primary key default gen_random_uuid(),

  business_id      uuid not null
    references public.businesses(id)
    on delete cascade,

  conversation_id  uuid not null
    references public.conversations(id)
    on delete cascade,

  -- SHA-256 hash of the browser session token.
  token_hash       text not null unique,

  -- SHA-256 hash of IP address.
  ip_hash          text,

  user_agent       text,

  message_count    int not null default 0,

  created_at       timestamptz not null default now(),

  last_seen_at     timestamptz not null default now(),

  expires_at       timestamptz not null
    default (now() + interval '7 days')
);


create index if not exists chat_sessions_token_idx
  on public.chat_sessions (token_hash);


create index if not exists chat_sessions_expiry_idx
  on public.chat_sessions (expires_at);


-- ============================================================================
-- SUPPORT REQUESTS
-- ============================================================================

create table if not exists public.support_requests (
  id               uuid primary key default gen_random_uuid(),

  business_id      uuid not null
    references public.businesses(id)
    on delete cascade,

  conversation_id  uuid
    references public.conversations(id)
    on delete set null,

  customer_id      uuid
    references public.customers(id)
    on delete set null,

  kind             support_kind not null default 'escalation',

  status           support_state not null default 'open',

  reason           text not null default '',

  summary          text not null default '',

  contact_name     text,

  contact_phone    text,

  contact_email    text,

  resolved_at      timestamptz,

  resolved_by      text,

  resolution_note  text not null default '',

  created_at       timestamptz not null default now()
);


create index if not exists support_requests_business_status_idx
  on public.support_requests (
    business_id,
    status,
    created_at desc
  );


-- ============================================================================
-- AGENT LOGS
-- ============================================================================

create table if not exists public.agent_logs (
  id                    uuid primary key default gen_random_uuid(),

  business_id           uuid not null
    references public.businesses(id)
    on delete cascade,

  conversation_id       uuid
    references public.conversations(id)
    on delete set null,

  agent_key             text not null,

  model                 text not null default '',

  input_text            text not null default '',

  output_text           text not null default '',

  tool_calls            jsonb not null default '[]'::jsonb,

  latency_ms            int not null default 0,

  status                text not null default 'ok'
    check (status in ('ok', 'error')),

  error                 text,

  -- Owner feedback:
  -- NULL, 'up', or 'down'
  feedback              text
    check (feedback in ('up', 'down')),

  correction            text,

  correction_embedding  vector(384),

  created_at            timestamptz not null default now()
);


create index if not exists agent_logs_business_idx
  on public.agent_logs (
    business_id,
    created_at desc
  );


-- ============================================================================
-- KNOWLEDGE SEARCH FUNCTION
-- ============================================================================

create or replace function public.search_knowledge(
  p_business_id uuid,
  p_query       text,
  p_limit       int default 5
)
returns table (
  id     uuid,
  title  text,
  body   text,
  rank   real
)
language sql
stable
as $$
  select
    a.id,
    a.title,
    a.body,
    ts_rank(
      a.search_vector,
      websearch_to_tsquery('english', p_query)
    ) as rank

  from public.knowledge_articles a

  where a.business_id = p_business_id

    and a.is_active

    and a.search_vector @@
        websearch_to_tsquery('english', p_query)

  order by
    rank desc,
    a.created_at

  limit greatest(
    1,
    least(p_limit, 20)
  );
$$;


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.businesses
  enable row level security;

alter table public.business_members
  enable row level security;

alter table public.agent_subscriptions
  enable row level security;

alter table public.customers
  enable row level security;

alter table public.business_services
  enable row level security;

alter table public.knowledge_articles
  enable row level security;

alter table public.conversations
  enable row level security;

alter table public.messages
  enable row level security;

alter table public.chat_sessions
  enable row level security;

alter table public.support_requests
  enable row level security;

alter table public.agent_logs
  enable row level security;


-- ============================================================================
-- BUSINESS MEMBERSHIP CHECK
-- ============================================================================

create or replace function public.is_business_member(
  target uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = target
      and m.user_id = auth.uid()
  );
$$;


-- ============================================================================
-- RLS POLICIES
-- ============================================================================

do $$
declare
  t text;
begin

  foreach t in array array[
    'agent_subscriptions',
    'customers',
    'business_services',
    'knowledge_articles',
    'conversations',
    'messages',
    'chat_sessions',
    'support_requests',
    'agent_logs'
  ]

  loop

    execute format(
      $f$

      drop policy if exists %1$s_member_access
      on public.%1$s;

      create policy %1$s_member_access
      on public.%1$s

      for all

      using (
        public.is_business_member(business_id)
      )

      with check (
        public.is_business_member(business_id)
      );

      $f$,
      t
    );

  end loop;

end $$;


-- ============================================================================
-- BUSINESSES RLS
-- ============================================================================

drop policy if exists businesses_member_access
on public.businesses;


create policy businesses_member_access
on public.businesses

for all

using (
  public.is_business_member(id)
)

with check (
  public.is_business_member(id)
);


-- ============================================================================
-- BUSINESS MEMBERS RLS
-- ============================================================================

drop policy if exists business_members_self_access
on public.business_members;


create policy business_members_self_access
on public.business_members

for select

using (
  user_id = auth.uid()
);


-- ============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin

  new.updated_at = now();

  return new;

end;
$$;


-- ============================================================================
-- BUSINESSES UPDATED_AT TRIGGER
-- ============================================================================

drop trigger if exists businesses_touch
on public.businesses;


create trigger businesses_touch
before update
on public.businesses

for each row
execute function public.touch_updated_at();


-- ============================================================================
-- KNOWLEDGE ARTICLES UPDATED_AT TRIGGER
-- ============================================================================

drop trigger if exists knowledge_touch
on public.knowledge_articles;


create trigger knowledge_touch
before update
on public.knowledge_articles

for each row
execute function public.touch_updated_at();


-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
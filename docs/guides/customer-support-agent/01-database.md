# Part 1 — The database (STEP 3 → STEP 4)

Two steps: create every table the Customer Support Agent needs, then seed a
realistic demo business so the agent has something true to say from its very
first message.

---

## STEP 3 — Create the schema

### Goal

Create all the tables, the full-text search index, the search function and the
security policies in one go — and save that SQL in the repo as a numbered
migration.

### Why?

The agent is only as good as the data it can read. When a customer asks "do you
open on Sunday?" the agent does not know; it must look it up. So before writing
any Python we decide exactly what is stored and where.

We also save the SQL as a **migration**: a numbered `.sql` file you run once and
never edit. Need a change later? Add `002_something.sql`. The repo then always
describes how to rebuild the database from nothing — which matters the day your
laptop dies, a teammate joins, or you create a production project.

### Architecture

```
                        businesses              (one row per shop/gym/salon)
                        chat_slug = "glow-salon"
                            │
      ┌──────────────┬──────┴───────┬──────────────────┬──────────────┐
      ▼              ▼              ▼                  ▼              ▼
business_members  agent_        business_        knowledge_       customers
(who can log in)  subscriptions services         articles         (only once
                  (which agents (what you sell,  (what the agent   they leave
                   are paid for) with prices)     is allowed to     contact
                                                  say)             details)
                                                                        │
                        conversations  (channel = 'web') ───────────────┘
                              │                 │
                              ▼                 ▼
                          messages        chat_sessions
                     (every chat turn)   (an anonymous visitor's
                              │           browser tab, tokenised)
                              ▼
                      support_requests
                   (escalations + callback
                    requests for the owner)

                        agent_logs   (every LLM run — debugging now,
                                      self-learning in a later phase)
```

Every tenant table carries a `business_id`. No exceptions. That single rule is
what makes one backend safely serve many businesses.

### Files involved

```
database/
└── migrations/
    └── 001_customer_support_agent.sql     ← create this file
```

### Code

Create the folder:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
New-Item -ItemType Directory -Force database\migrations
```

Then create `database/migrations/001_customer_support_agent.sql`:

```sql
-- ============================================================================
-- 001_customer_support_agent.sql
-- AI Business Hub — schema for the Customer Support Agent (web chat).
-- Run once, in the Supabase SQL Editor. Never edit after it has been applied.
-- ============================================================================

-- ---------------------------------------------------------------- extensions
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, used in a later phase

-- ---------------------------------------------------------------- enum types
-- Enums stop typos becoming data. 'ecalated' will be rejected by Postgres.
do $$ begin
  create type channel_kind      as enum ('web', 'voice', 'whatsapp', 'dashboard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_author    as enum ('customer', 'agent', 'owner', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_kind      as enum ('escalation', 'callback');
exception when duplicate_object then null; end $$;

do $$ begin
  create type support_state     as enum ('open', 'in_progress', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- businesses
create table if not exists public.businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  slug            text        not null unique,
  business_type   text        not null default 'other',
  description     text        not null default '',
  location        text        not null default '',
  timezone        text        not null default 'Asia/Kolkata',
  currency        text        not null default 'INR',
  -- Opening hours as JSON: [{"day":0,"open":"10:00","close":"20:00","closed":false}, ...]
  -- day 0 = Sunday .. 6 = Saturday
  hours           jsonb       not null default '[]'::jsonb,

  -- ---- the public chat channel ----
  -- The URL segment customers open: /chat/<chat_slug>. Unguessable is NOT the
  -- goal here; it is meant to be shared. Access control comes from the fact
  -- that the chat can only ever read this business's own data.
  chat_slug       text        not null unique,
  chat_enabled    boolean     not null default true,
  chat_greeting   text        not null default 'Hi! How can I help you today?',
  chat_accent     text        not null default 'indigo',

  owner_name      text        not null default '',
  owner_phone     text,
  owner_email     text,
  -- Free-text instructions the owner gives their AI workforce.
  agent_persona   text        not null default '',
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists businesses_chat_slug_idx on public.businesses (chat_slug);

-- ------------------------------------------------------------ business users
-- Links a Supabase Auth user to a business. Drives row level security.
create table if not exists public.business_members (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null,               -- references auth.users(id)
  role        text not null default 'owner' check (role in ('owner','manager','staff')),
  created_at  timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists business_members_user_idx on public.business_members (user_id);

-- ------------------------------------------------------- agent subscriptions
-- Which agents a business pays for. The billing gate AND the access gate.
create table if not exists public.agent_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  agent_key    text not null,               -- 'customer_support', 'booking', ...
  is_active    boolean not null default true,
  activated_at timestamptz not null default now(),
  settings     jsonb not null default '{}'::jsonb,
  unique (business_id, agent_key)
);

-- ----------------------------------------------------------------- customers
-- A chat visitor is ANONYMOUS until they choose to leave details, so every
-- identifying column is nullable. This is the main schema difference from a
-- phone channel, where the number identifies you before you say a word.
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text,
  phone        text,          -- E.164 when present: +919876543210
  email        text,
  notes        text not null default '',
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists customers_business_idx on public.customers (business_id);
-- Partial unique indexes: a phone or email may repeat across businesses, never
-- inside one. NULLs are simply not indexed, so many anonymous rows are fine.
create unique index if not exists customers_business_phone_uidx
  on public.customers (business_id, phone) where phone is not null;
create unique index if not exists customers_business_email_uidx
  on public.customers (business_id, email) where email is not null;

-- ------------------------------------------------------------ what you sell
create table if not exists public.business_services (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  name             text not null,
  description      text not null default '',
  duration_minutes int  not null default 30,
  price            numeric(12,2) not null default 0,
  price_note       text not null default '',   -- 'per month', 'from', 'per session'
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists business_services_business_idx
  on public.business_services (business_id);

-- -------------------------------------------------- what the agent may say
-- The knowledge base. The owner controls it from the dashboard, and it is the
-- ONLY source the agent is allowed to answer policy questions from.
create table if not exists public.knowledge_articles (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title       text not null,              -- usually the customer's question
  body        text not null,              -- the approved answer
  tags        text[] not null default '{}',
  is_active   boolean not null default true,
  -- Filled in a later phase, when semantic search replaces keyword search.
  embedding   vector(384),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A generated column: Postgres keeps this in sync automatically on every
-- insert and update. Nothing in Python ever has to remember to refresh it.
alter table public.knowledge_articles
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(body, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  ) stored;

create index if not exists knowledge_search_idx
  on public.knowledge_articles using gin (search_vector);
create index if not exists knowledge_business_idx
  on public.knowledge_articles (business_id);

-- ------------------------------------------------------------- conversations
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  -- NULL until the visitor gives us a name or number.
  customer_id          uuid references public.customers (id) on delete set null,
  channel              channel_kind not null default 'web',
  status               text not null default 'open' check (status in ('open','closed')),
  -- True when a human has taken over; the agent then stays silent.
  human_takeover       boolean not null default false,
  -- A display label before we know who they are: "Visitor 4821".
  visitor_label        text not null default '',
  last_message_at      timestamptz not null default now(),
  last_message_preview text not null default '',
  message_count        int  not null default 0,
  created_at           timestamptz not null default now()
);

create index if not exists conversations_business_recent_idx
  on public.conversations (business_id, last_message_at desc);

-- ---------------------------------------------------------------- messages
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction       message_direction not null,
  author          message_author    not null,
  body            text not null default '',
  -- Extras: which tools ran, how long it took, whether it came from voice.
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at asc);

-- ------------------------------------------------------------ chat sessions
-- One row per browser tab that opens the chat link. This is how an anonymous
-- visitor keeps their conversation across a page reload without an account.
create table if not exists public.chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- SHA-256 of the token. The raw token exists only in the visitor's browser,
  -- so a database leak cannot be used to resume anyone's chat.
  token_hash      text not null unique,
  -- SHA-256 of the IP. Enough to rate limit and spot abuse, not enough to
  -- track a person. Keeps this side of the product honest.
  ip_hash         text,
  user_agent      text,
  message_count   int  not null default 0,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days')
);

create index if not exists chat_sessions_token_idx on public.chat_sessions (token_hash);
create index if not exists chat_sessions_expiry_idx on public.chat_sessions (expires_at);

-- --------------------------------------------------------- support requests
-- What the agent hands to a human: it could not answer, or the customer asked
-- for a callback. This is the Customer Support Agent's approval gate.
create table if not exists public.support_requests (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  customer_id     uuid references public.customers (id) on delete set null,
  kind            support_kind  not null default 'escalation',
  status          support_state not null default 'open',
  -- What the agent understood, so the owner does not read the whole thread.
  reason          text not null default '',
  summary         text not null default '',
  -- Contact details captured in the chat, if any.
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text not null default '',
  created_at      timestamptz not null default now()
);

create index if not exists support_requests_business_status_idx
  on public.support_requests (business_id, status, created_at desc);

-- ------------------------------------------------------------- agent logs
-- Every LLM run. Today: debugging and an audit trail.
-- Later: the corrections that make the agent self-improving.
create table if not exists public.agent_logs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  agent_key       text not null,
  model           text not null default '',
  input_text      text not null default '',
  output_text     text not null default '',
  tool_calls      jsonb not null default '[]'::jsonb,
  latency_ms      int  not null default 0,
  status          text not null default 'ok' check (status in ('ok','error')),
  error           text,
  -- Owner feedback from the dashboard: null | 'up' | 'down'
  feedback        text check (feedback in ('up','down')),
  correction      text,
  correction_embedding vector(384),
  created_at      timestamptz not null default now()
);

create index if not exists agent_logs_business_idx
  on public.agent_logs (business_id, created_at desc);

-- ============================================================================
-- Knowledge search
--
-- Keyword search using Postgres full text search. Free, instant, no embedding
-- model needed. When you move to semantic search later, only the BODY of this
-- function changes — the agent's tool keeps calling search_knowledge().
-- ============================================================================
create or replace function public.search_knowledge(
  p_business_id uuid,
  p_query       text,
  p_limit       int default 5
)
returns table (id uuid, title text, body text, rank real)
language sql
stable
as $$
  select a.id,
         a.title,
         a.body,
         ts_rank(a.search_vector, websearch_to_tsquery('english', p_query)) as rank
  from public.knowledge_articles a
  where a.business_id = p_business_id
    and a.is_active
    and a.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc, a.created_at
  limit greatest(1, least(p_limit, 20));
$$;

-- ============================================================================
-- Row Level Security
--
-- The FastAPI backend uses the service_role key and BYPASSES all of this; it
-- enforces isolation in code by always filtering on business_id. These policies
-- protect the other path: anything reaching Postgres with a real user's JWT
-- (the owner's browser, a future mobile app). Defence in depth.
-- ============================================================================

-- SECURITY DEFINER so the policy on business_members does not recurse into itself.
create or replace function public.is_business_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target and m.user_id = auth.uid()
  );
$$;

alter table public.businesses          enable row level security;
alter table public.business_members    enable row level security;
alter table public.agent_subscriptions enable row level security;
alter table public.customers           enable row level security;
alter table public.business_services   enable row level security;
alter table public.knowledge_articles  enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.chat_sessions       enable row level security;
alter table public.support_requests    enable row level security;
alter table public.agent_logs          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'agent_subscriptions','customers','business_services','knowledge_articles',
    'conversations','messages','chat_sessions','support_requests','agent_logs'
  ] loop
    execute format($f$
      drop policy if exists %1$s_member_access on public.%1$s;
      create policy %1$s_member_access on public.%1$s
        for all
        using (public.is_business_member(business_id))
        with check (public.is_business_member(business_id));
    $f$, t);
  end loop;
end $$;

drop policy if exists businesses_member_access on public.businesses;
create policy businesses_member_access on public.businesses
  for all
  using (public.is_business_member(id))
  with check (public.is_business_member(id));

drop policy if exists business_members_self_access on public.business_members;
create policy business_members_self_access on public.business_members
  for select
  using (user_id = auth.uid());

-- ------------------------------------------------------------ updated_at bump
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();

drop trigger if exists knowledge_touch on public.knowledge_articles;
create trigger knowledge_touch before update on public.knowledge_articles
  for each row execute function public.touch_updated_at();
```

### Explain the code

Only the parts that are not obvious.

```sql
chat_slug text not null unique
```
The public identity of the channel. The URL is `/chat/glow-salon`, and that
slug is the **only** thing the chat API needs to know which business it is
serving. It is designed to be shared — printed on a poster, put in an Instagram
bio — so it must be readable, not secret. Security does not come from hiding it;
it comes from the fact that a chat session can only ever read the one business
it was opened against.

```sql
customer_id uuid references public.customers (id) on delete set null
```
Nullable, and this is the single biggest schema difference from a phone channel.
On WhatsApp the number identifies someone before they say a word. On the web a
visitor is genuinely anonymous until they choose to give you something. The
conversation exists first; a customer row appears later, if at all.

```sql
create unique index ... on public.customers (business_id, phone) where phone is not null;
```
A **partial** unique index. A plain `unique (business_id, phone)` would work too
— Postgres treats NULLs as distinct — but being explicit documents the intent:
one row per real phone number per business, and as many anonymous rows as you
like.

```sql
add column ... search_vector tsvector generated always as (to_tsvector(...)) stored
```
A **generated column**. Postgres recomputes it on every insert and update, so
your Python never has to remember to keep the search index fresh. `stored` means
it is written to disk (rather than computed on read), which is what makes the
GIN index below possible.

`to_tsvector('english', ...)` turns text into searchable word stems:
`"What are your membership fees?"` becomes `'fee':5 'membership':4`. That is why
a search for "fees" finds an article titled "monthly fee".

```sql
create index ... using gin (search_vector);
```
GIN — Generalised Inverted Index — is the index type built for "which rows
contain this word". Without it, every knowledge search scans every article. With
ten articles you would never notice; with two thousand you would.

```sql
websearch_to_tsquery('english', p_query)
```
Parses a query the way a search box should: `membership fee` means both words,
`"three month"` in quotes means that phrase, `-trial` excludes. The older
`plainto_tsquery` does not understand any of that, and `to_tsquery` throws a
syntax error on ordinary human input — which is exactly what an LLM will pass
you.

```sql
limit greatest(1, least(p_limit, 20))
```
Clamping inside the function. The LLM chooses the arguments to this search, and
a model that decides to ask for 10,000 rows should get 20. Never trust a
parameter that originated in a language model.

```sql
token_hash text not null unique
```
We store the **hash** of the session token, never the token. The raw value lives
only in the visitor's browser. If the database leaked, an attacker still could
not resume anyone's conversation — the same reason you never store a password.

```sql
ip_hash text
```
Hashed, not raw. It is enough to rate-limit and to notice one address opening
four hundred sessions, and not enough to track a person across the internet.
Anonymous chat means anonymous.

```sql
expires_at timestamptz not null default (now() + interval '7 days')
```
Sessions die. Without an expiry, `chat_sessions` grows forever and an old token
in someone's laptop works a year later.

```sql
create type support_kind as enum ('escalation', 'callback');
```
Two ways a human gets involved: the agent could not answer (escalation), or the
customer asked to be contacted (callback). One table, because the owner works
through them in one list.

```sql
security definer
```
The function runs with its creator's permissions, not the caller's. Without it,
checking "is this user a member?" would query `business_members`, which has its
own RLS policy, which would query `business_members`… infinite recursion. This
is the standard Supabase pattern.

```sql
using (...)       -- which existing rows you may SEE
with check (...)  -- which new rows you may WRITE
```
You need both. `using` alone would let a member insert rows into someone else's
business.

### Commands

1. Supabase dashboard → **SQL Editor** (left sidebar) → **New query**
2. Paste the whole file
3. **Run** (or `Ctrl+Enter`)

### How to test

Check the tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Check RLS is on everywhere:

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;
```

Check the search function exists:

```sql
select proname from pg_proc where proname = 'search_knowledge';
```

### Expected result

The first query returns exactly these 11 rows:

```
agent_logs
agent_subscriptions
business_members
business_services
businesses
chat_sessions
conversations
customers
knowledge_articles
messages
support_requests
```

The second shows `relrowsecurity = true` for all 11. The third returns one row.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `extension "vector" is not available` | pgvector not enabled | Dashboard → **Database → Extensions** → search `vector` → toggle on → re-run. |
| `generation expression is not immutable` | `to_tsvector` called without the `'english'` argument | The one-argument form depends on a session setting, so Postgres refuses. Keep `'english'` in there. |
| `type "channel_kind" already exists` | You ran the file twice | Harmless — the `do $$ ... exception` blocks swallow it. |
| `syntax error at or near "$f$"` | Your editor mangled the dollar-quoting when pasting | Paste into a plain text editor first, then into Supabase. Never from a rich-text app. |
| `function websearch_to_tsquery does not exist` | PostgreSQL older than 11 | Not possible on Supabase. If you see this you are on another database. |
| `permission denied for schema public` | Running as a limited role | Use the dashboard SQL Editor, not an external client. |

---

## STEP 4 — Seed a demo business

### Goal

Put a realistic gym into the database — services with prices, a knowledge base,
opening hours — so the agent has real things to say from its first message.

### Why?

An agent with an empty database can only say "I don't know", and you cannot tell
whether your tool-calling code works if there is nothing for the tools to find.
Seed data turns every later test into a real test.

We use a **gym** rather than a salon because a membership business asks the
hardest support questions: tiered pricing, freezing, trials, timings, transfer
rules. If the agent handles those, it handles a salon easily.

### Files involved

```
database/
├── migrations/
│   └── 001_customer_support_agent.sql
└── seed.sql                              ← create this file
```

### Code

Create `database/seed.sql`:

```sql
-- ============================================================================
-- seed.sql — demo data for local development.
-- Safe to re-run: it deletes the demo business first, then recreates it.
-- NEVER run this against a production project.
-- ============================================================================

-- A fixed UUID so scripts and .env can point at it directly.
delete from public.businesses where id = 'a1b2c3d4-0000-4000-8000-000000000001';

insert into public.businesses
  (id, name, slug, business_type, description, location, timezone, currency,
   hours, chat_slug, chat_greeting, chat_accent,
   owner_name, owner_phone, owner_email, agent_persona)
values (
  'a1b2c3d4-0000-4000-8000-000000000001',
  'Pulse Fitness Studio',
  'pulse-fitness',
  'gym',
  'A neighbourhood gym and fitness studio offering strength training, cardio, '
  'group classes and personal training, with certified trainers and separate '
  'timings for women.',
  'Gachibowli, Hyderabad',
  'Asia/Kolkata',
  'INR',
  '[{"day":0,"open":"07:00","close":"13:00","closed":false},
    {"day":1,"open":"05:30","close":"22:00","closed":false},
    {"day":2,"open":"05:30","close":"22:00","closed":false},
    {"day":3,"open":"05:30","close":"22:00","closed":false},
    {"day":4,"open":"05:30","close":"22:00","closed":false},
    {"day":5,"open":"05:30","close":"22:00","closed":false},
    {"day":6,"open":"06:00","close":"20:00","closed":false}]'::jsonb,
  'pulse-fitness',
  'Hi! I''m the Pulse Fitness assistant. Ask me about memberships, timings, '
  'classes or trainers.',
  'indigo',
  'Rahul Verma',
  '+919999999999',          -- CHANGE to your number if you want owner alerts
  'owner@pulsefitness.example',
  'Be warm, brief and encouraging. Use simple English. Never promise a discount '
  'or waive a fee — say you will have someone from the team confirm. Never give '
  'medical, injury or diet advice; hand those to a human trainer.'
);

-- ------------------------------------------------------------ agent access
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
values
  ('a1b2c3d4-0000-4000-8000-000000000001', 'customer_support', true,
   '{"allow_callbacks": true, "max_steps": 6}'::jsonb),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'booking', false, '{}'::jsonb),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'payment', false, '{}'::jsonb);

-- ---------------------------------------------------------------- services
insert into public.business_services
  (business_id, name, description, duration_minutes, price, price_note, sort_order)
values
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Monthly Membership',
   'Full gym access, all equipment, open gym hours.', 0, 1800, 'per month', 1),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Quarterly Membership',
   'Three months of full gym access. Works out cheaper than monthly.', 0, 4800, 'for 3 months', 2),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Annual Membership',
   'Twelve months of full access, includes one free month freeze.', 0, 15000, 'per year', 3),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Personal Training',
   'One-on-one sessions with a certified trainer, booked in packs of 12.', 60, 9000, 'for 12 sessions', 4),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Group Classes Add-on',
   'Unlimited Zumba, HIIT and yoga classes on top of any membership.', 45, 800, 'per month', 5),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Day Pass',
   'Single day access for visitors.', 0, 250, 'per day', 6);

-- ------------------------------------------------------------ knowledge base
insert into public.knowledge_articles (business_id, title, body, tags) values
  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Is there a free trial?',
   'Yes. First-time visitors get one free trial session. Just walk in with a photo ID and ask at the front desk. The trial does not include personal training or group classes.',
   '{trial,free,new}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Can I freeze or pause my membership?',
   'Quarterly and annual members can freeze their membership for up to 30 days in a year, in blocks of at least 7 days. Monthly memberships cannot be frozen. Freeze requests must be made at the front desk before the pause starts, not afterwards.',
   '{freeze,pause,hold,membership}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Are there separate timings for women?',
   'Yes. The studio floor is reserved for women from 11 AM to 1 PM, Monday to Saturday. Outside those hours the gym is mixed. Women trainers are available on request.',
   '{women,ladies,timings,safety}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What are the group class timings?',
   'Zumba runs Monday, Wednesday and Friday at 7 PM. HIIT runs Tuesday and Thursday at 6:30 PM. Yoga runs Saturday and Sunday at 8 AM. Classes need the Group Classes add-on and a spot reserved at the front desk on the day.',
   '{classes,zumba,hiit,yoga,timings}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Do you have parking?',
   'Yes, free two-wheeler and four-wheeler parking in the basement, accessible from the rear gate on the service road.',
   '{parking,location,directions}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What payment methods do you accept?',
   'Cash, all UPI apps, credit and debit cards. Annual memberships can be split into three instalments — ask the front desk to set that up.',
   '{payment,upi,card,instalment}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Can I transfer my membership to someone else?',
   'Memberships are personal and cannot be transferred. Annual members may transfer once to an immediate family member, with proof of relationship and a one-time 500 rupee fee.',
   '{transfer,membership,rules}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Is there a refund if I cancel?',
   'Memberships are non-refundable once activated. If you cancel within 3 days of joining and have used the gym at most twice, the manager can approve a partial refund. This always needs manager approval.',
   '{refund,cancel,money}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What should I bring on my first day?',
   'Comfortable workout clothes, non-marking sports shoes, a towel and a water bottle. Lockers are free but bring your own lock. A photo ID is needed for registration.',
   '{first,new,joining,what to bring}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Do you have certified trainers?',
   'Yes. All floor trainers hold either an ACE or a K11 certification, and two of our personal trainers are also certified in sports nutrition.',
   '{trainers,certification,personal training}');

-- --------------------------------------------------------------- confirm it
select
  (select count(*) from public.businesses)          as businesses,
  (select count(*) from public.business_services)   as services,
  (select count(*) from public.knowledge_articles)  as articles,
  (select count(*) from public.agent_subscriptions) as subscriptions;
```

### Explain the code

```sql
delete from public.businesses where id = 'a1b2c3d4-...';
```
Because of `on delete cascade` on every child table, this one line wipes the
whole demo business — services, knowledge, conversations, everything — which is
what makes the file safe to re-run while you iterate.

```sql
values ('a1b2c3d4-0000-4000-8000-000000000001', ...)
```
We hardcode the UUID rather than letting Postgres generate one, so scripts can
reference it without you copying a new value after every reseed.

```sql
'Hi! I''m the Pulse Fitness assistant. ...'
```
Two single quotes escape one apostrophe in SQL. `I'm` written naively would end
the string early and produce a baffling syntax error.

```sql
'[{"day":0,"open":"07:00", ...}]'::jsonb
```
Opening hours as JSON in one column. A separate `business_hours` table would be
more "correct" relationally, but hours are always read as a whole block and never
queried individually, so JSON is simpler and faster. `::jsonb` casts text to
Postgres's binary JSON type.

```sql
'Never give medical, injury or diet advice; hand those to a human trainer.'
```
The persona is not decoration. A gym assistant will be asked "I have knee pain,
which machine should I use?" — and an LLM will happily answer. Writing the limit
into the business's own persona field means each business sets its own
boundaries without you changing code.

```sql
('... ', 'booking', false, '{}'::jsonb),
('... ', 'payment', false, '{}'::jsonb);
```
The next two agents are seeded as **inactive**. That gives you something real to
test the subscription gate against: the support agent runs, the booking agent
does not, because this business has not paid for it. That single boolean is your
per-agent pricing model.

```sql
'Memberships are non-refundable once activated. ... This always needs manager approval.'
```
Notice the knowledge deliberately includes rules the agent must *not* decide by
itself. The refund article tells the agent the policy and tells it to escalate —
which is exactly the behaviour you will test in STEP 13.

### Commands

**Before running, optionally change one thing:** `owner_phone` to your own
number, if you want owner notifications later.

Then: Supabase → **SQL Editor** → **New query** → paste → **Run**.

### How to test

The file ends with its own check. Also test that full-text search actually works
— this is the query the agent's main tool will run:

```sql
select title, rank from public.search_knowledge(
  'a1b2c3d4-0000-4000-8000-000000000001',
  'can I pause my membership',
  5
);
```

And a harder one, where the words do not match the title at all:

```sql
select title, rank from public.search_knowledge(
  'a1b2c3d4-0000-4000-8000-000000000001',
  'ladies only timing',
  5
);
```

### Expected result

The count query:

```
businesses | services | articles | subscriptions
-----------+----------+----------+--------------
         1 |        6 |       10 |             3
```

The first search returns **Can I freeze or pause my membership?** at the top —
note it matched on "pause" even though the customer's phrasing was different.

The second returns **Are there separate timings for women?**, because
`to_tsvector` stemmed "timing" to match "timings" and "ladies" is in the tags.

If both searches return rows, your knowledge base works and the agent's most
important tool will work.

### Common errors

| Error | Meaning | Fix |
| --- | --- | --- |
| `syntax error at or near "m"` | An unescaped apostrophe | Double it: `I''m`, not `I'm`. |
| `invalid input syntax for type uuid` | A character mangled in the hardcoded UUID | Must be exactly 8-4-4-4-12 hex characters. |
| `search_knowledge` returns nothing at all | The query was only stopwords, e.g. "what is the" | Expected — `websearch_to_tsquery` strips those. The tool in STEP 11 falls back to a plain text search for this case. |
| `function public.search_knowledge(...) does not exist` | Migration not fully applied | Re-run `001_customer_support_agent.sql`. |
| `column "search_vector" does not exist` | The `alter table ... add column` block did not run | Re-run the migration from that block down. |
| `new row violates row-level security policy` | Running as an authenticated user | Use the dashboard SQL Editor, which runs as `postgres`. |

---

## End of Part 1 — checklist

- [ ] `database/migrations/001_customer_support_agent.sql` exists in the repo
- [ ] `database/seed.sql` exists in the repo
- [ ] 11 tables visible in the Supabase Table Editor
- [ ] RLS shows `true` for all 11
- [ ] The seed count query returns `1 | 6 | 10 | 3`
- [ ] Both `search_knowledge` test queries return sensible rows

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\Akshaya\yashwanth"
git add database docs/guides
git commit -m "Add customer support agent schema and demo seed data"
```

Next: [02-fastapi-foundation.md](02-fastapi-foundation.md).

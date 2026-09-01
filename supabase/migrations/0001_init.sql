-- Quinta Lead Hub — initial schema
--
-- SECURITY MODEL, and why this file looks paranoid:
--
-- The app has no sign-in. Anyone with the URL can use it, and the browser holds
-- the anon key. So the anon role is treated as hostile:
--
--   * RLS is enabled on every table.
--   * There is NO write policy for anon anywhere. All writes go through route
--     handlers using the service-role key, which bypasses RLS.
--   * anon gets SELECT on exactly two tables, `channels` and `messages`, and
--     only because the Realtime chat subscription reads them from the browser.
--     Every other table — including `leads`, which holds prospect contact
--     details — is unreadable with the anon key.
--
-- Adding a table without an accompanying RLS statement is a review finding.

-- Enums -----------------------------------------------------------------------
-- Enums rather than check constraints, so the app's TypeScript unions and the
-- database agree on one list and a typo fails loudly at insert time.

create type person_role     as enum ('sales', 'consultant', 'admin');
create type lead_direction  as enum ('for_sales', 'for_consultant');
create type lead_status     as enum ('new', 'claimed', 'in_progress', 'won', 'lost');
create type lead_priority   as enum ('low', 'normal', 'high');
create type lead_event_type as enum ('created', 'status_changed', 'assigned', 'hubspot_synced', 'note');

-- People ----------------------------------------------------------------------
-- The roster. Not auth users: a row here is a label someone picks from a
-- dropdown, never a credential.

create table public.people (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(trim(name)) between 1 and 160),
  email      text        not null unique check (position('@' in email) > 1),
  role       person_role not null,
  territory  text        check (territory is null or length(territory) <= 16),
  initials   text        not null check (length(initials) between 1 and 3),
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create index people_active_role_idx on public.people (active, role);

-- Leads -----------------------------------------------------------------------
-- One table serves both directions of the board; `direction` says who the lead
-- is *for*. Contact columns hold third-party personal data, so nothing here is
-- readable with the anon key.

create table public.leads (
  id               uuid           primary key default gen_random_uuid(),
  created_at       timestamptz    not null default now(),
  created_by       uuid           not null references public.people (id) on delete restrict,
  direction        lead_direction not null,

  hotel_name       text           not null check (length(trim(hotel_name)) between 2 and 200),
  website          text           check (website is null or length(website) <= 300),
  city             text           check (city is null or length(city) <= 120),
  country          text           check (country is null or length(country) <= 120),
  rooms            integer        check (rooms is null or (rooms > 0 and rooms <= 20000)),

  contact_name     text           check (contact_name is null or length(contact_name) <= 160),
  contact_email    text           check (contact_email is null or length(contact_email) <= 200),
  contact_phone    text           check (contact_phone is null or length(contact_phone) <= 60),

  product_interest text           check (product_interest is null or length(product_interest) <= 80),
  context          text           check (context is null or length(context) <= 4000),
  priority         lead_priority  not null default 'normal',

  status           lead_status    not null default 'new',
  -- set null, not restrict: deactivating someone must not block their leads.
  assigned_to      uuid           references public.people (id) on delete set null,

  hubspot_contact_id text,
  hubspot_company_id text,
  hubspot_deal_id    text,
  hubspot_synced_at  timestamptz,
  hubspot_sync_error text
);

create index leads_board_idx      on public.leads (status, direction, created_at desc);
create index leads_assigned_idx   on public.leads (assigned_to) where assigned_to is not null;
create index leads_created_at_idx on public.leads (created_at desc);
-- Supports the HubSpot dedupe lookup by email.
create index leads_contact_email_idx on public.leads (lower(contact_email)) where contact_email is not null;

-- Lead history ----------------------------------------------------------------
-- Append-only. Renders as the timeline on the lead detail page.

create table public.lead_events (
  id          uuid            primary key default gen_random_uuid(),
  lead_id     uuid            not null references public.leads (id) on delete cascade,
  -- nullable: system events such as a HubSpot sync have no human actor.
  actor_id    uuid            references public.people (id) on delete set null,
  type        lead_event_type not null,
  from_status lead_status,
  to_status   lead_status,
  note        text            check (note is null or length(note) <= 2000),
  created_at  timestamptz     not null default now()
);

create index lead_events_lead_idx on public.lead_events (lead_id, created_at);

create table public.lead_comments (
  id         uuid        primary key default gen_random_uuid(),
  lead_id    uuid        not null references public.leads (id) on delete cascade,
  author_id  uuid        not null references public.people (id) on delete restrict,
  body       text        not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index lead_comments_lead_idx on public.lead_comments (lead_id, created_at);

-- Chat ------------------------------------------------------------------------

create table public.channels (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) between 1 and 80),
  slug        text        not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  description text        check (description is null or length(description) <= 300),
  created_at  timestamptz not null default now()
);

create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  channel_id uuid        not null references public.channels (id) on delete cascade,
  author_id  uuid        not null references public.people (id) on delete restrict,
  body       text        not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index messages_channel_idx on public.messages (channel_id, created_at);

-- News ------------------------------------------------------------------------

create table public.news (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null check (length(trim(title)) between 1 and 200),
  slug         text        not null unique check (slug ~ '^[a-z0-9-]{1,120}$'),
  excerpt      text        check (excerpt is null or length(excerpt) <= 400),
  body         text        not null,
  category     text        check (category is null or length(category) <= 40),
  author_id    uuid        references public.people (id) on delete set null,
  published_at timestamptz not null default now(),
  pinned       boolean     not null default false
);

create index news_published_idx on public.news (pinned desc, published_at desc);

-- Row level security ----------------------------------------------------------
-- Enabled everywhere. With RLS on and no policy granting a given action, that
-- action is denied for anon and authenticated. service_role bypasses RLS, which
-- is how the route handlers write.

alter table public.people        enable row level security;
alter table public.leads         enable row level security;
alter table public.lead_events   enable row level security;
alter table public.lead_comments enable row level security;
alter table public.channels      enable row level security;
alter table public.messages      enable row level security;
alter table public.news          enable row level security;

-- Also refuse the postgres table owner an implicit bypass, so a future
-- owner-context connection cannot silently read around these policies.
alter table public.people        force row level security;
alter table public.leads         force row level security;
alter table public.lead_events   force row level security;
alter table public.lead_comments force row level security;
alter table public.channels      force row level security;
alter table public.messages      force row level security;
alter table public.news          force row level security;

-- The only two anon grants in the schema. Both SELECT, both needed by the
-- browser's Realtime chat subscription.
create policy "anon reads channels"
  on public.channels for select to anon using (true);

create policy "anon reads messages"
  on public.messages for select to anon using (true);

-- Realtime --------------------------------------------------------------------
-- Chat updates are pushed to the browser from `messages` only. Realtime honours
-- RLS, so the SELECT policy above is what makes this readable.

alter publication supabase_realtime add table public.messages;

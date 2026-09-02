-- Direct messages, and @mentions in channel messages.

-- Direct messages ------------------------------------------------------------
--
-- READ THIS BEFORE ADDING A POLICY HERE.
--
-- This table has RLS enabled and *deliberately no policies at all*, which means
-- the anon key cannot read or write a single row. That is the entire security
-- boundary for direct messages.
--
-- `public.messages` carries an anon SELECT policy because the browser's Realtime
-- subscription needs it. Anyone can read the anon key out of the JavaScript
-- bundle, so a policy like that makes a table world-readable through the REST
-- API without even opening the app. Putting direct messages in `messages`, or
-- granting anon SELECT here so Realtime could work, would publish every private
-- conversation to anyone who found the URL.
--
-- So reads happen server-side under the service-role key, and the UI polls.
-- Losing live delivery is the price of not publishing the contents, and it is
-- worth paying.
--
-- What this does NOT protect against: the app has no sign-in, so identity is a
-- name chosen from a dropdown. Anyone using the app can select someone else and
-- read their messages. The UI says so. Genuine confidentiality needs
-- authentication, at which point these policies should be rewritten around
-- auth.uid().

create table public.direct_messages (
  id           uuid        primary key default gen_random_uuid(),
  sender_id    uuid        not null references public.people (id) on delete cascade,
  recipient_id uuid        not null references public.people (id) on delete cascade,
  body         text        not null check (length(trim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),

  -- A conversation with yourself is not a feature.
  constraint direct_messages_distinct_parties check (sender_id <> recipient_id)
);

/*
 * A thread is identified by the unordered pair of participants, so the index
 * normalises the pair. Without this, fetching a conversation means an OR across
 * both directions and cannot use an index efficiently.
 */
create index direct_messages_pair_idx on public.direct_messages (
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at
);

-- Supports "conversations involving me", used to build the sidebar.
create index direct_messages_sender_idx    on public.direct_messages (sender_id, created_at desc);
create index direct_messages_recipient_idx on public.direct_messages (recipient_id, created_at desc);

alter table public.direct_messages enable row level security;
alter table public.direct_messages force  row level security;

-- No policies. Intentional. See the comment at the top of this section.

-- Mentions -------------------------------------------------------------------
--
-- Denormalised list of mentioned people, recorded when a message is sent.
-- Highlighting could be done by matching names in the text, but that breaks on
-- people whose names are substrings of others, and on renames. Storing the ids
-- makes "was I mentioned" exact.
--
-- No FK is possible on an array element. A person removed from the roster leaves
-- a stale id here, which renders as plain text rather than a highlight — an
-- acceptable outcome for a display hint.

alter table public.messages
  add column mentions uuid[] not null default '{}';

-- Finds "messages mentioning me" without scanning.
create index messages_mentions_idx on public.messages using gin (mentions);

-- Notifications: what drives the bell and its unread count.

-- Why a table rather than a "last seen" timestamp on `people`:
--
-- A single timestamp can only express "everything before now is read", so
-- opening one direct message would silently clear an unrelated mention. A row
-- per notification lets the count be exact and lets one item be dismissed
-- without touching the others.
--
-- SECURITY: RLS enabled with NO policies, same as `direct_messages`. A row here
-- reveals that a direct message exists and who it is between, and the preview
-- column carries message text. The anon key ships in the browser bundle, so any
-- anon policy would publish all of that through the REST API. Reads and writes
-- happen server-side under the service-role key, and the API resolves "whose
-- notifications" from the identity cookie rather than a query parameter, so the
-- endpoint cannot be pointed at someone else by editing a URL.

create type notification_kind as enum ('mention', 'direct_message');

create table public.notifications (
  id         uuid              primary key default gen_random_uuid(),
  -- Who should see the bell light up.
  person_id  uuid              not null references public.people (id) on delete cascade,
  kind       notification_kind not null,
  -- Who caused it. Nullable so removing someone does not delete history.
  actor_id   uuid              references public.people (id) on delete set null,

  /*
   * The row that caused this. Not a foreign key: it points at `messages` for a
   * mention and `direct_messages` for a DM, and one column cannot reference two
   * tables. Cleanup on source deletion is handled in the store.
   */
  source_id  uuid              not null,
  /* Where the bell should navigate to. Built at write time so rendering the
   * dropdown needs no extra lookups. */
  href       text              not null check (length(href) between 1 and 300),
  /* Short excerpt for the dropdown, so it does not have to read the source. */
  preview    text              check (preview is null or length(preview) <= 200),

  created_at timestamptz       not null default now(),
  read_at    timestamptz
);

-- The bell's query: my unread notifications, newest first.
create index notifications_unread_idx
  on public.notifications (person_id, created_at desc)
  where read_at is null;

-- Full history for a person, read or not.
create index notifications_person_idx
  on public.notifications (person_id, created_at desc);

-- Used to clear notifications when their source row is deleted.
create index notifications_source_idx on public.notifications (source_id);

alter table public.notifications enable row level security;
alter table public.notifications force  row level security;

-- No policies. Intentional. See the comment at the top of this file.

-- Sign-in: credentials, sessions, login throttling, and admin-managed accounts.
--
-- Additive only. Nothing here changes what the currently deployed app can do,
-- so this can be applied before the code that uses it ships. The anonymous
-- chat policies are removed separately in 0008, once the new code is live.
--
-- SECURITY MODEL
--
-- * Every table below has RLS enabled and forced, NO policies, and its grants
--   to anon/authenticated revoked. Only the server, under the service-role key,
--   can read or write them. A password hash or a session token hash reaching
--   the publishable key would be a breach, so this is belt and braces.
--
-- * Admin operations are Postgres functions, not sequences of REST calls, so
--   each one is a single transaction. They serialise on one advisory lock and
--   re-check, inside the lock, that the acting person is still an admin and
--   that at least one admin who can sign in remains afterwards. Checking that
--   in the app instead would let two admins demote each other at the same
--   moment and leave nobody able to manage accounts.
--
-- * Functions are SECURITY INVOKER and EXECUTE is revoked from everyone but
--   service_role. Postgres grants EXECUTE to PUBLIC by default and PostgREST
--   exposes every function in `public` as /rest/v1/rpc/<name>, so without the
--   revoke the publishable key could call admin_create_user directly.
--
-- Errors are raised with stable LH_* messages the app maps to responses. They
-- never quote row contents.

-- Tables ----------------------------------------------------------------------

create table public.person_credentials (
  person_id           uuid        primary key references public.people (id) on delete cascade,
  -- Lower-case, so "Akram.Hkiri" and "akram.hkiri" cannot both exist.
  username            text        not null unique
                                  check (username ~ '^[a-z0-9._-]{3,32}$'),
  -- Self-describing scrypt string written by lib/auth/password.ts. Never the
  -- password, and never sent anywhere but the server's own verify step.
  password_hash       text        not null
                                  check (password_hash like 'scrypt$%' and length(password_hash) <= 512),
  password_changed_at timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create table public.sessions (
  id                 uuid        primary key default gen_random_uuid(),
  -- SHA-256 of the cookie value, hex. The token itself is never stored, so a
  -- read of this table does not hand anyone a working session.
  token_hash         text        not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  person_id          uuid        not null references public.people (id) on delete cascade,
  created_at         timestamptz not null default now(),
  -- Absolute limit. Never extended.
  expires_at         timestamptz not null,
  -- Drives the idle limit. Touched on real navigation, not background polling.
  last_seen_at       timestamptz not null default now(),
  -- Last time the password was re-entered. Admin credential changes need it recent.
  reauthenticated_at timestamptz not null default now()
);

create index sessions_person_idx  on public.sessions (person_id);
create index sessions_expires_idx on public.sessions (expires_at);

-- Shared attempt counters, so the limit holds across every app instance rather
-- than per process. Keys are hashed by the app; usernames are not stored raw.
create table public.login_throttle (
  key               text        primary key check (key ~ '^[a-z]+:[0-9a-f]{64}$'),
  attempts          integer     not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now()
);

create index login_throttle_window_idx on public.login_throttle (window_started_at);

-- Who changed whose account, and when. Never passwords or hashes.
create table public.admin_audit (
  id         uuid        primary key default gen_random_uuid(),
  -- Nullable: the bootstrap script acts without a signed-in admin.
  actor_id   uuid        references public.people (id) on delete set null,
  target_id  uuid        references public.people (id) on delete set null,
  action     text        not null check (action in (
               'bootstrap', 'user_created', 'user_updated',
               'credentials_set', 'user_deleted')),
  detail     jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_created_idx on public.admin_audit (created_at desc);

-- Lock-down -------------------------------------------------------------------

alter table public.person_credentials enable row level security;
alter table public.person_credentials force  row level security;
alter table public.sessions           enable row level security;
alter table public.sessions           force  row level security;
alter table public.login_throttle     enable row level security;
alter table public.login_throttle     force  row level security;
alter table public.admin_audit        enable row level security;
alter table public.admin_audit        force  row level security;

-- No policies. Intentional. Grants revoked as well, so even a future mistaken
-- policy would not open these tables to the publishable key.
revoke all on public.person_credentials from anon, authenticated;
revoke all on public.sessions           from anon, authenticated;
revoke all on public.login_throttle     from anon, authenticated;
revoke all on public.admin_audit        from anon, authenticated;

-- Internal checks -------------------------------------------------------------

-- The acting person must be an active admin who can sign in.
create function public.lh_assert_admin(p_actor uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
      from people p
      join person_credentials c on c.person_id = p.id
     where p.id = p_actor and p.active and p.role = 'admin'
  ) then
    raise exception 'LH_NOT_ADMIN';
  end if;
end;
$$;

-- At least one active admin with credentials must remain.
create function public.lh_assert_admins_remain()
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
      from people p
      join person_credentials c on c.person_id = p.id
     where p.active and p.role = 'admin'
  ) then
    raise exception 'LH_LAST_ADMIN';
  end if;
end;
$$;

-- One lock for every account change, held until the transaction ends.
create function public.lh_lock_accounts()
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('leadhub:accounts'));
$$;

-- Admin operations ------------------------------------------------------------

create function public.admin_create_user(
  p_actor         uuid,
  p_name          text,
  p_email         text,
  p_role          person_role,
  p_territory     text,
  p_initials      text,
  p_username      text,
  p_password_hash text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform lh_lock_accounts();
  perform lh_assert_admin(p_actor);

  insert into people (name, email, role, territory, initials)
  values (p_name, p_email, p_role, p_territory, p_initials)
  returning id into v_id;

  insert into person_credentials (person_id, username, password_hash)
  values (v_id, p_username, p_password_hash);

  insert into admin_audit (actor_id, target_id, action)
  values (p_actor, v_id, 'user_created');

  return v_id;
end;
$$;

create function public.admin_update_user(
  p_actor     uuid,
  p_target    uuid,
  p_name      text,
  p_email     text,
  p_role      person_role,
  p_territory text,
  p_initials  text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_old_role person_role;
begin
  perform lh_lock_accounts();
  perform lh_assert_admin(p_actor);

  select role into v_old_role from people where id = p_target and active for update;
  if not found then
    raise exception 'LH_NOT_FOUND';
  end if;

  -- An admin cannot remove their own admin rights.
  if p_target = p_actor and p_role <> 'admin' then
    raise exception 'LH_SELF';
  end if;

  update people
     set name = p_name, email = p_email, role = p_role,
         territory = p_territory, initials = p_initials
   where id = p_target;

  -- A role change takes effect immediately, not at the next sign-in.
  if p_role <> v_old_role then
    delete from sessions where person_id = p_target;
  end if;

  perform lh_assert_admins_remain();

  insert into admin_audit (actor_id, target_id, action, detail)
  values (p_actor, p_target, 'user_updated',
          jsonb_build_object('role_changed', p_role <> v_old_role));
end;
$$;

-- Creates or changes someone's sign-in. Null leaves that part unchanged.
create function public.admin_set_credentials(
  p_actor         uuid,
  p_target        uuid,
  p_username      text,
  p_password_hash text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_has_credentials boolean;
begin
  perform lh_lock_accounts();
  perform lh_assert_admin(p_actor);

  perform 1 from people where id = p_target and active for update;
  if not found then
    raise exception 'LH_NOT_FOUND';
  end if;

  if p_username is null and p_password_hash is null then
    raise exception 'LH_NOTHING_TO_CHANGE';
  end if;

  select exists (select 1 from person_credentials where person_id = p_target)
    into v_has_credentials;

  if v_has_credentials then
    update person_credentials
       set username            = coalesce(p_username, username),
           password_hash       = coalesce(p_password_hash, password_hash),
           password_changed_at = case when p_password_hash is null
                                      then password_changed_at else now() end
     where person_id = p_target;
  else
    -- A first sign-in needs both halves.
    if p_username is null or p_password_hash is null then
      raise exception 'LH_CREDENTIALS_REQUIRED';
    end if;
    insert into person_credentials (person_id, username, password_hash)
    values (p_target, p_username, p_password_hash);
  end if;

  -- New credentials end EVERY existing session, the caller's own included: a
  -- copied cookie must not outlive a password change. An admin changing their
  -- own password is issued a fresh session by the app afterwards.
  delete from sessions where person_id = p_target;

  insert into admin_audit (actor_id, target_id, action, detail)
  values (p_actor, p_target, 'credentials_set',
          jsonb_build_object('username_changed', p_username is not null,
                             'password_changed', p_password_hash is not null));
end;
$$;

-- "Delete" keeps the person so leads, messages and history still have an
-- author, but removes their sign-in and every session, and hides them.
create function public.admin_delete_user(p_actor uuid, p_target uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform lh_lock_accounts();
  perform lh_assert_admin(p_actor);

  if p_target = p_actor then
    raise exception 'LH_SELF';
  end if;

  update people set active = false where id = p_target and active;
  if not found then
    raise exception 'LH_NOT_FOUND';
  end if;

  delete from person_credentials where person_id = p_target;
  delete from sessions           where person_id = p_target;

  perform lh_assert_admins_remain();

  insert into admin_audit (actor_id, target_id, action)
  values (p_actor, p_target, 'user_deleted');
end;
$$;

-- First admin sign-in, set from a terminal by scripts/bootstrap-admin.mjs.
-- Refuses once anyone has credentials, unless forced as a documented
-- break-glass recovery.
create function public.bootstrap_set_credentials(
  p_person        uuid,
  p_username      text,
  p_password_hash text,
  p_force         boolean
)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform lh_lock_accounts();

  perform 1 from people where id = p_person and active and role = 'admin';
  if not found then
    raise exception 'LH_NOT_ADMIN';
  end if;

  if not p_force and exists (select 1 from person_credentials) then
    raise exception 'LH_ALREADY_BOOTSTRAPPED';
  end if;

  insert into person_credentials (person_id, username, password_hash)
  values (p_person, p_username, p_password_hash)
  on conflict (person_id) do update
    set username = excluded.username,
        password_hash = excluded.password_hash,
        password_changed_at = now();

  delete from sessions where person_id = p_person;

  insert into admin_audit (actor_id, target_id, action, detail)
  values (null, p_person, 'bootstrap', jsonb_build_object('forced', p_force));
end;
$$;

-- Login throttling ------------------------------------------------------------

-- Counts one attempt against every key and returns the new counts, in order.
--
-- Called BEFORE the password is checked, and atomic per key: concurrent
-- requests each get their own increment, so a burst cannot all slip under the
-- limit before any of them is recorded. A key whose window has lapsed starts a
-- fresh one. The app decides which counts block.
create function public.auth_throttle_hit(
  p_keys           text[],
  p_window_seconds integer
)
returns integer[]
language plpgsql
set search_path = public
as $$
declare
  v_counts integer[];
begin
  with hit as (
    insert into login_throttle (key, attempts, window_started_at)
    select k, 1, now() from unnest(p_keys) as k
    on conflict (key) do update
      set attempts = case
            when login_throttle.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1 else login_throttle.attempts + 1 end,
          window_started_at = case
            when login_throttle.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now() else login_throttle.window_started_at end
    returning key, attempts
  )
  select array_agg(hit.attempts order by k.ord)
    into v_counts
    from unnest(p_keys) with ordinality as k(key, ord)
    join hit on hit.key = k.key;

  -- Keep the table bounded without a scheduled job.
  delete from login_throttle where window_started_at < now() - interval '1 day';

  return v_counts;
end;
$$;

create function public.auth_throttle_clear(p_keys text[])
returns void
language sql
set search_path = public
as $$
  delete from login_throttle where key = any (p_keys);
$$;

-- Execution rights: service_role only -----------------------------------------

revoke execute on function public.lh_assert_admin(uuid)                    from public, anon, authenticated;
revoke execute on function public.lh_assert_admins_remain()                from public, anon, authenticated;
revoke execute on function public.lh_lock_accounts()                       from public, anon, authenticated;
revoke execute on function public.admin_create_user(uuid, text, text, person_role, text, text, text, text)
                                                                           from public, anon, authenticated;
revoke execute on function public.admin_update_user(uuid, uuid, text, text, person_role, text, text)
                                                                           from public, anon, authenticated;
revoke execute on function public.admin_set_credentials(uuid, uuid, text, text)
                                                                           from public, anon, authenticated;
revoke execute on function public.admin_delete_user(uuid, uuid)            from public, anon, authenticated;
revoke execute on function public.bootstrap_set_credentials(uuid, text, text, boolean)
                                                                           from public, anon, authenticated;
revoke execute on function public.auth_throttle_hit(text[], integer)    from public, anon, authenticated;
revoke execute on function public.auth_throttle_clear(text[])              from public, anon, authenticated;

grant execute on function public.lh_assert_admin(uuid)                     to service_role;
grant execute on function public.lh_assert_admins_remain()                 to service_role;
grant execute on function public.lh_lock_accounts()                        to service_role;
grant execute on function public.admin_create_user(uuid, text, text, person_role, text, text, text, text)
                                                                           to service_role;
grant execute on function public.admin_update_user(uuid, uuid, text, text, person_role, text, text)
                                                                           to service_role;
grant execute on function public.admin_set_credentials(uuid, uuid, text, text)
                                                                           to service_role;
grant execute on function public.admin_delete_user(uuid, uuid)             to service_role;
grant execute on function public.bootstrap_set_credentials(uuid, text, text, boolean)
                                                                           to service_role;
grant execute on function public.auth_throttle_hit(text[], integer)     to service_role;
grant execute on function public.auth_throttle_clear(text[])               to service_role;

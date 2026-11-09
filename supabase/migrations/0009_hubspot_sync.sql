-- HubSpot sync: durable per-lead sync state, maintained atomically with the lead.
--
-- Additive. Safe to apply before the code that uses it ships.
--
-- DESIGN
--
-- * The sync state lives on the lead row itself — one lead is one job. A
--   trigger sets it in the SAME statement that creates or changes the lead, so
--   a lead can never be committed without its "needs syncing" flag. (Setting it
--   from the app afterwards could be lost if the process died in between.)
--
-- * Changes are coalesced by revision. Every relevant change bumps
--   `hubspot_desired_rev`; a worker syncs the CURRENT lead and records the
--   revision it saw. If more changes arrived meanwhile, the lead goes straight
--   back to pending. Stale payloads are never replayed.
--
-- * Workers claim leads with a lease (token + expiry) via SKIP LOCKED, so two
--   workers never process one lead at once, and a crashed worker's lease simply
--   expires and the lead is picked up again. Completion and failure only apply
--   when the caller still holds the lease.
--
-- * HubSpot IDs are saved as soon as each object exists, so a retry resumes
--   instead of recreating. The HubSpot Lead also carries this lead's uuid in
--   the custom property `quinta_lead_hub_id`, which the worker searches before
--   any create — that is what makes a create that timed out safe to retry.
--
-- * Errors are stored as fixed codes only (e.g. `hubspot:auth`), never
--   HubSpot's messages, which quote contact emails and phone numbers.
--
-- States:
--   manual    existed before this migration; sent only when someone asks
--   pending   waiting for a worker
--   running   claimed by a worker (lease)
--   retry     failed, will be retried at hubspot_next_attempt_at
--   synced    HubSpot matches hubspot_synced_rev
--   blocked   cannot be sent as it stands (no contact email)
--   failed    gave up after repeated failures; someone can retry by hand
--
-- One small new table (hubspot_companies), server-only. Functions are
-- service_role only.

alter table public.leads
  add column hubspot_lead_id         text,
  add column hubspot_note_id         text,
  add column hubspot_sync_state      text not null default 'manual'
    check (hubspot_sync_state in ('manual','pending','running','retry','synced','blocked','failed')),
  add column hubspot_desired_rev     integer not null default 0 check (hubspot_desired_rev >= 0),
  add column hubspot_synced_rev      integer not null default 0 check (hubspot_synced_rev >= 0),
  add column hubspot_attempts        integer not null default 0 check (hubspot_attempts >= 0),
  add column hubspot_next_attempt_at timestamptz,
  add column hubspot_lease_token     uuid,
  add column hubspot_lease_until     timestamptz;

-- The error column becomes one of a fixed list of codes — exactly the
-- HubSpotErrorCode union in lib/types.ts; change both together. Anything else
-- (nothing wrote this column before) is cleared so the check can hold.
update public.leads set hubspot_sync_error = null where hubspot_sync_error is not null;
alter table public.leads
  add constraint leads_hubspot_sync_error_code
  check (hubspot_sync_error is null or hubspot_sync_error in (
    'no_contact',
    'not_configured',
    'owner_unmapped',
    'company_busy',
    'hubspot:auth',
    'hubspot:scope',
    'hubspot:validation',
    'hubspot:not_found',
    'hubspot:rate_limited',
    'hubspot:server',
    'hubspot:timeout',
    'hubspot:network',
    'hubspot:unexpected',
    'internal'
  ));

-- Domain → HubSpot company, so two workers syncing two leads of the same new
-- hotel group cannot each create the company. The first to claim a domain
-- creates it; others wait for it and reuse it. RLS forced, no policies,
-- grants revoked: server-only like every other table.
create table public.hubspot_companies (
  domain      text        primary key check (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  company_id  text,
  claim_token uuid,
  claimed_at  timestamptz not null default now(),
  -- A create whose answer was lost: it may exist. From then on, workers only
  -- search for it and never create, so a lost response cannot become a duplicate.
  uncertain   boolean     not null default false
);
alter table public.hubspot_companies enable row level security;
alter table public.hubspot_companies force  row level security;
revoke all on public.hubspot_companies from anon, authenticated;

-- One app lead per HubSpot lead.
create unique index leads_hubspot_lead_id_key
  on public.leads (hubspot_lead_id) where hubspot_lead_id is not null;

-- The worker's queue scan.
create index leads_hubspot_due_idx
  on public.leads (hubspot_next_attempt_at)
  where hubspot_sync_state in ('pending', 'retry', 'running');

-- Trigger: enqueue in the same statement as the change --------------------------

create function public.lh_hubspot_enqueue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A HubSpot Lead must be attached to a contact, and an email is the only
    -- safe way to find an existing one. Without it the lead waits, visibly.
    if new.contact_email is null or length(trim(new.contact_email)) = 0 then
      new.hubspot_sync_state := 'blocked';
      new.hubspot_sync_error := 'no_contact';
    else
      new.hubspot_sync_state := 'pending';
      new.hubspot_sync_error := null;
    end if;
    new.hubspot_desired_rev := 1;
    new.hubspot_next_attempt_at := now();
    return new;
  end if;

  -- UPDATE: only owner and status are synced after creation.
  if new.status is distinct from old.status
     or new.assigned_to is distinct from old.assigned_to then
    new.hubspot_desired_rev := old.hubspot_desired_rev + 1;
    -- Leads that were never sent and are not meant to go automatically stay as
    -- they are; everything else is queued again.
    if old.hubspot_sync_state not in ('manual', 'blocked') then
      if old.hubspot_sync_state <> 'running' then
        new.hubspot_sync_state := 'pending';
        new.hubspot_attempts := 0;
        new.hubspot_next_attempt_at := now();
      end if;
      -- A running worker will notice desired_rev moved on and re-queue.
    end if;
  end if;
  return new;
end;
$$;

create trigger leads_hubspot_enqueue
  before insert or update of status, assigned_to on public.leads
  for each row execute function public.lh_hubspot_enqueue();

-- Worker functions ---------------------------------------------------------------

-- Claims up to p_limit due leads. Returns each with a fresh lease token and the
-- revision being synced. Expired leases (a crashed worker) are reclaimed.
create function public.hubspot_claim(p_limit integer, p_lease_seconds integer)
returns table (lead_id uuid, lease_token uuid, revision integer)
language plpgsql
set search_path = public
as $$
begin
  return query
  with due as (
    select l.id
      from leads l
     where (l.hubspot_sync_state in ('pending', 'retry')
            and coalesce(l.hubspot_next_attempt_at, now()) <= now())
        or (l.hubspot_sync_state = 'running' and l.hubspot_lease_until < now())
     order by l.hubspot_next_attempt_at nulls first
     limit greatest(1, least(p_limit, 20))
     for update skip locked
  )
  update leads l
     set hubspot_sync_state  = 'running',
         hubspot_lease_token = gen_random_uuid(),
         hubspot_lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900)))
    from due
   where l.id = due.id
  returning l.id, l.hubspot_lease_token, l.hubspot_desired_rev;
end;
$$;

-- Asks for a lead to be sent now: a manual first send, or a new round after a
-- final failure. NOT for leads waiting on a scheduled retry — letting anyone
-- reset those would bypass the backoff and the attempt limit. Returns false
-- when there is nothing to do.
create function public.hubspot_request(p_lead uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update leads
     set hubspot_sync_state      = 'pending',
         hubspot_attempts        = 0,
         hubspot_next_attempt_at = now(),
         hubspot_sync_error      = null,
         hubspot_desired_rev     = greatest(hubspot_desired_rev, 1)
   where id = p_lead
     and hubspot_sync_state in ('manual', 'failed');
  return found;
end;
$$;

-- Saves HubSpot IDs as soon as each object exists. Null leaves a value alone.
-- Only while the caller holds the lease.
create function public.hubspot_save_ids(
  p_lead       uuid,
  p_lease      uuid,
  p_contact_id text,
  p_company_id text,
  p_lead_id    text,
  p_note_id    text
)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update leads
     set hubspot_contact_id = coalesce(p_contact_id, hubspot_contact_id),
         hubspot_company_id = coalesce(p_company_id, hubspot_company_id),
         hubspot_lead_id    = coalesce(p_lead_id, hubspot_lead_id),
         hubspot_note_id    = coalesce(p_note_id, hubspot_note_id)
   where id = p_lead and hubspot_lease_token = p_lease and hubspot_lease_until > now();
  return found;
end;
$$;

-- Extends a live lease before the next HubSpot write. False means the lease is
-- gone (expired and possibly reclaimed): the caller must stop, because another
-- worker may already be writing newer data.
create function public.hubspot_renew(p_lead uuid, p_lease uuid, p_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update leads
     set hubspot_lease_until = now() + make_interval(secs => greatest(30, least(p_seconds, 900)))
   where id = p_lead and hubspot_lease_token = p_lease and hubspot_lease_until > now();
  return found;
end;
$$;

-- Claims a domain for company creation, or returns the company already known.
--   company_id set   → reuse it
--   mine = true      → caller searches HubSpot / creates, then hubspot_set_company
--   both null/false  → another worker is creating it right now; try later
create function public.hubspot_claim_company(p_domain text, p_token uuid)
returns table (company_id text, mine boolean, uncertain boolean)
language plpgsql
set search_path = public
as $$
declare
  v_row hubspot_companies;
begin
  insert into hubspot_companies (domain, claim_token, claimed_at)
  values (p_domain, p_token, now())
  on conflict (domain) do nothing;

  select * into v_row from hubspot_companies where domain = p_domain for update;

  if v_row.company_id is not null then
    return query select v_row.company_id, false, v_row.uncertain;
  elsif v_row.claim_token = p_token then
    return query select null::text, true, v_row.uncertain;
  elsif v_row.claimed_at < now() - interval '5 minutes' then
    -- The previous claimant died; take over.
    update hubspot_companies set claim_token = p_token, claimed_at = now() where domain = p_domain;
    return query select null::text, true, v_row.uncertain;
  else
    return query select null::text, false, v_row.uncertain;
  end if;
end;
$$;

create function public.hubspot_mark_company_uncertain(p_domain text, p_token uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update hubspot_companies set uncertain = true
   where domain = p_domain and claim_token = p_token and company_id is null;
  return found;
end;
$$;

create function public.hubspot_set_company(p_domain text, p_token uuid, p_company_id text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update hubspot_companies set company_id = p_company_id, claim_token = null
   where domain = p_domain and claim_token = p_token and company_id is null;
  return found;
end;
$$;

-- Marks revision p_revision as synced. If the lead changed meanwhile it goes
-- straight back to pending. The first successful sync adds a timeline event.
-- p_warning is a fixed code shown alongside a successful sync (e.g. the owner
-- is not a HubSpot user), or null.
create function public.hubspot_complete(
  p_lead     uuid,
  p_lease    uuid,
  p_revision integer,
  p_warning  text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_first boolean;
begin
  select hubspot_synced_at is null into v_first
    from leads where id = p_lead and hubspot_lease_token = p_lease and hubspot_lease_until > now()
    for update;
  if not found then
    return false;
  end if;

  update leads
     set hubspot_synced_rev      = greatest(hubspot_synced_rev, p_revision),
         hubspot_synced_at       = now(),
         hubspot_sync_error      = p_warning,
         hubspot_attempts        = 0,
         hubspot_lease_token     = null,
         hubspot_lease_until     = null,
         hubspot_sync_state      = case when hubspot_desired_rev > p_revision
                                        then 'pending' else 'synced' end,
         hubspot_next_attempt_at = case when hubspot_desired_rev > p_revision
                                        then now() else null end
   where id = p_lead;

  if v_first then
    insert into lead_events (lead_id, actor_id, type) values (p_lead, null, 'hubspot_synced');
  end if;
  return true;
end;
$$;

-- Records a failure. Retryable failures back off exponentially (1, 2, 4 … min,
-- capped at 6 h) for up to 8 attempts, then stop as 'failed'. Permanent
-- failures (bad token, validation) stop at once; 'blocked' codes stop as blocked.
create function public.hubspot_fail(
  p_lead      uuid,
  p_lease     uuid,
  p_code      text,
  p_retryable boolean,
  p_blocked   boolean
)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update leads
     set hubspot_attempts        = hubspot_attempts + 1,
         hubspot_sync_error      = p_code,
         hubspot_lease_token     = null,
         hubspot_lease_until     = null,
         hubspot_sync_state      = case
           when p_blocked then 'blocked'
           when p_retryable and hubspot_attempts + 1 < 8 then 'retry'
           else 'failed' end,
         hubspot_next_attempt_at = case
           when p_retryable and not p_blocked and hubspot_attempts + 1 < 8
           then now() + least(interval '6 hours', make_interval(mins => power(2, hubspot_attempts)::integer))
           else null end
   where id = p_lead and hubspot_lease_token = p_lease and hubspot_lease_until > now();
  return found;
end;
$$;

-- Execution rights: service_role only -----------------------------------------

revoke execute on function public.lh_hubspot_enqueue()                       from public, anon, authenticated;
revoke execute on function public.hubspot_claim(integer, integer)            from public, anon, authenticated;
revoke execute on function public.hubspot_request(uuid)                      from public, anon, authenticated;
revoke execute on function public.hubspot_save_ids(uuid, uuid, text, text, text, text)
                                                                             from public, anon, authenticated;
revoke execute on function public.hubspot_complete(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.hubspot_fail(uuid, uuid, text, boolean, boolean)
                                                                             from public, anon, authenticated;
revoke execute on function public.hubspot_renew(uuid, uuid, integer)         from public, anon, authenticated;
revoke execute on function public.hubspot_claim_company(text, uuid)          from public, anon, authenticated;
revoke execute on function public.hubspot_set_company(text, uuid, text)      from public, anon, authenticated;
revoke execute on function public.hubspot_mark_company_uncertain(text, uuid) from public, anon, authenticated;

grant execute on function public.hubspot_claim(integer, integer)             to service_role;
grant execute on function public.hubspot_request(uuid)                       to service_role;
grant execute on function public.hubspot_save_ids(uuid, uuid, text, text, text, text)
                                                                             to service_role;
grant execute on function public.hubspot_complete(uuid, uuid, integer, text) to service_role;
grant execute on function public.hubspot_fail(uuid, uuid, text, boolean, boolean)
                                                                             to service_role;
grant execute on function public.hubspot_renew(uuid, uuid, integer)          to service_role;
grant execute on function public.hubspot_claim_company(text, uuid)           to service_role;
grant execute on function public.hubspot_set_company(text, uuid, text)       to service_role;
grant execute on function public.hubspot_mark_company_uncertain(text, uuid)  to service_role;

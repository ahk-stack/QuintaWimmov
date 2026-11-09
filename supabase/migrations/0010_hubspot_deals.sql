-- HubSpot Deals: each synced lead also gets a Deal in "Pipeline des ventes".
--
-- Additive. The 0009 functions are untouched, so a deployment still running
-- the Lead-only code keeps working until the Deal-aware code replaces it.
--
-- * `hubspot_deal_id` already exists on `leads` (0001, never written). It
--   becomes unique, like `hubspot_lead_id`: one app lead per HubSpot Deal.
-- * `hubspot_deal_outcome` records the last outcome (won/lost) the app wrote
--   to the Deal's stage. Only a CHANGE of outcome is written, so an unrelated
--   sync (a new owner, say) never re-closes a Deal that sales have since moved,
--   and middle stages stay entirely with sales in HubSpot.
-- * No backfill here. Leads synced before this change are queued separately,
--   once Deal-aware workers are live (see DEPLOYMENT.md), so an old worker
--   cannot claim one and mark it done without a Deal.

-- Nothing wrote the column before; make sure that is still true before the index.
do $$
begin
  if exists (
    select hubspot_deal_id from public.leads
     where hubspot_deal_id is not null
     group by hubspot_deal_id having count(*) > 1
  ) then
    raise exception 'duplicate hubspot_deal_id values; resolve before applying 0010';
  end if;
end;
$$;

alter table public.leads
  add column hubspot_deal_outcome text
    check (hubspot_deal_outcome is null or hubspot_deal_outcome in ('won', 'lost')),
  -- When the lead last reached won/lost, set by the trigger below in the same
  -- statement as the status change. The Deal's close date comes from here —
  -- not from the timeline, which is written separately and could lag.
  add column outcome_at timestamptz;

create function public.lh_stamp_outcome()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('won', 'lost') then
    new.outcome_at := now();
  end if;
  return new;
end;
$$;

create trigger leads_stamp_outcome
  before update of status on public.leads
  for each row execute function public.lh_stamp_outcome();

-- Existing won/lost leads: best available approximation.
update public.leads set outcome_at = created_at where status in ('won', 'lost') and outcome_at is null;

create unique index leads_hubspot_deal_id_key
  on public.leads (hubspot_deal_id) where hubspot_deal_id is not null;

-- Saves the Deal id (write-once) and, when p_set_outcome, the outcome just
-- written to HubSpot (null clears it after the app reopens the lead).
-- Only while the caller holds a live lease.
create function public.hubspot_save_deal(
  p_lead        uuid,
  p_lease       uuid,
  p_deal_id     text,
  p_set_outcome boolean,
  p_outcome     text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_existing text;
begin
  select hubspot_deal_id into v_existing
    from leads
   where id = p_lead and hubspot_lease_token = p_lease and hubspot_lease_until > now()
   for update;
  if not found then
    return false;
  end if;
  -- A different Deal already recorded: refuse rather than silently keep one
  -- and let the caller link the other.
  if p_deal_id is not null and v_existing is not null and v_existing <> p_deal_id then
    raise exception 'LH_DEAL_CONFLICT';
  end if;

  update leads
     set hubspot_deal_id      = coalesce(hubspot_deal_id, p_deal_id),
         hubspot_deal_outcome = case when p_set_outcome then p_outcome else hubspot_deal_outcome end
   where id = p_lead;
  return true;
end;
$$;

-- A worker wrote to HubSpot and only then found its lease gone: another worker
-- may have written newer values first. Queue the lead again and forget the
-- recorded outcome, so the CURRENT state — Deal stage included — is written
-- once more. A lead another worker is running gets re-queued when it completes.
create function public.hubspot_requeue(p_lead uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update leads
     set hubspot_desired_rev     = hubspot_desired_rev + 1,
         hubspot_deal_outcome    = null,
         hubspot_sync_state      = case when hubspot_sync_state in ('synced', 'failed', 'retry')
                                        then 'pending' else hubspot_sync_state end,
         hubspot_attempts        = case when hubspot_sync_state in ('synced', 'failed', 'retry')
                                        then 0 else hubspot_attempts end,
         hubspot_next_attempt_at = case when hubspot_sync_state in ('synced', 'failed', 'retry')
                                        then now() else hubspot_next_attempt_at end
   where id = p_lead and hubspot_sync_state not in ('manual', 'blocked');
end;
$$;

-- Queues leads synced before Deals existed, so each gets its Deal. Run once,
-- AFTER the Deal-aware code is deployed everywhere. Leaves running leases alone.
create function public.hubspot_queue_missing_deals()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  update leads
     set hubspot_sync_state      = 'pending',
         hubspot_desired_rev     = hubspot_desired_rev + 1,
         hubspot_attempts        = 0,
         hubspot_next_attempt_at = now()
   where hubspot_lead_id is not null
     and hubspot_deal_id is null
     and hubspot_sync_state in ('synced', 'failed', 'retry');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.hubspot_save_deal(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.hubspot_queue_missing_deals()                     from public, anon, authenticated;
revoke execute on function public.hubspot_requeue(uuid)                               from public, anon, authenticated;
revoke execute on function public.lh_stamp_outcome()                                  from public, anon, authenticated;
grant  execute on function public.hubspot_save_deal(uuid, uuid, text, boolean, text) to service_role;
grant  execute on function public.hubspot_queue_missing_deals()                     to service_role;
grant  execute on function public.hubspot_requeue(uuid)                               to service_role;

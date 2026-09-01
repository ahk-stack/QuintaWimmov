-- Make people.email optional.
--
-- The roster is supplied as names, roles and territories; the app never sends
-- mail and never looks anyone up by address, so email is descriptive metadata
-- rather than a key. Requiring it would have meant inventing 66 placeholder
-- addresses, and fake data in a required column is worse than an absent value
-- in an optional one.
--
-- The unique constraint is kept: Postgres allows multiple NULLs under UNIQUE, so
-- rows without an address coexist while real addresses stay unique once added.

alter table public.people
  alter column email drop not null;

-- The original check rejected anything without an "@". It has to tolerate NULL
-- now, and a check constraint returning NULL passes, so this is belt and braces
-- for readers rather than a behaviour change.
alter table public.people
  drop constraint if exists people_email_check;

alter table public.people
  add constraint people_email_check
  check (email is null or position('@' in email) > 1);

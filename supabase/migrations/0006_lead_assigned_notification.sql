-- A third notification kind: being assigned a lead.
--
-- Run this ON ITS OWN, not batched with statements that use the new value.
-- Postgres permits ALTER TYPE ... ADD VALUE inside a transaction, but the new
-- label cannot be referenced in that same transaction. Nothing here uses it, so
-- this file is safe as a single paste; a later migration may rely on it freely.

alter type notification_kind add value if not exists 'lead_assigned';

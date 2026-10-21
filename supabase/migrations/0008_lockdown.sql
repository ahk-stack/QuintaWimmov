-- Close the last anonymous read path, now that chat no longer needs it.
--
-- APPLY ONLY AFTER every running copy of the app has the sign-in release.
-- Until 0007, the browser subscribed to `messages` over Supabase Realtime with
-- the publishable key, and these two policies were what allowed it. With sign-in
-- in place that same key would let anyone read every chat message without
-- signing in, so the policies go and chat polls an authenticated endpoint.
--
-- A deployment still running the old code keeps working after this, but its
-- chat stops updating live until reloaded.
--
-- After this, the publishable key can read nothing at all. `npm run verify:rls`
-- asserts exactly that.

drop policy if exists "anon reads channels" on public.channels;
drop policy if exists "anon reads messages" on public.messages;

alter publication supabase_realtime drop table public.messages;

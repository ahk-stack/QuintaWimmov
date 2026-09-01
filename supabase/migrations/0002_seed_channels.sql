-- Seed the chat channels.
--
-- Channels are generic, so they can be seeded now. The roster (`people`) is
-- deliberately not seeded here: it holds real names and work emails, which
-- belong in a migration generated from the actual team list rather than
-- invented placeholders committed to a public repository.

insert into public.channels (name, slug, description) values
  ('General',       'general',  'Anything that does not belong anywhere else.'),
  ('Lead handover', 'handover', 'Questions on leads moving between sales and consultants.'),
  ('Wins',          'wins',     'Closed deals and things worth copying.')
on conflict (slug) do nothing;

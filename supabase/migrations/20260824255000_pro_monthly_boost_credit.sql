-- Pro monthly boost credit (owner, 2026-08-24 membership-perk round):
-- one free boost per calendar month for active Pro posters, tracked by the
-- month it was spent in. Elite already boosts free without limit;
-- Basic/Free keep their existing pricing. Costs the platform no cash —
-- only forgone boost revenue on a perk that builds the boost habit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS boost_credit_used_month text;

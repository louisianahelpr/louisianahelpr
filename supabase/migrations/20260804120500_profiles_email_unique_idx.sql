-- One account per email address.
--
-- profiles.email had no unique constraint, which mattered because several money
-- paths matched on it — most seriously the Stripe checkout webhook, which
-- granted a paid subscription tier via `.eq("email", customerEmail)`. With two
-- rows sharing an address (a case variant, or a stale unconfirmed signup) one
-- payment could upgrade the wrong account, or several at once.
--
-- The webhook has been changed to grant by user_id (client_reference_id /
-- metadata.user_id from create-pro-checkout); this index is the defence-in-depth
-- half, so the ambiguity cannot be reintroduced by any future code path.
--
-- Case-insensitive because the collision risk is precisely "same address,
-- different casing" — a plain UNIQUE(email) would not catch it.
--
-- Safe to apply: verified against production on 2026-08-04 —
--   select count(*), count(distinct lower(email)) from profiles where email is not null;
--   → 17 profiles, 17 distinct, 0 collisions.
-- Partial (WHERE email IS NOT NULL) so rows with a NULL email are unaffected;
-- NULLs are distinct in a btree anyway, this documents the intent.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique_idx
  ON public.profiles USING btree (lower(email))
  WHERE (email IS NOT NULL);

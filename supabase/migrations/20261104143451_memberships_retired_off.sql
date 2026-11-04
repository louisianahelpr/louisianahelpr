-- Memberships RETIRED (owner 2026-11-04 8:33 AM: "no membership features should
-- be used anymore"; lead brief to Builder 114). Every member gets the same
-- experience with no tier differences anywhere.
--
-- Until now the 'memberships' switch was at TESTERS (20261015033658): real
-- members already had the standard (free-tier) behaviour, and only admins and
-- test accounts saw plans, badges and paid perks. Setting it OFF gives every
-- account, admins and test accounts included, that same standard behaviour:
-- every remaining paid-tier branch on the server reads
-- feature_enabled_for_user('memberships', ...) (SQL) or featureEnabledForUser
-- (edge) and is now unreachable for everyone. The app no longer reads the
-- switch at all (useMembershipsOn answers false), so it is a server-only key
-- until the follow-up that deletes those reads and then the row itself.
--
-- Money: no fee or payout changes for any real member. The switch was already
-- off for every real member; this only closes it for testers too.
-- Measured on prod 2026-11-04 ~8:34 AM (read-only): 0 of 336 profiles (260 real,
-- 76 seed) hold a subscription_tier, a stripe_subscription_id or a
-- subscription_source, so no one is paying and no one loses a perk.
--
-- App Store: the store-review account already sees switches only when open to
-- everyone (store_review_accounts, 20261101154236), so the 1.0.4 reviewer sees
-- no change. Apple notification handling is untouched.
--
-- REPLAY-SAFE: a plain UPDATE to 'off' (never 'everyone'); a replay re-closes
-- a retired switch, which is the intent.

UPDATE public.feature_switches
   SET audience = 'off',
       description = 'RETIRED 2026-11-04 (owner: no membership features anymore). Kept OFF so every leftover paid-tier branch on the server stays unreachable for everyone. Never turn it back on.'
 WHERE key = 'memberships';

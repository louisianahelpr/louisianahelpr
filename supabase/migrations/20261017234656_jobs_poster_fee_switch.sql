-- Jobs poster fee (owner 2026-10-18): the ONE server switch the new model ships
-- behind, created OFF.
--
-- The new model: the job poster pays 5% of the job price + $0.70 at checkout
-- (9% + $0.70 for Pay in 4), the card cost comes out of it, and the Helpr keeps
-- 100%. create-payment asks feature_enabled_for_user('jobs_poster_fee', poster)
-- before it prices an escrow checkout, and the Post a Job checkout screen reads
-- the same switch (useFeature) to show the fee line. Created OFF so nothing
-- changes when this lands: every member stays on today's flat model (the Helpr
-- pays 5% + 70c). Going live is the owner's audited flip in Admin -> Settings,
-- and only after the remaining slices (gift-first, recurring visits, refunds,
-- displays) are on main and a native build with the new checkout is out
-- (an older build is refused at checkout, never charged a total it did not
-- show: create-payment's stale-quote check).
--
-- Replay-safe: ON CONFLICT DO NOTHING (a re-run never resets an audience the
-- owner has already changed). No grants: feature_switches' grants are set by
-- 20261012031120 and unchanged here.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('jobs_poster_fee', 'off',
        'Jobs poster fee: the poster pays 5% + $0.70 at checkout (9% + $0.70 for Pay in 4) and the Helpr keeps 100%. Flip only after every jobs-fee slice is on main and the new native build is required.')
ON CONFLICT (key) DO NOTHING;

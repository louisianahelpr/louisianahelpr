-- QA seed data: one test job per lifecycle stage for My Posts visual validation
-- Customer UUID: 00000000-0000-0000-0000-000000000001
-- Helper UUID:   00000000-0000-0000-0000-000000000002
-- Jobs:
--   11111111-1111-1111-1111-111111111101  open           (future)
--   11111111-1111-1111-1111-111111111102  in_progress    (PAST DUE)
--   11111111-1111-1111-1111-111111111103  completed      (past)
--   11111111-1111-1111-1111-111111111104  cancelled      (past)
--   11111111-1111-1111-1111-111111111105  in_progress    (escrow, DUE for auto-release)
--   11111111-1111-1111-1111-111111111106  completed      (payout_pending, OVERDUE)
--
-- ── TWO RULES THIS FILE FOLLOWS ─────────────────────────────────────────────
--
-- 1. EVERY DATE IS RELATIVE TO now(), AND SOME OF THEM ARE IN THE PAST.
--
--    Fixed dates rot, but relative dates that are all in the FUTURE rot in a
--    subtler way: on the day it is seeded the data has no past-due job, no job
--    whose auto-release window has elapsed, and no overdue payout — so an audit
--    run right after seeding cannot see a single time-dependent bug, and only
--    discovers them days later by accident. Measured 2026-08-31, four days
--    after the last prod seed: 12 jobs sat `in_progress` with `date_needed`
--    one to four days past, and one had been stuck in `payout_pending` since
--    2026-08-29 — none of which existed on seeding day.
--
--    So dates are expressed as offsets from now() and DELIBERATELY straddle it.
--    Jobs 102, 105 and 106 are already overdue the moment this file runs.
--
-- 2. EVERY ROW SETS is_seed = true.
--
--    `jobs.is_seed` / `profiles.is_seed` default to FALSE (20260825184500), and
--    the backfill in that migration was a one-time UPDATE, not a trigger. So
--    rows created by this script land looking like REAL production data. That
--    now has teeth beyond skewing admin revenue tiles: auto-release-payment,
--    process-scheduled-payouts and money-reconciliation all scope themselves to
--    `is_seed = false`, and an unflagged fixture is picked up by the live money
--    crons — which is exactly how one fixture drove the payout cron to HTTP 500
--    every 30 minutes for two days and saturated the ops alarm.
--
-- 3. NEVER SEED A STATUS THE PRODUCT CANNOT REACH — specifically NOT
--    `pending_approval`.
--
--    A fixture in an unreachable status is not a harmless extra: it is a screen
--    nobody designed, shown to a real person. Two hand-inserted prod fixtures
--    sat in `pending_approval`, one of them on the app owner's own account, and
--    rendered "Waiting on your team's approver. This post is over your team's
--    approval limit." on a product with no teams and no approval limits — the
--    `businesses` table was dropped in 20260828011811 and nothing has been able
--    to write that status since (migration 20260831232522 moved both rows to
--    `in_progress`). The statuses below are exactly the ones a poster can
--    actually produce; keep it that way. If you need coverage of a status, seed
--    a row that a real flow could have created, timestamps and all.
--
-- Bypass FK to auth.users so the seed is self-contained and idempotent.
-- SET session_replication_role = replica disables FK checks for this session only.

SET session_replication_role = replica;

-- QA poster user in auth.users (placeholder, no real credentials)
INSERT INTO auth.users (
  id,
  email,
  created_at,
  updated_at,
  raw_user_meta_data,
  raw_app_meta_data,
  is_super_admin,
  encrypted_password,
  email_confirmed_at,
  aud,
  role
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'qa-seed@louisiana-helpr.test',
  now(),
  now(),
  '{"full_name": "QA Seed User"}',
  '{}',
  false,
  '',
  now(),
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- QA poster profile
INSERT INTO public.profiles (
  user_id,
  full_name,
  role,
  is_seed
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'QA Seed User',
  'customer',
  true
)
ON CONFLICT (user_id) DO NOTHING;

-- QA helper user + profile. Jobs 105/106 below need a helper to sit in escrow
-- and payout_pending at all; without one they are not the states they claim to
-- be. Deliberately has NO stripe_account_id, which is the single commonest
-- reason a real payout is refused — so the fixtures exercise that path too.
INSERT INTO auth.users (
  id, email, created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
  is_super_admin, encrypted_password, email_confirmed_at, aud, role
)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'qa-seed-helper@louisiana-helpr.test',
  now(), now(), '{"full_name": "QA Seed Helper"}', '{}',
  false, '', now(), 'authenticated', 'authenticated'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  user_id,
  full_name,
  role,
  is_seed
)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'QA Seed Helper',
  'helper',
  true
)
ON CONFLICT (user_id) DO NOTHING;

-- Job 1: open — Lawn mowing
INSERT INTO public.jobs (
  id,
  customer_id,
  title,
  description,
  category,
  location,
  date_needed,
  budget,
  status,
  is_seed,
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000001',
  'QA: Open job (Lawn mowing)',
  'QA seed: front and back yard mowing, edging, and blowing. Standard suburban lot.',
  'yard_work',
  'New Orleans, LA',
  -- Comfortably in the future: the ordinary case.
  now() + INTERVAL '3 days',
  45.00,
  'open',
  true,
  now()
)
ON CONFLICT (id) DO NOTHING;

-- Job 2: in_progress — Deep clean
INSERT INTO public.jobs (
  id,
  customer_id,
  title,
  description,
  category,
  location,
  date_needed,
  budget,
  status,
  is_seed,
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111102',
  '00000000-0000-0000-0000-000000000001',
  'QA: In-progress job (Deep clean)',
  'QA seed: full deep clean of a 3-bedroom apartment, including kitchen and bathrooms.',
  'cleaning',
  'Baton Rouge, LA',
  -- DELIBERATELY PAST DUE on seeding day. This is the row that makes
  -- "job is in progress and its scheduled date has come and gone" visible
  -- immediately instead of two days later — the state 12 prod fixtures had
  -- drifted into unnoticed on 2026-08-31.
  now() - INTERVAL '2 days',
  80.00,
  'in_progress',
  true,
  now() - INTERVAL '4 days'
)
ON CONFLICT (id) DO NOTHING;

-- Job 3: completed — Furniture assembly
INSERT INTO public.jobs (
  id,
  customer_id,
  title,
  description,
  category,
  location,
  date_needed,
  budget,
  status,
  is_seed,
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111103',
  '00000000-0000-0000-0000-000000000001',
  'QA: Completed job (Furniture assembly)',
  'QA seed: assemble a dresser and two nightstands from flat-pack boxes.',
  'assembly',
  'Metairie, LA',
  now() - INTERVAL '2 days',
  65.00,
  'completed',
  true,
  now() - INTERVAL '3 days'
)
ON CONFLICT (id) DO NOTHING;

-- Job 4: cancelled — Delivery errand
INSERT INTO public.jobs (
  id,
  customer_id,
  title,
  description,
  category,
  location,
  date_needed,
  budget,
  status,
  is_seed,
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111104',
  '00000000-0000-0000-0000-000000000001',
  'QA: Cancelled job (Delivery errand)',
  'QA seed: pick up a package from FedEx location and deliver to home address.',
  'delivery',
  'Slidell, LA',
  now() - INTERVAL '1 day',
  25.00,
  'cancelled',
  true,
  now() - INTERVAL '2 days'
)
ON CONFLICT (id) DO NOTHING;

-- ── Money-state fixtures, both already OVERDUE on seeding day ───────────────
--
-- The four jobs above cover the My Posts lifecycle. Neither of them is in a
-- state the settlement crons act on, so seeding produced nothing that could
-- exercise — or expose a bug in — the escrow and payout paths on day one.
-- These two are aged past their deadlines on purpose.
--
-- Both carry is_seed = true, so the live money crons skip them
-- (auto-release-payment, process-scheduled-payouts) and money-reconciliation
-- only grades them under `?include_seed=1`. That is what makes them safe to
-- age aggressively: they are a target for a deliberate audit run, never work
-- the production crons will pick up and fail on forever.

-- Job 5: escrow, helper marked done more than the 24h auto-release window ago.
-- auto-release-payment's Phase 1 predicate matches this exactly, so a run with
-- ?include_seed=1 must move it to payout_pending. If it does not, that is a bug
-- and this row is what shows it — on seeding day, not four days later.
INSERT INTO public.jobs (
  id, customer_id, helper_id, title, description, category, location,
  date_needed, budget, status, payment_status, helper_completed_at,
  is_seed, created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111105',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'QA: Escrow past the auto-release window',
  'QA seed: helper marked this done more than 24 hours ago and the poster never confirmed. Auto-release should have settled it.',
  'handyman',
  'Houma, LA',
  now() - INTERVAL '3 days',
  120.00,
  'in_progress',
  'escrow',
  now() - INTERVAL '26 hours',
  true,
  now() - INTERVAL '5 days'
)
ON CONFLICT (id) DO NOTHING;

-- Job 6: payout_pending, scheduled payout long past. This is the END STATE of
-- an unguarded release write and of a payout that failed with nothing recorded
-- — the shape money-reconciliation's `payout_pending_stranded` check exists to
-- catch. Seeding it overdue means that check is exercised the day it is written
-- rather than waiting for a real payout to strand.
INSERT INTO public.jobs (
  id, customer_id, helper_id, title, description, category, location,
  date_needed, budget, status, payment_status, poster_completed_at,
  helper_completed_at, payout_scheduled_at, is_seed, created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111106',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'QA: Payout pending well past its scheduled time',
  'QA seed: completed and queued for payout, but the transfer never happened. The helper was told they would be paid and was not.',
  'moving',
  'Lake Charles, LA',
  now() - INTERVAL '4 days',
  95.00,
  'completed',
  'payout_pending',
  now() - INTERVAL '3 days',
  now() - INTERVAL '3 days',
  now() - INTERVAL '2 days',
  true,
  now() - INTERVAL '6 days'
)
ON CONFLICT (id) DO NOTHING;

-- Restore normal FK enforcement
SET session_replication_role = DEFAULT;

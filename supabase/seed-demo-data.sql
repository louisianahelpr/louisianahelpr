-- ============================================================================
-- Helpr — Demo Data Seed
-- ============================================================================
-- Purpose: populate Browse, Posts, and Messages with realistic Louisiana
-- jobs and message threads so the polished UI can be tested end-to-end.
--
-- HOW TO RUN
--   1. Open Supabase Dashboard → SQL Editor for the Louisiana Helpr project
--   2. Paste this entire file
--   3. Run.  Re-running is idempotent (deletes prior demo rows by tag).
--
-- WHAT IT CREATES
--   • 5 demo helpr profiles (auth.users + profiles rows, marked is_legacy_user=false
--     and email = demoN@helpr.test) — so RLS treats them like real users.
--   • 10 demo jobs visible in Browse (status=open, customer_id = demo helpers
--     so YOU can apply to them).
--   • 4 demo jobs the current logged-in user has POSTED (status=open).
--   • 6 demo messages between you and demo helpers, attached to the jobs above.
--
-- HOW TO REMOVE
--   Run the "CLEANUP" block at the bottom (commented out by default).
--
-- DATES ARE RELATIVE TO now(), AND SOME ARE DELIBERATELY IN THE PAST.
--   Every job here used to be dated `current_date + N days`, so on seeding day
--   the demo data contained not one past-due job. Anything that only goes wrong
--   once a deadline has passed — an overdue in-progress job, an expiry sweep, a
--   late-cancellation tier — was therefore invisible until the data had aged for
--   days by accident. (Measured 2026-08-31, four days after the last prod seed:
--   12 fixtures had drifted into `in_progress` with `date_needed` 1-4 days past.
--   None of them existed on seeding day.) Offsets now straddle now() so those
--   states exist immediately.
--
-- EVERY ROW SETS is_seed = true.
--   `jobs.is_seed` / `profiles.is_seed` default to FALSE (20260825184500) and
--   that migration's backfill was a one-time UPDATE, not a trigger — so demo
--   rows landed looking like real production data. Beyond skewing every admin
--   revenue tile, the money crons (auto-release-payment,
--   process-scheduled-payouts) and money-reconciliation now scope themselves to
--   `is_seed = false`, and an unflagged fixture gets picked up by the live
--   settlement paths.
-- ============================================================================

BEGIN;

-- ---------- 1. Identify the current user (the one running this script) ------
DO $$
DECLARE
  v_my_user_id uuid;
BEGIN
  -- When run via SQL Editor with auth, auth.uid() returns the dashboard user.
  -- Falls back to the first non-demo profile (for service-role runs).
  v_my_user_id := COALESCE(
    auth.uid(),
    (SELECT user_id FROM profiles
       WHERE COALESCE(email, '') NOT LIKE '%@helpr.test'
       ORDER BY created_at LIMIT 1)
  );
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'No real user found. Sign up at least one user before seeding demo data.';
  END IF;
  -- Stash so later statements can reference it.
  PERFORM set_config('demo.my_user_id', v_my_user_id::text, true);
END $$;

-- ---------- 2. Wipe any prior demo rows (idempotent) ------------------------
DELETE FROM messages WHERE job_id IN (
  SELECT id FROM jobs WHERE description LIKE '[demo]%'
);
DELETE FROM jobs WHERE description LIKE '[demo]%';
DELETE FROM profiles WHERE email LIKE 'demo%@helpr.test';
DELETE FROM auth.users WHERE email LIKE 'demo%@helpr.test';

-- ---------- 3. Create 5 demo helpr auth.users ------------------------------
-- We use deterministic UUIDs so re-runs are stable.
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111101'::uuid, '00000000-0000-0000-0000-000000000000',
   'demo1@helpr.test', crypt('demo-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Camille Robicheaux"}'::jsonb,
   'authenticated', 'authenticated', now(), now()),
  ('11111111-1111-1111-1111-111111111102'::uuid, '00000000-0000-0000-0000-000000000000',
   'demo2@helpr.test', crypt('demo-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Tre Boudreaux"}'::jsonb,
   'authenticated', 'authenticated', now(), now()),
  ('11111111-1111-1111-1111-111111111103'::uuid, '00000000-0000-0000-0000-000000000000',
   'demo3@helpr.test', crypt('demo-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Marie Hebert"}'::jsonb,
   'authenticated', 'authenticated', now(), now()),
  ('11111111-1111-1111-1111-111111111104'::uuid, '00000000-0000-0000-0000-000000000000',
   'demo4@helpr.test', crypt('demo-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Eli Thibodeaux"}'::jsonb,
   'authenticated', 'authenticated', now(), now()),
  ('11111111-1111-1111-1111-111111111105'::uuid, '00000000-0000-0000-0000-000000000000',
   'demo5@helpr.test', crypt('demo-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Layla Fontenot"}'::jsonb,
   'authenticated', 'authenticated', now(), now());

-- ---------- 4. Create the matching profiles --------------------------------
INSERT INTO profiles (user_id, full_name, email, parish, location, bio, approval_status,
  insurance_status, license_status, email_verified, accepted_terms_at, is_seed)
VALUES
  ('11111111-1111-1111-1111-111111111101', 'Camille Robicheaux', 'demo1@helpr.test',
   'Orleans', 'New Orleans', 'Five years of detail-cleaning Mid-City homes. Bring your own key — I bring everything else.',
   'approved', 'verified', 'verified', true, now(), true),
  ('11111111-1111-1111-1111-111111111102', 'Tre Boudreaux', 'demo2@helpr.test',
   'East Baton Rouge', 'Baton Rouge', 'Handyman, mover, and yard guy. Truck + tools. Saturday and Sunday only.',
   'approved', 'verified', 'verified', true, now(), true),
  ('11111111-1111-1111-1111-111111111103', 'Marie Hebert', 'demo3@helpr.test',
   'Lafayette', 'Lafayette', 'Errands, grocery runs, pet sitting. Quiet, dependable, on time.',
   'approved', 'verified', 'verified', true, now(), true),
  ('11111111-1111-1111-1111-111111111104', 'Eli Thibodeaux', 'demo4@helpr.test',
   'Jefferson', 'Metairie', 'Painter and assembly. IKEA furniture welcome. Hourly or per-piece.',
   'approved', 'verified', 'verified', true, now(), true),
  ('11111111-1111-1111-1111-111111111105', 'Layla Fontenot', 'demo5@helpr.test',
   'Orleans', 'New Orleans', 'Pet care and dog walking in the Garden District and Uptown. CPR-certified.',
   'approved', 'verified', 'verified', true, now(), true);

-- ---------- 5. Insert 10 demo jobs visible in Browse -----------------------
-- Owned by demo helpers, status=open, so the current user can see/apply to them.
INSERT INTO jobs (customer_id, title, description, category, location, parish,
  date_needed, estimated_hours, budget, status, photos, is_seed)
VALUES
  ('11111111-1111-1111-1111-111111111101', 'Help with hurricane prep — Magazine St.',
   '[demo] Need an extra set of hands to bring in patio furniture, board up two windows, and stash supplies before the storm. Have plywood and tools ready.',
   'handyman', '4400 Magazine St, New Orleans, LA 70115', 'Orleans',
   (now() - interval '2 days')::date, 3, 95, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111102', 'Move a couch up two flights — Spanish Town',
   '[demo] Need 2 strong helpers to move a sleeper sofa from a U-Haul to a third-floor walk-up. Should take 30 min if we hustle.',
   'moving', '500 N 5th St, Baton Rouge, LA 70802', 'East Baton Rouge',
   (now() + interval '2 days')::date, 1, 60, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111103', 'Weekly yard mow — quarter acre',
   '[demo] Lawn, edging, blow off the driveway. Recurring weekly through October. I have the mower; bring trimmer and blower.',
   'yard_work', '210 Cherry St, Lafayette, LA 70506', 'Lafayette',
   (now() - interval '1 day')::date, 2, 65, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111104', 'Assemble two IKEA wardrobes (PAX)',
   '[demo] Two PAX wardrobes, all parts here, instructions printed. Tools welcome but I have a basic set.',
   'assembly', '4200 Veterans Blvd, Metairie, LA 70006', 'Jefferson',
   (now() + interval '4 days')::date, 4, 140, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111105', 'Dog walk while I''m on shift — every Tue/Thu',
   '[demo] 45-min walk for a 50-lb golden mix. Friendly, leash-trained. Need someone consistent for the next 3 weeks.',
   'pet_care', '1800 Coliseum St, New Orleans, LA 70130', 'Orleans',
   (now() + interval '1 day')::date, 1, 25, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111101', 'Deep clean before family visit',
   '[demo] 2BR/1BA, kitchen and baths the priority, baseboards if there''s time. Friday afternoon.',
   'cleaning', '2700 St Charles Ave, New Orleans, LA 70130', 'Orleans',
   (now() + interval '5 days')::date, 4, 130, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111102', 'Costco run + drop-off',
   '[demo] List of about 12 items, I''ll Venmo the receipt + a flat fee for time and gas. ~30 min each way.',
   'errands', '7000 Siegen Ln, Baton Rouge, LA 70809', 'East Baton Rouge',
   (now() - interval '4 days')::date, 2, 40, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111104', 'Touch-up paint, dining room',
   '[demo] Small wall section after a furniture move scuffed it. I have the paint. Should be a quick patch and roll.',
   'painting', '900 N Carrollton Ave, New Orleans, LA 70119', 'Orleans',
   (now() + interval '6 days')::date, 2, 70, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111103', 'Mount a 65" TV',
   '[demo] Bracket and TV in box, drywall (no studs in the spot — using anchors). Cable management nice-to-have.',
   'handyman', '450 Walmart Dr, Lafayette, LA 70508', 'Lafayette',
   (now() + interval '12 hours')::date, 1, 55, 'open', ARRAY[]::text[], true),
  ('11111111-1111-1111-1111-111111111105', 'Saturday market grocery delivery',
   '[demo] Pick up my pre-paid order at the Crescent City Farmers Market and drop at my house Uptown.',
   'delivery', '750 Carondelet St, New Orleans, LA 70130', 'Orleans',
   (now() + interval '3 days')::date, 1, 30, 'open', ARRAY[]::text[], true);

-- ---------- 6. Insert 4 jobs the current user has POSTED -------------------
-- These appear in My Posted Jobs.
INSERT INTO jobs (customer_id, title, description, category, location, parish,
  date_needed, estimated_hours, budget, status, photos, is_seed)
VALUES
  (current_setting('demo.my_user_id')::uuid, 'Help me unload a moving truck',
   '[demo] Loading is done — just need 2 hands for an hour to unload the truck into the front room. Drinks on me.',
   'moving', '1234 St Charles Ave, New Orleans, LA 70130', 'Orleans',
   (now() - interval '3 days')::date, 1, 60, 'open', ARRAY[]::text[], true),
  (current_setting('demo.my_user_id')::uuid, 'Power-wash the driveway and porch',
   '[demo] About 600 sq ft of concrete. I have a Ryobi pressure washer or you can bring your own.',
   'yard_work', '1234 St Charles Ave, New Orleans, LA 70130', 'Orleans',
   (now() + interval '4 days')::date, 3, 95, 'open', ARRAY[]::text[], true),
  (current_setting('demo.my_user_id')::uuid, 'Hang gallery wall (8 frames)',
   '[demo] Frames already arranged on the floor. Need someone with a level and a stud finder.',
   'handyman', '1234 St Charles Ave, New Orleans, LA 70130', 'Orleans',
   (now() + interval '6 days')::date, 2, 70, 'open', ARRAY[]::text[], true),
  (current_setting('demo.my_user_id')::uuid, 'Cat-sit Friday through Sunday',
   '[demo] Two indoor cats. Just food, water, litter. House key under the planter. Pay per visit or flat.',
   'pet_care', '1234 St Charles Ave, New Orleans, LA 70130', 'Orleans',
   (now() + interval '7 days')::date, 1, 80, 'open', ARRAY[]::text[], true);

-- ---------- 7. Insert 6 demo messages between current user and helpers -----
-- Attach messages to the user's first posted job so they appear in Messages.
DO $$
DECLARE
  v_my_user_id uuid := current_setting('demo.my_user_id')::uuid;
  v_job_1 uuid;
  v_job_2 uuid;
BEGIN
  SELECT id INTO v_job_1 FROM jobs
   WHERE customer_id = v_my_user_id AND title = 'Help me unload a moving truck' LIMIT 1;
  SELECT id INTO v_job_2 FROM jobs
   WHERE customer_id = v_my_user_id AND title = 'Cat-sit Friday through Sunday' LIMIT 1;

  IF v_job_1 IS NOT NULL THEN
    INSERT INTO messages (job_id, sender_id, receiver_id, content, read, created_at) VALUES
      (v_job_1, '11111111-1111-1111-1111-111111111102', v_my_user_id,
       'Hey — I''ve got a truck and can be there in 30 if it''s still open.',
       false, now() - interval '20 minutes'),
      (v_job_1, v_my_user_id, '11111111-1111-1111-1111-111111111102',
       'Yes please! Address is in the listing. Door''s unlocked.',
       true, now() - interval '18 minutes'),
      (v_job_1, '11111111-1111-1111-1111-111111111102', v_my_user_id,
       'On my way. Bringing dolly + straps.',
       false, now() - interval '15 minutes');
  END IF;

  IF v_job_2 IS NOT NULL THEN
    INSERT INTO messages (job_id, sender_id, receiver_id, content, read, created_at) VALUES
      (v_job_2, '11111111-1111-1111-1111-111111111105', v_my_user_id,
       'Both cats are sweet — I can do twice-a-day visits with photos. $25/visit work?',
       false, now() - interval '2 hours'),
      (v_job_2, v_my_user_id, '11111111-1111-1111-1111-111111111105',
       'Perfect. Friday morning through Sunday evening = 6 visits.',
       true, now() - interval '1 hour 50 minutes'),
      (v_job_2, '11111111-1111-1111-1111-111111111105', v_my_user_id,
       'Booked. I''ll send the first photo at the Friday visit.',
       false, now() - interval '1 hour 45 minutes');
  END IF;
END $$;

-- ---------- 8. Mark demo jobs as escrow-funded -----------------------------
-- The Browse feed query applies `.neq("payment_status", "abandoned")`, and
-- in SQL `NULL <> 'abandoned'` is NULL (not true), so any job left with a
-- NULL payment_status is silently filtered OUT of Browse. A real posted job
-- is escrow-funded at checkout (the Stripe webhook sets payment_status='escrow'
-- on the job once checkout confirms), so we stamp the demo jobs the same way —
-- otherwise none of them show up. NOTE: 'paid' is NOT a valid jobs
-- payment_status (jobs_payment_status_check allows only unpaid/escrow/
-- payout_pending/released/refunded/cancelled/abandoned) and would abort the seed.
UPDATE jobs SET payment_status = 'escrow' WHERE description LIKE '[demo]%';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 'demo profiles created'  AS step, count(*) FROM profiles WHERE email LIKE 'demo%@helpr.test'
UNION ALL
SELECT 'demo jobs created',     count(*) FROM jobs WHERE description LIKE '[demo]%'
UNION ALL
SELECT 'demo messages created', count(*) FROM messages
  WHERE job_id IN (SELECT id FROM jobs WHERE description LIKE '[demo]%');

-- ============================================================================
-- CLEANUP — uncomment and run to remove all demo data
-- ============================================================================
-- BEGIN;
--   DELETE FROM messages WHERE job_id IN (SELECT id FROM jobs WHERE description LIKE '[demo]%');
--   DELETE FROM jobs WHERE description LIKE '[demo]%';
--   DELETE FROM profiles WHERE email LIKE 'demo%@helpr.test';
--   DELETE FROM auth.users WHERE email LIKE 'demo%@helpr.test';
-- COMMIT;

-- Cowork audit seed — 15 test jobs covering every state-bucket the UI surfaces.
-- Tagged `[COWORK-SEED]` in special_requirements so a re-run can wipe-and-reseed
-- without touching real customer data.
--
-- WHAT YOU GET (assumes you're logged in as lexilombas05@gmail.com):
--   • 5 jobs YOU posted → My Posts (open · open-w/-pending-apps · accepted · in_progress · completed)
--   • 5 jobs you APPLIED to from another helper → My Jobs (pending · pending · accepted · rejected · pending-bid)
--   • 5 open jobs from another poster → Browse feed has variety
--
-- HOW TO RUN (pick one):
--   A) Supabase Dashboard → SQL Editor → paste this file → Run
--   B) `npx supabase db execute --linked --file scripts/seed-cowork-test-jobs.sql`
--
-- TO RE-SEED (wipe + reinsert): just re-run; the leading DELETE clears prior seeded rows.

BEGIN;

-- ── 0. Wipe prior seed (idempotent) ─────────────────────────────────
DELETE FROM public.applications
WHERE job_id IN (
  SELECT id FROM public.jobs WHERE special_requirements LIKE '[COWORK-SEED]%'
);
DELETE FROM public.jobs WHERE special_requirements LIKE '[COWORK-SEED]%';

-- ── 1. Resolve user ids ─────────────────────────────────────────────
-- Lexi (the audit user). If you change emails, update this WHERE clause.
-- Second user = any other approved profile; falls back to Lexi so the seed
-- still completes on a dev DB that only has one user (you'll see your own
-- name as the poster on the "applied to" rows, which is fine for visual QA).
WITH
ids AS (
  SELECT
    (SELECT id FROM auth.users WHERE email = 'lexilombas05@gmail.com' LIMIT 1) AS lexi,
    COALESCE(
      (SELECT p.user_id
         FROM public.profiles p
        WHERE p.user_id <> (SELECT id FROM auth.users WHERE email = 'lexilombas05@gmail.com')
          AND p.approval_status = 'approved'
        ORDER BY p.created_at
        LIMIT 1),
      (SELECT id FROM auth.users WHERE email = 'lexilombas05@gmail.com' LIMIT 1)
    ) AS other
),

-- ── 2. Lexi's own posts (My Posts surface) ──────────────────────────
my_posts AS (
  INSERT INTO public.jobs
    (customer_id, title, description, category, budget, date_needed, location,
     status, pricing_mode, payment_status, helper_id,
     poster_completed_at, helper_completed_at, special_requirements, created_at)
  SELECT customer_id, title, description, category::job_category, budget, date_needed, location,
         status::job_status, pricing_mode, payment_status, helper_id,
         poster_completed_at, helper_completed_at, special_requirements, created_at
  FROM (VALUES
    -- a) Open, no applications yet → blank "no applicants" state on My Posts row
    ((SELECT lexi FROM ids),
     'Help me unload moving truck Saturday',
     'Need a strong hand to help unload a 16-ft truck. About 90 minutes of work, all boxes labeled. Drinks on me.',
     'moving', 120, (CURRENT_DATE + INTERVAL '3 days')::date, 'Lafayette, LA 70503',
     'open', 'fixed', 'paid', NULL,
     NULL, NULL, '[COWORK-SEED] my-posts open no-apps', NOW() - INTERVAL '2 hours'),

    -- b) Open, has-applicants (gets an application below) → pending-apps state
    ((SELECT lexi FROM ids),
     'Lawn mowing + edging — half acre',
     'Front + back yard, about half an acre. Mower available on-site; bring your own trimmer if possible.',
     'yard_work', 65, (CURRENT_DATE + INTERVAL '1 day')::date, 'New Iberia, LA 70560',
     'open', 'fixed', 'paid', NULL,
     NULL, NULL, '[COWORK-SEED] my-posts open with-apps', NOW() - INTERVAL '6 hours'),

    -- c) Accepted (helper hired, not started) → "Hired" / awaiting work
    ((SELECT lexi FROM ids),
     'Deep-clean kitchen before family visit',
     'Stove, oven, fridge, cabinets. Will be empty when you arrive. Need it done in one visit.',
     'cleaning', 140, (CURRENT_DATE + INTERVAL '2 days')::date, 'Delcambre, LA 70528',
     'accepted', 'fixed', 'paid', (SELECT other FROM ids),
     NULL, NULL, '[COWORK-SEED] my-posts accepted', NOW() - INTERVAL '1 day'),

    -- d) In progress → live job, helper on the way / working
    ((SELECT lexi FROM ids),
     'Hang 3 ceiling fans',
     'Three identical fans, boxes already in the rooms. Should take 1.5 hrs.',
     'handyman', 180, CURRENT_DATE, 'Lafayette, LA 70508',
     'in_progress', 'fixed', 'paid', (SELECT other FROM ids),
     NULL, NULL, '[COWORK-SEED] my-posts in-progress', NOW() - INTERVAL '8 hours'),

    -- e) Completed → reviewable, sits in Past tab
    ((SELECT lexi FROM ids),
     'Pick up + deliver dining table',
     'From a friend in Broussard to my place in Lafayette. Pickup truck required.',
     'delivery', 95, (CURRENT_DATE - INTERVAL '4 days')::date, 'Lafayette, LA 70506',
     'completed', 'fixed', 'paid', (SELECT other FROM ids),
     NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', '[COWORK-SEED] my-posts completed', NOW() - INTERVAL '5 days')
  ) AS t(customer_id, title, description, category, budget, date_needed, location,
         status, pricing_mode, payment_status, helper_id,
         poster_completed_at, helper_completed_at, special_requirements, created_at)
  RETURNING id, title
),

-- ── 3. Other-user posts that Lexi has applied to (My Jobs surface) ──
applied_jobs AS (
  INSERT INTO public.jobs
    (customer_id, title, description, category, budget, date_needed, location,
     status, pricing_mode, payment_status, helper_id, special_requirements, created_at)
  SELECT customer_id, title, description, category::job_category, budget, date_needed, location,
         status::job_status, pricing_mode, payment_status, helper_id, special_requirements, created_at
  FROM (VALUES
    -- f) Pending app → most common state on My Jobs
    ((SELECT other FROM ids),
     'Pressure-wash driveway + walkway',
     '~600 sqft concrete. Pressure washer + water access on-site.',
     'cleaning', 110, (CURRENT_DATE + INTERVAL '4 days')::date, 'Youngsville, LA 70592',
     'open', 'fixed', 'paid', NULL, '[COWORK-SEED] my-jobs pending-1', NOW() - INTERVAL '4 hours'),

    -- g) Pending app, urgent → urgent badge variation
    ((SELECT other FROM ids),
     'URGENT: babysit 2 kids tonight 6-10pm',
     'Last-minute work event. 4 and 7 yo, both easy. Dinner already made.',
     'childcare', 80, CURRENT_DATE, 'Lafayette, LA 70501',
     'open', 'fixed', 'paid', NULL, '[COWORK-SEED] my-jobs pending-urgent', NOW() - INTERVAL '1 hour'),

    -- h) Application accepted → "You got it!" state
    ((SELECT other FROM ids),
     'Walk 2 friendly dogs daily, 30 min',
     'M-F, 4-week stretch starting next Mon. Both leashed, calm seniors.',
     'pet_care', 250, (CURRENT_DATE + INTERVAL '7 days')::date, 'Lafayette, LA 70508',
     'accepted', 'fixed', 'paid', (SELECT lexi FROM ids), '[COWORK-SEED] my-jobs accepted', NOW() - INTERVAL '2 days'),

    -- i) Application rejected → not-hired state
    ((SELECT other FROM ids),
     'Move 1-bedroom apt across town',
     'Studio + bed + couch + boxes. Already have a truck. Need 2 hours of muscle.',
     'moving', 90, (CURRENT_DATE + INTERVAL '5 days')::date, 'Lafayette, LA 70506',
     'open', 'fixed', 'paid', NULL, '[COWORK-SEED] my-jobs rejected', NOW() - INTERVAL '3 days'),

    -- j) Pending bid (accept_bids pricing_mode) → bid-mode UI
    ((SELECT other FROM ids),
     'Tutor algebra II — 8th grader',
     '4 sessions over 2 weeks, weekday evenings. Propose your hourly rate when you apply.',
     'tutoring', 200, (CURRENT_DATE + INTERVAL '2 days')::date, 'New Iberia, LA 70560',
     'open', 'accept_bids', 'paid', NULL, '[COWORK-SEED] my-jobs pending-bid', NOW() - INTERVAL '12 hours')
  ) AS t(customer_id, title, description, category, budget, date_needed, location,
         status, pricing_mode, payment_status, helper_id, special_requirements, created_at)
  RETURNING id, special_requirements
),

-- ── 4. Lexi's applications to those other-user jobs ─────────────────
applied_apps AS (
  INSERT INTO public.applications (job_id, helper_id, status, message, proposed_rate)
  SELECT
    j.id,
    (SELECT lexi FROM ids),
    CASE
      WHEN j.special_requirements LIKE '%accepted%'  THEN 'accepted'::application_status
      WHEN j.special_requirements LIKE '%rejected%'  THEN 'rejected'::application_status
      ELSE 'pending'::application_status
    END,
    'Hey! Just sent an application — happy to handle this for you.',
    CASE WHEN j.special_requirements LIKE '%pending-bid%' THEN 45 ELSE NULL END
  FROM applied_jobs j
  RETURNING id
),

-- ── 5. Application on Lexi's own with-apps post (so My Posts row has an applicant) ──
self_post_app AS (
  INSERT INTO public.applications (job_id, helper_id, status, message)
  SELECT
    p.id,
    (SELECT other FROM ids),
    'pending'::application_status,
    'Hi! I can do this Saturday morning, plenty of yard-work experience.'
  FROM my_posts p
  WHERE p.title = 'Lawn mowing + edging — half acre'
  RETURNING id
),

-- ── 6. Extra browse-feed variety — 5 other-user open jobs ───────────
browse_jobs AS (
  INSERT INTO public.jobs
    (customer_id, title, description, category, budget, date_needed, location,
     status, pricing_mode, payment_status, is_urgent, urgent_fee, helpers_needed,
     is_group_job, special_requirements, created_at)
  SELECT customer_id, title, description, category::job_category, budget, date_needed, location,
         status::job_status, pricing_mode, payment_status, is_urgent, urgent_fee, helpers_needed,
         is_group_job, special_requirements, created_at
  FROM (VALUES
    ((SELECT other FROM ids),
     'Paint a 12x14 bedroom — one color',
     'Walls only, ceiling stays. Paint + supplies provided.',
     'painting', 220, (CURRENT_DATE + INTERVAL '6 days')::date, 'Lafayette, LA 70503',
     'open', 'fixed', 'paid', false, 0, 1, false,
     '[COWORK-SEED] browse paint', NOW() - INTERVAL '20 minutes'),

    ((SELECT other FROM ids),
     'Build IKEA wardrobe (PAX)',
     '2-bay PAX. Boxes on-site, tools available. Solo job, ~2.5 hrs.',
     'handyman', 130, (CURRENT_DATE + INTERVAL '3 days')::date, 'Youngsville, LA 70592',
     'open', 'fixed', 'paid', false, 0, 1, false,
     '[COWORK-SEED] browse ikea', NOW() - INTERVAL '40 minutes'),

    ((SELECT other FROM ids),
     'Group cleanup — flooded backyard',
     'After last week''s storm. Need 3 helpers for ~2 hours of debris-clearing.',
     'yard_work', 300, (CURRENT_DATE + INTERVAL '2 days')::date, 'New Iberia, LA 70560',
     'open', 'fixed', 'paid', true, 25, 3, true,
     '[COWORK-SEED] browse group urgent', NOW() - INTERVAL '15 minutes'),

    ((SELECT other FROM ids),
     'Senior tech help — set up new iPad',
     '1 hr, patient teacher please. My mom wants to FaceTime grandkids.',
     'tech_help', 50, (CURRENT_DATE + INTERVAL '1 day')::date, 'Lafayette, LA 70506',
     'open', 'fixed', 'paid', false, 0, 1, false,
     '[COWORK-SEED] browse tech', NOW() - INTERVAL '3 hours'),

    ((SELECT other FROM ids),
     'Grocery run + put-away',
     'List provided. About 20 items from Rouses, then put away when you get back.',
     'errands', 45, CURRENT_DATE, 'Delcambre, LA 70528',
     'open', 'fixed', 'paid', false, 0, 1, false,
     '[COWORK-SEED] browse errands', NOW() - INTERVAL '5 minutes')
  ) AS t(customer_id, title, description, category, budget, date_needed, location,
         status, pricing_mode, payment_status, is_urgent, urgent_fee, helpers_needed,
         is_group_job, special_requirements, created_at)
  RETURNING id
)

SELECT
  (SELECT count(*) FROM my_posts)      AS my_posts_inserted,
  (SELECT count(*) FROM applied_jobs)  AS applied_jobs_inserted,
  (SELECT count(*) FROM applied_apps)  AS my_applications_inserted,
  (SELECT count(*) FROM self_post_app) AS apps_on_my_posts_inserted,
  (SELECT count(*) FROM browse_jobs)   AS browse_only_jobs_inserted;

COMMIT;

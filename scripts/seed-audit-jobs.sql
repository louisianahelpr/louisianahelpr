-- Seed varied OPEN jobs for auditing populated screens.
--
-- Why this file exists: every one of the 12 jobs in the production database is
-- `cancelled`, so browse, dashboard, job detail, applicants and messages all
-- render empty states and cannot be audited. Claude is blocked from writing to
-- prod by the safety classifier even with verbal approval, so this is here for
-- you to run yourself.
--
-- Safety notes:
--   * Every row is owned by a clearly-marked TEST account ("Audit Tester" /
--     "Audit Helper"). No real user's rows are created or modified.
--   * Titles are realistic on purpose — a visual audit against "[TEST] asdf"
--     copy proves nothing about how the product actually reads.
--   * Cleanup is a single statement, at the bottom of this file.
--
-- Run it from the Supabase SQL editor, or:
--   psql "$SUPABASE_DB_URL" -f scripts/seed-audit-jobs.sql

insert into jobs (
  customer_id, title, description, category, location,
  date_needed, start_time, estimated_hours, budget, status,
  is_urgent, urgent_fee, is_flexible_schedule
)
values
  -- Audit Tester (417ce8bf-…) ------------------------------------------------
  ('417ce8bf-615e-4d31-abd1-2948881d27c5',
   'Mow and edge a corner lot before the weekend',
   'Quarter acre, front and back. Gate is wide enough for a riding mower. Please bag the clippings.',
   'yard_work', '1420 Johnston St, Lafayette, LA 70503',
   current_date + 3, '09:00', 3, 95, 'open', false, null, false),

  ('417ce8bf-615e-4d31-abd1-2948881d27c5',
   'Deep clean a two-bedroom before move-in day',
   'Empty apartment. Kitchen, two baths, baseboards and inside all cabinets. Supplies provided.',
   'cleaning', '305 Rue Beauregard, Lafayette, LA 70508',
   current_date + 4, '13:00', 5, 180, 'open', false, null, true),

  -- Urgent: note the jobs_urgent_fee_required check constraint — is_urgent
  -- REQUIRES a non-null urgent_fee. This row exercises the urgent styling.
  ('417ce8bf-615e-4d31-abd1-2948881d27c5',
   'Board up windows ahead of the storm',
   'Eight windows, plywood already cut and stacked in the carport. Need it done today if possible.',
   'storm_prep', '88 Bayou Rd, New Iberia, LA 70560',
   current_date + 1, '07:30', 4, 240, 'open', true, 35, false),

  ('417ce8bf-615e-4d31-abd1-2948881d27c5',
   'Help load a 16-foot truck',
   'Furniture and about 30 boxes, everything is packed and labeled already. Ground floor to ground floor.',
   'moving', '404 Camellia Blvd, Lafayette, LA 70503',
   current_date + 8, '08:30', 4, 200, 'open', false, null, false),

  -- Audit Helper (c77d01b9-…) ------------------------------------------------
  ('c77d01b9-48d1-4157-b9d9-17746f23c6e2',
   'Assemble a crib and a dresser',
   'Both still boxed. Instructions included, hardware is all there. Second floor, stairs.',
   'assembly', '7 Oak Alley Dr, Broussard, LA 70518',
   current_date + 5, '10:00', 2, 130, 'open', false, null, false),

  ('c77d01b9-48d1-4157-b9d9-17746f23c6e2',
   'Grocery run and pharmacy pickup',
   'List is short, about 15 items. Pharmacy pickup is under my name, ID at the counter.',
   'errands', 'Youngsville, LA 70592',
   current_date + 2, '11:00', 1, 45, 'open', false, null, true),

  ('c77d01b9-48d1-4157-b9d9-17746f23c6e2',
   'Paint a small bedroom, walls only',
   '12x12 room, one coat over eggshell. Paint and drop cloths are here. No ceiling, no trim.',
   'painting', '221 Verot School Rd, Lafayette, LA 70508',
   current_date + 7, '08:00', 6, 260, 'open', false, null, false),

  ('c77d01b9-48d1-4157-b9d9-17746f23c6e2',
   'Walk two dogs weekday mornings',
   'Both are friendly labs, about 30 minutes around the neighborhood. Leashes by the door.',
   'pet_care', 'Scott, LA 70583',
   current_date + 6, '07:00', 1, 40, 'open', false, null, true);


-- Optional: restore the four already-seeded jobs behind Lexi's existing
-- applications so /my-jobs has live ACTIVE rows instead of only CLOSED ones.
-- These jobs belong to synthetic customers (1111…101 / 1111…102), NOT to a
-- real user, and the applications themselves already exist — nothing new is
-- attributed to your account.
--
-- update jobs set status = 'open'
--  where id in (
--    '5119e000-1da8-4548-9e4a-51543df6d6b1',  -- Board windows ahead of the storm
--    '72044248-f44c-44a9-a231-e6885abe689e',  -- Grocery run + pharmacy pickup
--    '4036825f-9ad6-40fa-8152-af981ea2e08c',  -- Crawfish boil setup and teardown
--    '99c56dec-1eae-4bdd-8bfa-16e2ef8388bd'   -- Pick up dining table
--  );


-- ── Cleanup ────────────────────────────────────────────────────────────────
-- Removes every job this file created, and nothing else.
--
-- delete from jobs
--  where customer_id in (
--    '417ce8bf-615e-4d31-abd1-2948881d27c5',
--    'c77d01b9-48d1-4157-b9d9-17746f23c6e2'
--  );

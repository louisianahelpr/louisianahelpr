-- QA seed data: one test job per lifecycle stage for My Posts visual validation
-- Customer UUID: 00000000-0000-0000-0000-000000000001
-- Jobs:
--   11111111-1111-1111-1111-111111111101  open
--   11111111-1111-1111-1111-111111111102  in_progress
--   11111111-1111-1111-1111-111111111103  completed
--   11111111-1111-1111-1111-111111111104  cancelled
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
  role
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'QA Seed User',
  'customer'
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
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000001',
  'QA: Open job (Lawn mowing)',
  'QA seed: front and back yard mowing, edging, and blowing. Standard suburban lot.',
  'yard_work',
  'New Orleans, LA',
  CURRENT_DATE + INTERVAL '3 days',
  45.00,
  'open',
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
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111102',
  '00000000-0000-0000-0000-000000000001',
  'QA: In-progress job (Deep clean)',
  'QA seed: full deep clean of a 3-bedroom apartment, including kitchen and bathrooms.',
  'cleaning',
  'Baton Rouge, LA',
  CURRENT_DATE + INTERVAL '1 day',
  80.00,
  'in_progress',
  now()
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
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111103',
  '00000000-0000-0000-0000-000000000001',
  'QA: Completed job (Furniture assembly)',
  'QA seed: assemble a dresser and two nightstands from flat-pack boxes.',
  'assembly',
  'Metairie, LA',
  CURRENT_DATE - INTERVAL '2 days',
  65.00,
  'completed',
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
  created_at
)
VALUES (
  '11111111-1111-1111-1111-111111111104',
  '00000000-0000-0000-0000-000000000001',
  'QA: Cancelled job (Delivery errand)',
  'QA seed: pick up a package from FedEx location and deliver to home address.',
  'delivery',
  'Slidell, LA',
  CURRENT_DATE - INTERVAL '1 day',
  25.00,
  'cancelled',
  now() - INTERVAL '2 days'
)
ON CONFLICT (id) DO NOTHING;

-- Restore normal FK enforcement
SET session_replication_role = DEFAULT;

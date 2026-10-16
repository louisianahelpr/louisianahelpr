-- DECLUTTER, SLICE 5: HELPR DELIVERY (docs/specs/declutter-auctions.md rows
-- 24, 27, 29-30, 38, 40-43; owner 2026-10-16 "Yes, launch with delivery").
-- Build decisions "B59".."B72" are in the spec ("Slice 5 build decisions");
-- the ones the spec left open are marked there "default chosen by lane, owner
-- to confirm".
--
-- TWO PARTS, ONE BOUNDARY.
--
-- PART A, the shared "a Helpr picks up an item at an address and takes it to
-- another address" job flow, prefix helpr_task_* / helpr_tasks. It knows
-- nothing about Declutter: a SOURCE (today only 'declutter_delivery'; Add a
-- Helpr and haul-away are meant to be the next sources) creates a task with
-- helpr_task_create(), and the module calls back into the source through ONE
-- dispatcher per question (helpr_task_source_*). Everything a Helpr does
-- (find, accept with a pickup time, back out, "Picked up" photo at the pickup
-- point, drop-off with the customer's 4-digit code or a door photo at the
-- drop-off point) and the Helpr's pay (jobs' flat fee 5% + 70c, row 42; one
-- payout row per task, executed by the source's money cron) lives here.
--
-- PART B, Declutter's use of it, prefix declutter_delivery_* plus the
-- restated Declutter functions that must know about delivery: the price
-- ($10 + $2 per road mile + size add-ons, row 29; no distance limit, row 30),
-- the buyer's drop-off address (geocoded by the declutter-checkout edge
-- function, never typed coordinates), checkout with 'delivery', opening the
-- task when the order is paid, paying the seller when the delivery is
-- confirmed, the no-Helpr-in-48-h fallback (row 40: the delivery fee goes
-- back, the order becomes a pickup), damage in delivery (row 43).
--
-- MONEY. Nothing here moves money: rows say what is owed and the
-- declutter-money edge function executes them with Stripe (idempotency key =
-- the row id) and reports back. The delivery fee is part of the ONE order
-- charge (row 38: one payment); the Helpr's payout and the seller's payout are
-- both transfers from that charge (source_transaction).
--
-- Restated (each from its NEWEST definition, named beside it): the order
-- amounts freeze trigger, declutter_start_checkout, declutter_my_cart,
-- declutter_record_refund, declutter_complete_handover,
-- declutter_close_paid_order, declutter_handover_sweep, declutter_payouts_due,
-- declutter_refunds_due.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT.
-- Grants by role name, REVOKE ... FROM PUBLIC, anon. Applied 3x by the PGlite
-- proof (src/test/pglite/declutterDelivery.pglite.mjs).

-- ===========================================================================
-- PART A. The shared Helpr pickup-task module.
-- ===========================================================================

-- A1. The Helpr's vehicle (row 41): "I have a truck" (+ "I can bring a second
-- person") with a vehicle photo. Only Helprs with a truck see large and extra
-- large tasks; extra large also needs the second person.
CREATE TABLE IF NOT EXISTS public.helpr_vehicles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_truck boolean NOT NULL DEFAULT false,
  second_person boolean NOT NULL DEFAULT false,
  photo_path text,
  is_seed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helpr_vehicles_truck_photo CHECK (NOT has_truck OR photo_path IS NOT NULL),
  CONSTRAINT helpr_vehicles_second_needs_truck CHECK (NOT second_person OR has_truck)
);
ALTER TABLE public.helpr_vehicles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_vehicles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.helpr_vehicles TO authenticated;
GRANT ALL ON TABLE public.helpr_vehicles TO service_role;
DROP POLICY IF EXISTS "helpr vehicles: owner reads own" ON public.helpr_vehicles;
CREATE POLICY "helpr vehicles: owner reads own" ON public.helpr_vehicles
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- A2. The task. One per source record (UNIQUE source_kind + source_id). The
-- exact addresses and points have NO client privilege: members read a task
-- only through helpr_task_view(), which shows the exact addresses to the
-- assigned Helpr while the task is active and to nobody else.
CREATE TABLE IF NOT EXISTS public.helpr_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('declutter_delivery')),
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',        -- waiting for a Helpr
    'accepted',    -- a Helpr took it and picked a pickup time
    'picked_up',   -- the Helpr has the item ("Picked up" photo at the pickup point)
    'delivered',   -- at the drop-off (door photo); waiting for the customer or 24 h
    'confirmed',   -- done: code, customer's "I got it", 24 h, or an admin; the Helpr is owed
    'unfilled',    -- no Helpr before open_until (row 40)
    'cancelled',   -- the source cancelled it (refund, damage)
    'failed')),    -- damaged in transit (row 43): the Helpr is not paid
  size text NOT NULL CHECK (size IN ('small', 'large', 'xl')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  -- Public to eligible Helprs: area words + rough points (2 decimals ~1 km).
  pickup_area text NOT NULL,
  dropoff_area text NOT NULL,
  -- Private (no client privilege).
  pickup_address text NOT NULL,
  pickup_lat numeric NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng numeric NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  dropoff_address text NOT NULL,
  dropoff_lat numeric NOT NULL CHECK (dropoff_lat BETWEEN -90 AND 90),
  dropoff_lng numeric NOT NULL CHECK (dropoff_lng BETWEEN -180 AND 180),
  trip_miles integer NOT NULL CHECK (trip_miles >= 1),
  -- Money: what the source collected for the Helpr, and the Helpr's fee on it
  -- (jobs' flat 5% + 70c, frozen when the task is created).
  pay_cents integer NOT NULL CHECK (pay_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  -- People: the customer (confirms the drop-off) and the pickup contact. Both
  -- are parties: they see the task's progress, never the other side's data.
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_contact_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  helpr_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  open_until timestamptz NOT NULL,
  latest_pickup_at timestamptz NOT NULL,
  accepted_at timestamptz,
  pickup_slot_start timestamptz,
  releases smallint NOT NULL DEFAULT 0 CHECK (releases BETWEEN 0 AND 100),
  picked_up_at timestamptz,
  pickup_photo_path text,
  delivered_at timestamptz,
  dropoff_photo_path text,
  dropoff_distance_m integer CHECK (dropoff_distance_m IS NULL OR dropoff_distance_m >= 0),
  -- The customer's 4-digit drop-off code (shown to the customer only).
  dropoff_code text NOT NULL CHECK (dropoff_code ~ '^[0-9]{4}$'),
  wrong_codes smallint NOT NULL DEFAULT 0 CHECK (wrong_codes BETWEEN 0 AND 5),
  confirmed_at timestamptz,
  confirmed_by text CHECK (confirmed_by IS NULL OR confirmed_by IN ('code', 'customer', 'auto', 'admin')),
  closed_at timestamptz,
  close_note text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helpr_tasks_one_per_source UNIQUE (source_kind, source_id),
  CONSTRAINT helpr_tasks_fee CHECK (fee_cents <= pay_cents),
  CONSTRAINT helpr_tasks_helpr CHECK ((status IN ('accepted', 'picked_up', 'delivered')) <= (helpr_id IS NOT NULL)),
  CONSTRAINT helpr_tasks_open_no_helpr CHECK (status <> 'open' OR (helpr_id IS NULL AND pickup_slot_start IS NULL)),
  CONSTRAINT helpr_tasks_slot CHECK (status NOT IN ('accepted', 'picked_up', 'delivered') OR pickup_slot_start IS NOT NULL),
  CONSTRAINT helpr_tasks_picked CHECK ((picked_up_at IS NULL) = (pickup_photo_path IS NULL)),
  CONSTRAINT helpr_tasks_delivered CHECK ((delivered_at IS NULL) = (dropoff_photo_path IS NULL)),
  CONSTRAINT helpr_tasks_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)
                                          AND (status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CONSTRAINT helpr_tasks_not_own CHECK (helpr_id IS NULL OR (helpr_id IS DISTINCT FROM customer_id
                                                            AND helpr_id IS DISTINCT FROM pickup_contact_id))
);
CREATE INDEX IF NOT EXISTS helpr_tasks_open_idx ON public.helpr_tasks (open_until) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS helpr_tasks_helpr_idx ON public.helpr_tasks (helpr_id);
CREATE INDEX IF NOT EXISTS helpr_tasks_customer_idx ON public.helpr_tasks (customer_id);
CREATE INDEX IF NOT EXISTS helpr_tasks_contact_idx ON public.helpr_tasks (pickup_contact_id);
CREATE INDEX IF NOT EXISTS helpr_tasks_active_idx ON public.helpr_tasks (status) WHERE status IN ('accepted', 'picked_up', 'delivered');
ALTER TABLE public.helpr_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_tasks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.helpr_tasks TO service_role;
-- No client privilege at all (exact addresses, the drop-off code): helpr_task_view().

-- A3. What happened, in order (evidence for an admin deciding a problem).
CREATE TABLE IF NOT EXISTS public.helpr_task_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.helpr_tasks(id) ON DELETE CASCADE,
  task_event text NOT NULL CHECK (task_event IN ('created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered',
                                     'wrong_code', 'confirmed', 'unfilled', 'cancelled', 'failed', 'pickup_no_show')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS helpr_task_events_task_idx ON public.helpr_task_events (task_id);
CREATE INDEX IF NOT EXISTS helpr_task_events_actor_idx ON public.helpr_task_events (actor_id);
ALTER TABLE public.helpr_task_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_task_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.helpr_task_events TO service_role;

-- A4. The Helpr's payout (row 42: "normal payouts"): one per task, ever.
-- amount = pay - fee. Written when the task is confirmed.
CREATE TABLE IF NOT EXISTS public.helpr_task_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES public.helpr_tasks(id) ON DELETE RESTRICT,
  helpr_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pay_cents integer NOT NULL CHECK (pay_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  amount_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT helpr_task_payouts_amount CHECK (amount_cents = pay_cents - fee_cents AND amount_cents >= 0),
  CONSTRAINT helpr_task_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)),
  CONSTRAINT helpr_task_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS helpr_task_payouts_helpr_idx ON public.helpr_task_payouts (helpr_id);
CREATE INDEX IF NOT EXISTS helpr_task_payouts_due_idx ON public.helpr_task_payouts (next_attempt_at) WHERE status IN ('pending', 'failed');
ALTER TABLE public.helpr_task_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_task_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, task_id, helpr_id, pay_cents, fee_cents, amount_cents, status, created_at, executed_at)
  ON TABLE public.helpr_task_payouts TO authenticated;
GRANT ALL ON TABLE public.helpr_task_payouts TO service_role;
DROP POLICY IF EXISTS "helpr task payouts: helpr reads own" ON public.helpr_task_payouts;
CREATE POLICY "helpr task payouts: helpr reads own" ON public.helpr_task_payouts
  FOR SELECT TO authenticated USING (helpr_id = (SELECT auth.uid()));

-- is_seed at birth from the task (the payouts and events follow their task).
CREATE OR REPLACE FUNCTION public.helpr_task_rows_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT t.is_seed FROM public.helpr_tasks t WHERE t.id = NEW.task_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_rows_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_helpr_task_payouts_seed ON public.helpr_task_payouts;
CREATE TRIGGER trg_helpr_task_payouts_seed BEFORE INSERT ON public.helpr_task_payouts
  FOR EACH ROW EXECUTE FUNCTION public.helpr_task_rows_seed();
-- A vehicle row is seed when its owner's profile is (B16's rule).
CREATE OR REPLACE FUNCTION public.helpr_vehicles_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.user_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_vehicles_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_helpr_vehicles_seed ON public.helpr_vehicles;
CREATE TRIGGER trg_helpr_vehicles_seed BEFORE INSERT ON public.helpr_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.helpr_vehicles_seed();

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- A5. Photos: a PRIVATE bucket (the pickup photo shows the seller's home, the
-- door photo the buyer's; the vehicle photo may show a plate). Paths:
--   <uid>/task/<task id>/<file>   the assigned Helpr, while the task is active
--   <uid>/vehicle/<file>          the owner
-- Read: the uploader, the task's parties and admins (vehicle: owner + admins).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('helpr-tasks', 'helpr-tasks', false, 10 * 1024 * 1024, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.helpr_task_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_n integer;
  v_task uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL THEN RETURN false; END IF;
  v_n := array_length(string_to_array(p_name, '/'), 1);
  IF split_part(p_name, '/', 2) = 'vehicle' AND v_n = 3 AND split_part(p_name, '/', 3) <> '' THEN
    IF p_write THEN
      RETURN split_part(p_name, '/', 1) = v_uid::text;
    END IF;
    RETURN split_part(p_name, '/', 1) = v_uid::text OR public.has_role(v_uid, 'admin');
  END IF;
  IF split_part(p_name, '/', 2) IS DISTINCT FROM 'task' OR v_n IS DISTINCT FROM 4
     OR split_part(p_name, '/', 3) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 4) = '' THEN
    RETURN false;
  END IF;
  v_task := split_part(p_name, '/', 3)::uuid;
  IF p_write THEN
    -- Only the assigned Helpr, into their own folder, while the task is active.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.helpr_tasks t
                    WHERE t.id = v_task AND t.helpr_id = v_uid AND t.status IN ('accepted', 'picked_up'));
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.helpr_tasks t
                  WHERE t.id = v_task
                    AND (t.helpr_id = v_uid OR t.customer_id = v_uid OR t.pickup_contact_id = v_uid
                         OR split_part(p_name, '/', 1) = v_uid::text));
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_photo_access(text, boolean) TO authenticated, service_role;

DROP POLICY IF EXISTS "helpr-tasks: upload into your own folder" ON storage.objects;
CREATE POLICY "helpr-tasks: upload into your own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'helpr-tasks' AND public.helpr_task_photo_access(name, true));
DROP POLICY IF EXISTS "helpr-tasks: the parties and admins read" ON storage.objects;
CREATE POLICY "helpr-tasks: the parties and admins read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'helpr-tasks' AND public.helpr_task_photo_access(name, false));

-- A6. Small helpers.

-- Jobs' flat Helpr fee (roadmap F3; supabase/functions/_shared/helprFlatFee.ts):
-- 5% of the pay rounded to the cent + 70c, never more than the pay.
CREATE OR REPLACE FUNCTION public.helpr_task_fee_cents(p_pay_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN COALESCE(p_pay_cents, 0) <= 0 THEN 0
              ELSE least(p_pay_cents, round(p_pay_cents * 5 / 100.0)::integer + 70) END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_fee_cents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_fee_cents(integer) TO authenticated, service_role;

-- Great-circle metres (haversine).
CREATE OR REPLACE FUNCTION public.helpr_task_distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat2 - p_lat1) / 2)), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians((p_lng2 - p_lng1) / 2)), 2)))))::integer END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_distance_m(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_distance_m(numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_log(p_task uuid, p_kind text, p_actor uuid, p_detail text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.helpr_task_events (task_id, task_event, actor_id, detail) VALUES (p_task, p_kind, p_actor, left(p_detail, 500));
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_log(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_log(uuid, text, uuid, text) TO service_role;

-- A Helpr strike for a task (rows 43, B66): the jobs consequence ladder
-- (user_violations via apply_consequence_ladder), its own violation type,
-- one strike per task and type (idempotent), no job id (a task is not a job).
CREATE OR REPLACE FUNCTION public.helpr_task_give_job_strike(p_user uuid, p_type text, p_task uuid, p_description text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_prior integer;
  v_desc text := left(p_description || ' (task ' || p_task::text || ')', 500);
BEGIN
  IF p_user IS NULL OR p_type NOT IN ('delivery_damage', 'delivery_backed_out', 'delivery_no_show') THEN
    RETURN jsonb_build_object('action', 'none');
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_violations v
              WHERE v.user_id = p_user AND v.violation_type = p_type AND v.description LIKE '%(task ' || p_task::text || ')') THEN
    RETURN jsonb_build_object('action', 'duplicate');
  END IF;
  SELECT count(*) INTO v_prior FROM public.user_violations v
   WHERE v.user_id = p_user AND v.violation_type IN ('delivery_damage', 'delivery_backed_out', 'delivery_no_show');
  RETURN public.apply_consequence_ladder(
    p_user                      => p_user,
    p_violation_type            => p_type,
    p_description               => v_desc,
    p_job_id                    => NULL,
    p_prior_count               => v_prior,
    p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
    p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(
      jsonb_build_object('title', 'Strike on a delivery',
        'message', 'You got a strike on a Helpr delivery. Another one is a final warning.'),
      jsonb_build_object('title', 'Final warning on deliveries',
        'message', 'This is your second delivery strike. One more and your account goes to review.'),
      jsonb_build_object('title', 'Your account is under review',
        'message', 'You got a third delivery strike. Your account is restricted while Louisiana Helpr reviews it.')),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s got delivery strike %s',
    p_ban_reason                => 'Repeated Helpr delivery strikes');
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_give_job_strike(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_give_job_strike(uuid, text, uuid, text) TO service_role;

-- A7. The source boundary. The module asks its source exactly these questions;
-- each is ONE dispatcher with a CASE on source_kind. A new source (Add a
-- Helpr, haul-away) adds its kind to helpr_tasks.source_kind and one branch
-- in each dispatcher, nothing else.

-- Is the source's hidden switch on for the caller? (The module's member RPCs
-- start here: hiding a button is never the protection.)
CREATE OR REPLACE FUNCTION public.helpr_task_source_require_feature(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind = 'declutter_delivery' THEN
    PERFORM public.require_feature('declutter');
  ELSE
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_source_require_feature(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_require_feature(text) TO service_role;

-- Can a Helpr pick up at this time (the source's own times and deadline)?
CREATE OR REPLACE FUNCTION public.helpr_task_source_slot_ok(p_kind text, p_source uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind IS NULL OR p_source IS NULL OR p_start IS NULL THEN RETURN false; END IF;
  IF p_kind = 'declutter_delivery' THEN
    RETURN public.declutter_delivery_slot_ok(p_source, p_start);
  END IF;
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_source_slot_ok(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_slot_ok(text, uuid, timestamptz) TO service_role;

-- Is the money held (an open problem on the source)? A held task is never
-- confirmed except by an admin.
CREATE OR REPLACE FUNCTION public.helpr_task_source_held(p_kind text, p_source uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind = 'declutter_delivery' THEN
    RETURN EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = p_source AND p.status = 'open');
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_source_held(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_held(text, uuid) TO service_role;

-- Something happened to a task: the source reacts (notices, money).
-- Events: accepted, released, picked_up, delivered, confirmed, unfilled,
-- pickup_no_show. Runs inside the caller's transaction and lock.
CREATE OR REPLACE FUNCTION public.helpr_task_source_event(p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.source_kind = 'declutter_delivery' THEN
    RETURN public.declutter_delivery_on_task_event(t.source_id, t.id, p_event, p_by);
  END IF;
  RAISE EXCEPTION 'unknown_task_source' USING ERRCODE = '55000';
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_source_event(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_source_event(uuid, text, text) TO service_role;

-- Lock a task the one way every path does: the SOURCE first (its own lock
-- order), then the task.
CREATE OR REPLACE FUNCTION public.helpr_task_lock(p_task uuid)
RETURNS public.helpr_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.source_kind = 'declutter_delivery' THEN
    PERFORM public.declutter_lock_order(t.source_id);
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task FOR UPDATE;
  RETURN t;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_lock(uuid) TO service_role;

-- A8. The service API a source calls (service only).

-- Create the task (once per source record; a second call returns the first).
CREATE OR REPLACE FUNCTION public.helpr_task_create(p_kind text, p_source uuid, p_size text, p_title text,
  p_pickup_area text, p_pickup_address text, p_pickup_lat numeric, p_pickup_lng numeric,
  p_dropoff_area text, p_dropoff_address text, p_dropoff_lat numeric, p_dropoff_lng numeric,
  p_trip_miles integer, p_pay_cents integer, p_customer uuid, p_pickup_contact uuid,
  p_open_until timestamptz, p_latest_pickup timestamptz, p_is_seed boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.helpr_tasks (source_kind, source_id, size, title, pickup_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_area, dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, customer_id,
    pickup_contact_id, open_until, latest_pickup_at, dropoff_code, is_seed)
  VALUES (p_kind, p_source, p_size, left(p_title, 300), p_pickup_area, p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_dropoff_area, p_dropoff_address, p_dropoff_lat, p_dropoff_lng, greatest(COALESCE(p_trip_miles, 1), 1), p_pay_cents,
    public.helpr_task_fee_cents(p_pay_cents), p_customer, p_pickup_contact, p_open_until, p_latest_pickup,
    public.declutter_new_handover_code(), COALESCE(p_is_seed, false))
  ON CONFLICT (source_kind, source_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.helpr_tasks WHERE source_kind = p_kind AND source_id = p_source;
    RETURN v_id;
  END IF;
  PERFORM public.helpr_task_log(v_id, 'created', NULL, NULL);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_create(text, uuid, text, text, text, text, numeric, numeric, text, text, numeric, numeric,
  integer, integer, uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_create(text, uuid, text, text, text, text, numeric, numeric, text, text, numeric, numeric,
  integer, integer, uuid, uuid, timestamptz, timestamptz, boolean) TO service_role;

-- Confirm the drop-off (caller holds the lock): -> 'confirmed' once, the
-- Helpr's payout row (once, UNIQUE). Never for a held task unless p_by = 'admin'.
CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
      HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  IF p_by IS NULL OR p_by NOT IN ('code', 'customer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_by <> 'admin' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_by, closed_at = now(), updated_at = now()
   WHERE id = t.id AND status IN ('picked_up', 'delivered');
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, t.pay_cents - t.fee_cents,
          CASE WHEN t.pay_cents - t.fee_cents = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     to_char((t.pay_cents - t.fee_cents) / 100.0, 'FM999990.00'))
         ELSE format('$%s is on its way to your payout account.', to_char((t.pay_cents - t.fee_cents) / 100.0, 'FM999990.00')) END,
    '/declutter?view=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_confirm(uuid, text, uuid) TO service_role;

-- Close a task that will not be done (caller holds the lock): 'cancelled' (the
-- source cancelled), 'unfilled' (no Helpr), 'failed' (damaged in transit: the
-- Helpr is not paid). A confirmed task is never closed this way.
CREATE OR REPLACE FUNCTION public.helpr_task_close(p_task uuid, p_status text, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF p_status NOT IN ('cancelled', 'unfilled', 'failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF t.status IN ('confirmed', 'cancelled', 'unfilled', 'failed') THEN
    RETURN t.status;
  END IF;
  UPDATE public.helpr_tasks SET status = p_status, closed_at = now(), close_note = left(p_note, 500), updated_at = now()
   WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, CASE p_status WHEN 'unfilled' THEN 'unfilled' WHEN 'failed' THEN 'failed' ELSE 'cancelled' END,
    NULL, p_note);
  IF t.helpr_id IS NOT NULL AND p_status = 'cancelled' THEN
    PERFORM public.declutter_notify(t.helpr_id, 'info', 'Delivery cancelled',
      'A delivery you took was cancelled. You do not need to go.', '/declutter?view=deliver', t.customer_id);
  END IF;
  RETURN p_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_close(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_close(uuid, text, text) TO service_role;

-- Put a task back up for another Helpr (caller holds the lock). The open
-- window gets at least 24 more hours, never past the latest pickup minus 2 h.
CREATE OR REPLACE FUNCTION public.helpr_task_reopen(p_task uuid, p_kind text, p_actor uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  UPDATE public.helpr_tasks
     SET status = 'open', helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, releases = least(releases + 1, 100),
         open_until = least(greatest(open_until, now() + interval '24 hours'), latest_pickup_at - interval '2 hours'),
         wrong_codes = 0, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, p_kind, p_actor, p_note);
  PERFORM public.helpr_task_source_event(t.id, 'released', p_kind);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_reopen(uuid, text, uuid, text) TO service_role;

-- A9. Member RPCs (the Helpr and the customer). Each VOLATILE one names
-- is_caller_banned() in its own body (Q281 class check). Anyone who may not
-- see a task gets 'task_not_found' (never told it exists).

-- Who may take tasks: not banned, 18+, payout setup done (the Helprs' gate),
-- under 3 Declutter strikes (Declutter's own rule; row 16).
CREATE OR REPLACE FUNCTION public.helpr_task_assert_helpr()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to deliver.';
  END IF;
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'declutter_strikes_blocked' USING ERRCODE = '42501';
  END IF;
  IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete' USING ERRCODE = '42501',
      HINT = 'Set up payouts in Settings before you take a delivery.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_assert_helpr() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_assert_helpr() TO service_role;

-- Stripe mode (owner 2026-10-12): a test account (test_accounts AND a seed
-- profile, the same rule as _shared/stripeMode.ts) runs on the TEST key, and
-- money never moves between a test account and a real one. So a Helpr takes
-- only tasks whose customer is the same kind as them.
CREATE OR REPLACE FUNCTION public.helpr_task_same_stripe_mode(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Unknown people (NULL, e.g. a buyer whose account was deleted) are never a match.
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public.test_accounts ta JOIN public.profiles pr ON pr.user_id = ta.user_id
                   WHERE ta.user_id = p_a AND pr.is_seed IS TRUE))
       = (EXISTS (SELECT 1 FROM public.test_accounts ta JOIN public.profiles pr ON pr.user_id = ta.user_id
                   WHERE ta.user_id = p_b AND pr.is_seed IS TRUE));
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_same_stripe_mode(uuid, uuid) TO service_role;

-- Can this Helpr's vehicle carry this size (row 41)?
CREATE OR REPLACE FUNCTION public.helpr_task_vehicle_fits(p_user uuid, p_size text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- NULL in, false out (an unknown Helpr or size never fits).
  SELECT COALESCE(p_user IS NOT NULL AND (
         p_size = 'small'
      OR (p_size = 'large' AND EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = p_user AND v.has_truck))
      OR (p_size = 'xl' AND EXISTS (SELECT 1 FROM public.helpr_vehicles v WHERE v.user_id = p_user AND v.has_truck AND v.second_person))), false);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_vehicle_fits(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_vehicle_fits(uuid, text) TO service_role;

-- Save the vehicle (row 41). A truck needs a photo in the private bucket.
CREATE OR REPLACE FUNCTION public.helpr_set_vehicle(p_has_truck boolean, p_second_person boolean, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_has_truck IS NULL OR p_second_person IS NULL THEN
    RAISE EXCEPTION 'invalid_vehicle' USING ERRCODE = '22023';
  END IF;
  IF p_second_person AND NOT p_has_truck THEN
    RAISE EXCEPTION 'invalid_vehicle' USING ERRCODE = '22023', HINT = 'A second person is only asked for with a truck.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_has_truck THEN
    IF p_photo_path IS NULL
       OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'vehicle'
       OR split_part(p_photo_path, '/', 3) = ''
       OR split_part(p_photo_path, '/', 4) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'helpr-tasks' AND so.name = p_photo_path) THEN
      RAISE EXCEPTION 'vehicle_photo_required' USING ERRCODE = '22023',
        HINT = 'Add a photo of your truck.';
    END IF;
  ELSE
    p_photo_path := NULL;
  END IF;
  INSERT INTO public.helpr_vehicles (user_id, has_truck, second_person, photo_path, updated_at)
  VALUES (v_uid, p_has_truck, p_second_person, p_photo_path, now())
  ON CONFLICT (user_id) DO UPDATE SET has_truck = EXCLUDED.has_truck, second_person = EXCLUDED.second_person,
    photo_path = EXCLUDED.photo_path, updated_at = now();
  RETURN jsonb_build_object('has_truck', p_has_truck, 'second_person', p_second_person);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_set_vehicle(boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_set_vehicle(boolean, boolean, text) TO authenticated, service_role;

-- Open tasks this Helpr can take, nearest pickup first. Area words and rough
-- miles only (never an address); the take-home pay after the fee. Distance is
-- measured from the ROUNDED pickup point (2 decimals, ~1 km): from the exact
-- point, a Helpr calling this from chosen points could binary-search where
-- miles_to_pickup flips and trilaterate the seller's home (lh-authz-rls
-- review #1, 2026-10-16; row 27).
CREATE OR REPLACE FUNCTION public.helpr_tasks_open_near(p_lat numeric, p_lng numeric, p_limit integer)
RETURNS TABLE (task_id uuid, source_kind text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, miles_to_pickup integer, take_home_cents integer, open_until timestamptz,
               latest_pickup_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.helpr_task_source_require_feature('declutter_delivery');
  v_uid := public.helpr_task_assert_helpr();
  IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT t.id, t.source_kind, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles,
         CASE WHEN p_lat IS NULL THEN NULL
              ELSE greatest(1, ceil(public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) / 1609.344))::integer END,
         t.pay_cents - t.fee_cents, t.open_until, t.latest_pickup_at
    FROM public.helpr_tasks t
   WHERE t.status = 'open' AND t.open_until > now()
     AND v_uid IS DISTINCT FROM t.customer_id AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND public.helpr_task_vehicle_fits(v_uid, t.size)
     AND NOT public.are_users_blocked(v_uid, t.customer_id)
     AND NOT public.are_users_blocked(v_uid, t.pickup_contact_id)
     AND public.helpr_task_same_stripe_mode(v_uid, t.customer_id)
   ORDER BY CASE WHEN p_lat IS NULL THEN 0 ELSE public.helpr_task_distance_m(p_lat, p_lng, round(t.pickup_lat, 2), round(t.pickup_lng, 2)) END, t.open_until
   LIMIT least(greatest(COALESCE(p_limit, 50), 1), 100);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_tasks_open_near(numeric, numeric, integer) TO authenticated, service_role;

-- One task as the caller may see it:
--   the assigned Helpr: everything but the drop-off code, exact addresses
--     while active (accepted / picked up / delivered);
--   an eligible Helpr on an OPEN task: area words only;
--   the customer: status, times, photos, the drop-off code while it is due;
--   the pickup contact: status, times, photos.
-- Anyone else: task_not_found.
CREATE OR REPLACE FUNCTION public.helpr_task_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_role text;
  v_active boolean;
  v_helpr_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_role := CASE WHEN t.helpr_id = v_uid THEN 'helpr'
                 WHEN t.customer_id = v_uid THEN 'customer'
                 WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact' END;
  IF v_role IS NULL THEN
    -- An open task is visible to a Helpr who could take it (area words only).
    PERFORM public.helpr_task_source_require_feature(t.source_kind);
    PERFORM public.helpr_task_assert_helpr();
    IF t.status <> 'open' OR NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_role := 'candidate';
  END IF;
  v_active := t.status IN ('accepted', 'picked_up', 'delivered');
  SELECT NULLIF(split_part(btrim(COALESCE(pr.full_name, '')), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents - t.fee_cents END,
    'pay_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents END,
    'fee_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.fee_cents END,
    'open_until', t.open_until, 'latest_pickup_at', t.latest_pickup_at,
    'pickup_slot_start', t.pickup_slot_start, 'accepted_at', t.accepted_at,
    'picked_up_at', t.picked_up_at, 'delivered_at', t.delivered_at, 'confirmed_at', t.confirmed_at,
    'confirmed_by', t.confirmed_by,
    'helpr_first_name', CASE WHEN v_role IN ('customer', 'pickup_contact') THEN v_helpr_name END,
    'pickup_address', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_address END,
    'pickup_lat', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lat END,
    'pickup_lng', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lng END,
    'dropoff_address', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_role = 'helpr' AND t.status IN ('picked_up', 'delivered') THEN t.dropoff_lng END,
    'dropoff_code', CASE WHEN v_role = 'customer' AND t.status IN ('accepted', 'picked_up', 'delivered') THEN t.dropoff_code END,
    'code_locked', t.wrong_codes >= 5,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_view(uuid) TO authenticated, service_role;

-- The caller's own tasks as the Helpr (active first, then the last 30 days).
CREATE OR REPLACE FUNCTION public.helpr_my_tasks()
RETURNS TABLE (task_id uuid, status text, size text, title text, pickup_area text, dropoff_area text,
               trip_miles integer, take_home_cents integer, pickup_slot_start timestamptz, payout_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.status, t.size, t.title, t.pickup_area, t.dropoff_area, t.trip_miles, t.pay_cents - t.fee_cents,
         t.pickup_slot_start, p.status
    FROM public.helpr_tasks t
    LEFT JOIN public.helpr_task_payouts p ON p.task_id = t.id
   WHERE t.helpr_id = v_uid
     AND (t.status IN ('accepted', 'picked_up', 'delivered') OR t.updated_at > now() - interval '30 days')
   ORDER BY (t.status IN ('accepted', 'picked_up', 'delivered')) DESC, t.pickup_slot_start
   LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_my_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_my_tasks() TO authenticated, service_role;

-- Take a task with a pickup time (B63: inside the source's pickup times,
-- before its deadline). First Helpr wins (row lock + status predicate).
CREATE OR REPLACE FUNCTION public.helpr_task_accept(p_task_id uuid, p_pickup_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  t public.helpr_tasks;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  v_uid := public.helpr_task_assert_helpr();
  IF v_uid IN (t.customer_id, t.pickup_contact_id) THEN
    RAISE EXCEPTION 'own_task' USING ERRCODE = '42501', HINT = 'You cannot deliver your own sale.';
  END IF;
  IF public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
     OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.helpr_task_vehicle_fits(v_uid, t.size) THEN
    RAISE EXCEPTION 'vehicle_too_small' USING ERRCODE = '42501',
      HINT = 'This item needs a truck (and a second person for extra large). Add your truck under Your vehicle.';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.status <> 'open' OR t.open_until <= now() THEN
    RAISE EXCEPTION 'task_taken' USING ERRCODE = '55000', HINT = 'Another Helpr took this delivery, or it closed.';
  END IF;
  IF p_pickup_slot_start IS NULL OR p_pickup_slot_start <= now()
     OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at
     OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, inside the seller''s pickup times.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'accepted', helpr_id = v_uid, accepted_at = now(), pickup_slot_start = p_pickup_slot_start, updated_at = now()
   WHERE id = t.id AND status = 'open';
  PERFORM public.helpr_task_log(t.id, 'accepted', v_uid, to_char(p_pickup_slot_start, 'YYYY-MM-DD"T"HH24:MI:SSOF'));
  PERFORM public.helpr_task_source_event(t.id, 'accepted', NULL);
  RETURN jsonb_build_object('result', 'accepted', 'pickup_slot_start', p_pickup_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_accept(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_accept(uuid, timestamptz) TO authenticated, service_role;

-- The Helpr backs out before the pickup (B64). Within 2 hours of the pickup
-- time it costs a delivery strike; the task goes back up for another Helpr.
CREATE OR REPLACE FUNCTION public.helpr_task_release(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_late boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000',
      HINT = 'You already have the item. Deliver it, or report a problem.';
  END IF;
  v_late := now() > t.pickup_slot_start - interval '2 hours';
  PERFORM public.helpr_task_reopen(t.id, 'released', v_uid, CASE WHEN v_late THEN 'late' END);
  IF v_late THEN
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id,
      'Backed out of a Helpr delivery less than 2 hours before the pickup time');
  END IF;
  RETURN jsonb_build_object('result', 'released', 'strike', v_late);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_release(uuid) TO authenticated, service_role;

-- A photo path of this task's Helpr in the private bucket that exists.
CREATE OR REPLACE FUNCTION public.helpr_task_photo_ok(p_task uuid, p_uid uuid, p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- NULL in, false out.
  SELECT COALESCE(p_path IS NOT NULL AND p_uid IS NOT NULL AND p_task IS NOT NULL
     AND split_part(p_path, '/', 1) = p_uid::text
     AND split_part(p_path, '/', 2) = 'task'
     AND split_part(p_path, '/', 3) = p_task::text
     AND split_part(p_path, '/', 4) <> ''
     AND split_part(p_path, '/', 5) = ''
     AND EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'helpr-tasks' AND so.name = p_path), false);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_photo_ok(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_photo_ok(uuid, uuid, text) TO service_role;

-- "Picked up" (row 43: pickup photo): the Helpr, at the pickup point
-- (<= 200 m; the distance is checked, the Helpr's position is not stored).
CREATE OR REPLACE FUNCTION public.helpr_task_picked_up(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'picked_up' THEN
    RETURN jsonb_build_object('result', 'already_picked_up');
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.helpr_tasks SET status = 'picked_up', picked_up_at = now(), pickup_photo_path = p_photo_path, updated_at = now()
   WHERE id = t.id AND status = 'accepted';
  PERFORM public.helpr_task_log(t.id, 'picked_up', v_uid, v_m::text || ' m');
  PERFORM public.helpr_task_source_event(t.id, 'picked_up', NULL);
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_picked_up(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_picked_up(uuid, text, numeric, numeric) TO authenticated, service_role;

-- The drop-off (B65). The Helpr, at the drop-off point (<= 200 m), with a
-- photo. With the customer's 4-digit code: confirmed now (the seller and the
-- Helpr are paid). Without it (nobody home): left at the door, and the
-- customer taps "I got it" or it confirms 24 h later unless they report a
-- problem. Wrong codes are counted and RETURNED (5 = locked; the door photo
-- path still works).
CREATE OR REPLACE FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric,
  p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  p_code := NULLIF(btrim(p_code), '');
  IF p_code IS NOT NULL THEN
    IF t.wrong_codes >= 5 THEN
      RETURN jsonb_build_object('result', 'code_locked');
    END IF;
    IF p_code IS DISTINCT FROM t.dropoff_code THEN
      UPDATE public.helpr_tasks SET wrong_codes = wrong_codes + 1, updated_at = now() WHERE id = t.id;
      PERFORM public.helpr_task_log(t.id, 'wrong_code', v_uid, NULL);
      RETURN jsonb_build_object('result', 'wrong_code', 'attempts_left', 4 - t.wrong_codes);
    END IF;
  END IF;
  IF t.status = 'picked_up' THEN
    IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng);
    -- 200 m from the drop-off point; with the right code from the buyer (checked
    -- above: the buyer is there in person) 1 km, so a point the geocoder put a
    -- little off never leaves the Helpr unable to finish (lh-money-escrow
    -- review #4, 2026-10-16).
    IF v_m IS NULL OR v_m > (CASE WHEN p_code IS NULL THEN 200 ELSE 1000 END) THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the drop-off address.';
    END IF;
    UPDATE public.helpr_tasks
       SET status = 'delivered', delivered_at = now(), dropoff_photo_path = p_photo_path, dropoff_distance_m = v_m, updated_at = now()
     WHERE id = t.id AND status = 'picked_up';
    PERFORM public.helpr_task_log(t.id, 'delivered', v_uid, v_m::text || ' m');
  END IF;
  IF p_code IS NOT NULL AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    v_out := public.helpr_task_source_event(t.id, 'confirmed', 'code');
    RETURN COALESCE(v_out, '{}'::jsonb) || jsonb_build_object('result', 'confirmed', 'distance_m', v_m);
  END IF;
  -- The "Delivered" notice goes out once, on the step itself; a repeat call
  -- on a task already at the door says so again without re-sending it
  -- (lh-silent-failure #5, lh-authz-rls #9).
  IF t.status = 'picked_up' THEN
    PERFORM public.helpr_task_source_event(t.id, 'delivered', NULL);
  END IF;
  RETURN jsonb_build_object('result', 'delivered', 'distance_m', v_m,
    'held', public.helpr_task_source_held(t.source_kind, t.source_id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_delivered(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_delivered(uuid, text, numeric, numeric, text) TO authenticated, service_role;

-- "The seller wasn't there" (B67): the Helpr, from 15 minutes after the
-- pickup time, before picking up. The source decides what that means.
CREATE OR REPLACE FUNCTION public.helpr_task_pickup_no_show(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'accepted' THEN
    RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
  END IF;
  IF now() < t.pickup_slot_start + interval '15 minutes' THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the pickup time.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  -- Evidence, as for "Picked up": a photo taken at the pickup point (<= 200 m).
  -- The Helpr's word alone never cancels a sale (lh-authz-rls #3 /
  -- lh-money-escrow #5, 2026-10-16: a Helpr could take the item without
  -- tapping "Picked up" and then claim the seller was away).
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  PERFORM public.helpr_task_log(t.id, 'pickup_no_show', v_uid, format('%s m; photo %s', v_m, p_photo_path));
  -- The source decides through a person (Declutter: a problem for an admin).
  RETURN public.helpr_task_source_event(t.id, 'pickup_no_show', v_m::text);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_pickup_no_show(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_pickup_no_show(uuid, text, numeric, numeric) TO authenticated, service_role;

-- A10. The sweep (cron 'helpr-tasks', every 10 min at :04), each task
-- re-checked under its own lock; one bad task never stops the rest:
--   (a) open past open_until            -> unfilled (the source refunds, row 40)
--   (b) accepted, not picked up 2 h after the pickup time -> the Helpr is a
--       no-show: delivery strike, back up for another Helpr (B64)
--   (c) delivered (door photo), 24 h, nothing held -> confirmed 'auto'
CREATE OR REPLACE FUNCTION public.helpr_task_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  t public.helpr_tasks;
  v_unfilled integer := 0;
  v_noshow integer := 0;
  v_auto integer := 0;
BEGIN
  FOR r IN SELECT x.id FROM public.helpr_tasks x WHERE x.status = 'open' AND x.open_until <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'open' AND t.open_until <= now() THEN
        PERFORM public.helpr_task_close(t.id, 'unfilled', 'No Helpr took it in time');
        PERFORM public.helpr_task_source_event(t.id, 'unfilled', NULL);
        v_unfilled := v_unfilled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'accepted' AND x.pickup_slot_start + interval '2 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- A problem on the source (e.g. the Helpr's "the seller wasn't there")
      -- freezes the task: an admin decides, the Helpr is not a no-show.
      IF t.status = 'accepted' AND t.pickup_slot_start + interval '2 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', NULL, 'not picked up 2 h after the pickup time');
        PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
          'Did not pick up a Helpr delivery within 2 hours of the pickup time');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;

-- A11. The Helpr payout queue is defined at the end of the file (it asks
-- the Declutter source for its charge, defined in part B).

-- What Stripe did with a Helpr payout. Succeeded is final; a failure counts an
-- attempt and backs off (10 min x 2^n, max 1 day; 12 tries).
CREATE OR REPLACE FUNCTION public.helpr_task_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.helpr_task_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payout_executed(uuid, text, boolean, text) TO service_role;

-- ===========================================================================
-- PART B. Declutter delivery.
-- ===========================================================================

-- B1. Orders carry the delivery fee. total = items + buyer's fee + tax +
-- delivery (one payment, row 38). handover gains 'delivery'.
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS delivery_cents integer NOT NULL DEFAULT 0;
-- DESTRUCTIVE-DDL-ACK: declutter_orders_total, declutter_orders_handover_check and
-- declutter_orders_delivery are dropped only to be re-added in the same statement block
-- with the delivery fee in them (every existing row has delivery_cents = 0 and a
-- pickup/porch handover, so each new CHECK holds for every row already there). No data
-- is dropped. Reviewed by lane declutter-delivery 2026-10-16.
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_total;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_total
    CHECK (total_cents = items_cents + premium_cents + tax_cents + delivery_cents);
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_handover_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_handover_check
    CHECK (handover IN ('pickup_home', 'porch', 'delivery'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_delivery;
  -- A delivery order always carries its fee; after the no-Helpr fallback the
  -- order becomes a pickup and KEEPS the fee it was paid (refunded separately).
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_delivery
    CHECK (delivery_cents >= 0 AND (handover <> 'delivery' OR delivery_cents >= 1000));
END
$do$;
GRANT SELECT (delivery_cents) ON TABLE public.declutter_orders TO authenticated;

-- The amounts freeze (restated from 20261015023613) names delivery_cents too.
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.fee_rule IS DISTINCT FROM OLD.fee_rule OR NEW.premium_cents IS DISTINCT FROM OLD.premium_cents
     OR NEW.items_cents IS DISTINCT FROM OLD.items_cents OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     -- tax_cents too (money review 1.1): the total CHECK already ties it to the three frozen
     -- amounts, but the freeze names every amount the buyer was shown, so no later CHECK
     -- change can make the tax line the one number a writer may move.
     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
     -- Slice 5: the delivery fee the buyer was shown.
     OR NEW.delivery_cents IS DISTINCT FROM OLD.delivery_cents THEN
    RAISE EXCEPTION 'order_amounts_frozen' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the only handover change ever allowed is the no-Helpr fallback
  -- (row 40), delivery -> pickup at the seller's home, on a paid order.
  IF NEW.handover IS DISTINCT FROM OLD.handover
     AND NOT (OLD.handover = 'delivery' AND NEW.handover = 'pickup_home' AND OLD.status = 'paid') THEN
    RAISE EXCEPTION 'order_handover_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_frozen() FROM PUBLIC, anon, authenticated;

-- B2. The price (row 29): $10 + $2 per road mile + per item $0 small / $20
-- large / $40 extra large; one base + miles per checkout (row 38).
CREATE OR REPLACE FUNCTION public.declutter_delivery_price_cents(p_miles integer, p_sizes text[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT 1000 + 200 * greatest(COALESCE(p_miles, 1), 1)
         + COALESCE((SELECT sum(CASE s WHEN 'large' THEN 2000 WHEN 'xl' THEN 4000 ELSE 0 END)::integer
                       FROM unnest(COALESCE(p_sizes, '{}'::text[])) s), 0);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_price_cents(integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_price_cents(integer, text[]) TO authenticated, service_role;

-- Road miles (B60, default chosen by lane): there is no server-side road
-- routing in the app (drive time exists only on the device, MapKit), so the
-- server estimates: straight-line miles x 1.3 (a usual road-to-crow ratio),
-- rounded UP to a whole mile, at least 1. One function: swap it for a routing
-- service later and every price follows.
CREATE OR REPLACE FUNCTION public.declutter_road_miles(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) IS NULL THEN NULL
    ELSE greatest(1, ceil(public.helpr_task_distance_m(p_lat1, p_lng1, p_lat2, p_lng2) / 1609.344 * 1.3))::integer END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_road_miles(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_road_miles(numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- B3. The buyer's drop-off address, per seller they check out with. Written
-- ONLY by the declutter-checkout edge function (service role), which geocodes
-- the typed address on the server: a buyer can never pick the coordinates
-- the price is measured from. The buyer reads their own address and area.
CREATE TABLE IF NOT EXISTS public.declutter_delivery_dropoffs (
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 300),
  area_label text NOT NULL CHECK (char_length(btrim(area_label)) BETWEEN 1 AND 120),
  lat numeric NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric NOT NULL CHECK (lng BETWEEN -180 AND 180),
  is_seed boolean NOT NULL DEFAULT false,
  geocoded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, seller_id),
  CONSTRAINT declutter_delivery_dropoffs_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_delivery_dropoffs_seller_idx ON public.declutter_delivery_dropoffs (seller_id);
ALTER TABLE public.declutter_delivery_dropoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_dropoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT (buyer_id, seller_id, address, area_label, geocoded_at) ON TABLE public.declutter_delivery_dropoffs TO authenticated;
GRANT ALL ON TABLE public.declutter_delivery_dropoffs TO service_role;
DROP POLICY IF EXISTS "declutter dropoffs: buyer reads own" ON public.declutter_delivery_dropoffs;
CREATE POLICY "declutter dropoffs: buyer reads own" ON public.declutter_delivery_dropoffs
  FOR SELECT TO authenticated USING (buyer_id = (SELECT auth.uid()));

-- The frozen delivery of an order (one per delivery order, written by checkout).
CREATE TABLE IF NOT EXISTS public.declutter_order_deliveries (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  dropoff_address text NOT NULL,
  dropoff_area text NOT NULL,
  dropoff_lat numeric NOT NULL,
  dropoff_lng numeric NOT NULL,
  road_miles integer NOT NULL CHECK (road_miles >= 1),
  size text NOT NULL CHECK (size IN ('small', 'large', 'xl')),
  delivery_cents integer NOT NULL CHECK (delivery_cents >= 1000),
  task_id uuid REFERENCES public.helpr_tasks(id) ON DELETE SET NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_order_deliveries_task_idx ON public.declutter_order_deliveries (task_id);
ALTER TABLE public.declutter_order_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_deliveries TO service_role;

-- The delivery fee given back on its own (row 40, no Helpr; or the delivery
-- never happened on an order the admin paid the seller for). One per order.
-- Executed by declutter-money (key `declutter-delivery-refund-<id>`), never
-- through declutter_refunds (that table is one row per payment).
CREATE TABLE IF NOT EXISTS public.declutter_delivery_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  stripe_payment_intent_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('no_helpr', 'delivery_not_done')),
  refund_cents integer NOT NULL CHECK (refund_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  stripe_refund_ref text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);
ALTER TABLE public.declutter_delivery_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_delivery_refunds TO service_role;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['declutter_order_deliveries', 'declutter_delivery_refunds'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_seed ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_seed BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.declutter_order_rows_seed()', t, t);
  END LOOP;
END
$do$;
CREATE OR REPLACE FUNCTION public.declutter_delivery_dropoffs_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.buyer_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_dropoffs_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_delivery_dropoffs_seed ON public.declutter_delivery_dropoffs;
CREATE TRIGGER trg_declutter_delivery_dropoffs_seed BEFORE INSERT ON public.declutter_delivery_dropoffs
  FOR EACH ROW EXECUTE FUNCTION public.declutter_delivery_dropoffs_seed();
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- Store the geocoded drop-off (service only: the edge function geocoded it).
CREATE OR REPLACE FUNCTION public.declutter_set_delivery_dropoff(p_buyer uuid, p_seller uuid, p_address text,
  p_area_label text, p_lat numeric, p_lng numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_buyer IS NULL OR p_seller IS NULL OR p_buyer = p_seller THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_address IS NULL OR char_length(btrim(p_address)) NOT BETWEEN 5 AND 300
     OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, address, area_label, lat, lng, geocoded_at)
  VALUES (p_buyer, p_seller, btrim(p_address), left(COALESCE(NULLIF(btrim(p_area_label), ''), 'Drop-off area'), 120),
          round(p_lat, 6), round(p_lng, 6), now())
  ON CONFLICT (buyer_id, seller_id) DO UPDATE SET address = EXCLUDED.address, area_label = EXCLUDED.area_label,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, geocoded_at = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_delivery_dropoff(uuid, uuid, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_set_delivery_dropoff(uuid, uuid, text, text, numeric, numeric) TO service_role;

-- The delivery for a buyer's cart lines with one seller, computed from the
-- server's own data (the items' private pickup points, the stored drop-off).
-- p_lines NULL = every in-cart line inside its 48 h. Refusals:
--   delivery_address_needed  no drop-off stored yet (or older than 24 h)
--   delivery_one_address     the items are at more than one address (B61)
CREATE OR REPLACE FUNCTION public.declutter_delivery_compute(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (road_miles integer, size text, delivery_cents integer, base_cents integer, per_mile_cents integer,
               size_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric, dropoff_address text,
               dropoff_area text, dropoff_lat numeric, dropoff_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d public.declutter_delivery_dropoffs;
  v_sizes text[];
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_far integer;
  v_miles integer;
BEGIN
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023',
      HINT = 'Enter the address to deliver to.';
  END IF;
  SELECT array_agg(i.delivery_size ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1]
    INTO v_sizes, v_addr, v_lat, v_lng
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_sizes IS NULL OR cardinality(v_sizes) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000';
  END IF;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'delivery_unavailable' USING ERRCODE = '22023';
  END IF;
  -- B61: one pickup stop. Every item within 200 m of the first one's address.
  SELECT max(public.helpr_task_distance_m(v_lat, v_lng, p.pickup_lat, p.pickup_lng)) INTO v_far
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.buyer_id = p_buyer AND c.seller_id = p_seller
     AND (CASE WHEN p_lines IS NULL THEN c.status = 'in_cart' AND c.checkout_by > now() ELSE c.id = ANY (p_lines) END);
  IF v_far IS NULL OR v_far > 200 THEN
    RAISE EXCEPTION 'delivery_one_address' USING ERRCODE = '22023',
      HINT = 'These items are at different addresses, so they can''t be delivered together. Choose pickup.';
  END IF;
  -- Priced from the ROUNDED pickup point (2 decimals, ~1 km), never the exact
  -- one: the buyer chooses the drop-off, so a price measured from the exact
  -- point would let a buyer with an unpaid cart line trilaterate the seller's
  -- home by quoting chosen addresses (lh-authz-rls review #2, 2026-10-16; row
  -- 27). The error is at most about a mile, about $2.
  v_miles := public.declutter_road_miles(round(v_lat, 2), round(v_lng, 2), d.lat, d.lng);
  RETURN QUERY SELECT v_miles,
    CASE WHEN 'xl' = ANY (v_sizes) THEN 'xl' WHEN 'large' = ANY (v_sizes) THEN 'large' ELSE 'small' END,
    public.declutter_delivery_price_cents(v_miles, v_sizes),
    1000, 200 * v_miles, public.declutter_delivery_price_cents(v_miles, v_sizes) - 1000 - 200 * v_miles,
    v_addr, v_lat, v_lng, d.address, d.area_label, d.lat, d.lng;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_compute(uuid, uuid, uuid[]) TO service_role;

-- The buyer's delivery quote for their cart with one seller (no address,
-- coordinates or pickup point in the answer: miles + the price lines).
CREATE OR REPLACE FUNCTION public.declutter_delivery_quote(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  q record;
BEGIN
  PERFORM public.require_feature('declutter');
  v_uid := public.declutter_assert_member(true);
  IF p_seller_id IS NULL OR public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, NULL);
  RETURN jsonb_build_object('road_miles', q.road_miles, 'size', q.size, 'delivery_cents', q.delivery_cents,
    'base_cents', q.base_cents, 'per_mile_cents', q.per_mile_cents, 'size_cents', q.size_cents,
    'dropoff_area', q.dropoff_area);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_quote(uuid) TO authenticated, service_role;

-- Can a Helpr pick this order up at p_start? Inside the seller's pickup times
-- (row 52), in the future, before the 7-day pickup deadline (row 14).
CREATE OR REPLACE FUNCTION public.declutter_delivery_slot_ok(p_order_id uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = p_order_id AND o.status = 'paid' AND o.handover = 'delivery'
                    AND p_start > now() AND p_start + interval '30 minutes' <= o.paid_at + interval '7 days'
                    AND public.declutter_slot_in_windows(o.seller_id, p_start));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_slot_ok(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_slot_ok(uuid, timestamptz) TO service_role;

-- Refunds Stripe has CONFIRMED sent on the order's own charge: what the
-- Helpr's and the seller's payouts may expect that charge to have given back.
-- Only the order's PaymentIntent (a duplicate payment's refund is on another
-- charge) and only 'succeeded' rows (a pending or failed row has not moved
-- money): counting either would let an unknown refund of the same size pass
-- declutter-money's whole-charge check (lh-money-escrow review #2,
-- 2026-10-16). A refund Stripe sent before its row says so only makes the
-- payout wait a run, never pass early.
CREATE OR REPLACE FUNCTION public.declutter_order_refunds_recorded_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (COALESCE((SELECT sum(r.refund_cents) FROM public.declutter_refunds r
                     WHERE r.order_id = o.id AND r.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND r.status = 'succeeded'), 0)
        + COALESCE((SELECT sum(d.refund_cents) FROM public.declutter_delivery_refunds d
                     WHERE d.order_id = o.id AND d.stripe_payment_intent_id = o.stripe_payment_intent_id
                       AND d.status = 'succeeded'), 0))::integer
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_refunds_recorded_cents(uuid) TO service_role;

-- How much of an order's delivery fee is NOT the buyer's to get back in an
-- order refund: already refunded on its own, or owed to a Helpr who picked
-- the item up (B69). 0 on a pickup/porch order.
CREATE OR REPLACE FUNCTION public.declutter_delivery_reserved_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN o.delivery_cents = 0 THEN 0
    WHEN EXISTS (SELECT 1 FROM public.declutter_delivery_refunds d WHERE d.order_id = o.id) THEN o.delivery_cents
    WHEN EXISTS (SELECT 1 FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
                  WHERE od.order_id = o.id AND t.status IN ('picked_up', 'delivered', 'confirmed')) THEN o.delivery_cents
    ELSE 0 END
    FROM public.declutter_orders o WHERE o.id = p_order_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_reserved_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_reserved_cents(uuid) TO service_role;

-- Give the delivery fee back on its own (caller holds the order lock).
CREATE OR REPLACE FUNCTION public.declutter_delivery_refund(p_order_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'no_delivery_fee' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, o.delivery_cents)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.declutter_delivery_refunds WHERE order_id = o.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund(uuid, text) TO service_role;

-- B4. Checkout, restated from 20261016050402 (porch default) with Helpr
-- delivery: allowed when the cart can be delivered (one address, a drop-off
-- stored); the fee is computed HERE from server data and frozen on the order
-- (with the drop-off) in the same statement. The idempotent return compares
-- the delivery too, so a new drop-off address makes a new order.
-- The answer gains delivery_cents (last column), so the Stripe page can carry
-- the delivery line: a new return type, so the function is dropped first.
DROP FUNCTION IF EXISTS public.declutter_start_checkout(uuid, text);
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_dropoff_key text;
  q record;
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, or Helpr delivery.';
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off).
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key THEN
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The delivery fee is not part of the item total (row 29 prices it alone).
  v_premium := public.declutter_buyer_fee_cents(v_items);
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text) TO authenticated, service_role;

-- B5. The cart, restated from 20261016050402 with the order's delivery fee
-- and its Helpr task (the buyer and the seller read the task's progress with
-- helpr_task_view) appended.
DROP FUNCTION IF EXISTS public.declutter_my_cart();
CREATE OR REPLACE FUNCTION public.declutter_my_cart()
RETURNS TABLE (line_id uuid, item_id uuid, item_title text, my_side text, seller_id uuid,
               price_cents integer, status text, checkout_by timestamptz, order_id uuid,
               order_status text, handover text, premium_cents integer, total_cents integer,
               porch_ok boolean, delivery_cents integer, delivery_task_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.item_id, i.title,
         CASE WHEN c.seller_id = v_uid THEN 'seller' ELSE 'buyer' END,
         c.seller_id, c.price_cents, c.status, c.checkout_by, c.order_id,
         o.status, o.handover, o.premium_cents, o.total_cents,
         i.porch_ok, o.delivery_cents, od.task_id
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    LEFT JOIN public.declutter_orders o ON o.id = c.order_id
    LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id
   WHERE (c.buyer_id = v_uid OR c.seller_id = v_uid)
     AND (c.status = 'in_cart' OR c.created_at > now() - interval '30 days')
   ORDER BY (c.status = 'in_cart') DESC, c.checkout_by
   LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_cart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated, service_role;

-- B6. Paid delivery order -> its Helpr task (row 42: delivery is a Helpr job).
-- An AFTER UPDATE trigger, so every path that marks an order paid (the
-- webhook, B41's late in-time payment) opens it; idempotent.
-- open_until = paid + 48 h (row 40); latest pickup = the 7-day deadline.
CREATE OR REPLACE FUNCTION public.declutter_delivery_open_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  od public.declutter_order_deliveries;
  v_task uuid;
  v_title text;
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_area text;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.handover <> 'delivery' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO od FROM public.declutter_order_deliveries WHERE order_id = NEW.id;
  IF NOT FOUND OR od.task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(i.title, ', ' ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1],
         (array_agg(i.area_label ORDER BY c.id))[1]
    INTO v_title, v_addr, v_lat, v_lng, v_area
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = NEW.id;
  v_task := public.helpr_task_create('declutter_delivery', NEW.id, od.size, COALESCE(v_title, 'Declutter delivery'),
    COALESCE(v_area, 'Louisiana'), v_addr, v_lat, v_lng,
    od.dropoff_area, od.dropoff_address, od.dropoff_lat, od.dropoff_lng, od.road_miles, NEW.delivery_cents,
    NEW.buyer_id, NEW.seller_id,
    least(COALESCE(NEW.paid_at, now()) + interval '48 hours', COALESCE(NEW.paid_at, now()) + interval '7 days' - interval '2 hours'),
    COALESCE(NEW.paid_at, now()) + interval '7 days', NEW.is_seed);
  UPDATE public.declutter_order_deliveries SET task_id = v_task WHERE order_id = NEW.id;
  PERFORM public.declutter_notify(NEW.seller_id, 'payment', 'A Helpr will pick it up',
    'Your buyer chose Helpr delivery. We''re finding a Helpr; you''ll be told the pickup time.', '/declutter?view=cart', NEW.buyer_id);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_open_task() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_delivery_task ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_delivery_task AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_delivery_open_task();

-- A delivery order has no seller booking: the Helpr picks the time (B63).
-- book_pickup (and with it the porch and no-show paths, which need a
-- booking) is refused for one, at the table, whichever function writes.
CREATE OR REPLACE FUNCTION public.declutter_bookings_not_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'delivery') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'A Helpr is delivering this order and picks the pickup time.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bookings_not_delivery() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_bookings_not_delivery ON public.declutter_bookings;
CREATE TRIGGER trg_declutter_bookings_not_delivery BEFORE INSERT ON public.declutter_bookings
  FOR EACH ROW EXECUTE FUNCTION public.declutter_bookings_not_delivery();

-- B7. Declutter's answers to the task module (the source side of A7).
CREATE OR REPLACE FUNCTION public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_out jsonb;
  v_refund uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF p_event = 'accepted' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'A Helpr took your delivery',
      format('Pickup from the seller is %s. You''ll get your drop-off code here.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up your item %s. Have it ready.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      'Your Helpr can''t make it. Your delivery is back up for another Helpr.', '/declutter?view=cart', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      'The Helpr can''t make it. You''ll be told the new pickup time.', '/declutter?view=cart', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on its way',
      'The Helpr picked up your item. Have your 4-digit code ready for the drop-off.', '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      'The Helpr picked up your item. You''re paid when the buyer has it.', '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      'The Helpr left your item at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'confirmed' THEN
    -- The handover IS the delivery: the seller is paid (and the Helpr, below).
    v_out := public.declutter_complete_handover(o.id,
      CASE p_by WHEN 'code' THEN 'code' WHEN 'customer' THEN 'buyer' WHEN 'admin' THEN 'admin' ELSE 'auto' END);
    RETURN v_out;
  ELSIF p_event = 'unfilled' THEN
    -- Row 40: no Helpr in 48 h. The delivery fee goes back in full; the order
    -- becomes a pickup at the seller's home; the 7-day clock keeps running.
    IF o.status = 'paid' AND o.handover = 'delivery' THEN
      v_refund := public.declutter_delivery_refund(o.id, 'no_helpr');
      -- B76: a Helpr who backed out or never came late in the week can leave
      -- the buyer too little time to book a pickup, and the handover sweep
      -- would then close it as the BUYER's no-show (strike, fee kept). With
      -- under 48 h to the 7-day deadline the sale is closed instead as no one's
      -- fault: the delivery fee back in full (above), the rest under the
      -- no-fault policy (row 100: the card fee is kept), no strike, the item
      -- back on sale.
      IF o.paid_at + interval '7 days' < now() + interval '48 hours' THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your delivery fell through',
          'No Helpr could deliver in time, so this sale is cancelled. Your delivery fee and your payment are coming back to your card.',
          '/declutter?view=cart', o.seller_id);
        v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
        RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund, 'closed', v_out);
      END IF;
      UPDATE public.declutter_orders SET handover = 'pickup_home' WHERE id = o.id AND status = 'paid';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('Your $%s delivery fee is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline.',
               to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        'No Helpr took this delivery, so the buyer will book a pickup at your home.', '/declutter?view=cart', o.buyer_id);
    END IF;
    RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund);
  ELSIF p_event = 'pickup_no_show' THEN
    -- B67 (revised 2026-10-16 after lh-authz-rls #3): the Helpr's report, with
    -- a photo at the pickup point, opens a problem on the order. The money
    -- waits (the problem holds it; the task stays taken, so the Helpr is not
    -- counted a no-show) and an admin decides: a seller no-show = refund the
    -- buyer, the seller's fault (row 19: everything back, card fee to the
    -- seller's debt, a strike); or pay the seller (the delivery fee goes
    -- back, B70).
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, is_seed)
    VALUES (o.id, t.helpr_id, 'helpr', 'no_show',
            format('The Helpr says the seller wasn''t there for the pickup at %s. Their photo at the pickup address (%s m away) is on the delivery.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM'), COALESCE(p_by, '?')),
            o.is_seed)
    RETURNING id INTO v_refund;
    PERFORM public.declutter_notify(o.seller_id, 'info', 'The Helpr couldn''t pick up',
      'The Helpr says you weren''t there for the pickup. Louisiana Helpr will look at it and decide; the money waits until then.',
      '/declutter?view=sales', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      'The Helpr couldn''t pick up your item from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
      '/declutter?view=cart', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported', 'problem_id', v_refund);
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_on_task_event(uuid, uuid, text, text) TO service_role;

-- B8. The buyer's "I got it" on a delivery (the customer side of the task).
CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_customer_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_customer_confirm(uuid) TO authenticated, service_role;

-- B9. The handover, restated from 20261015042253. On a DELIVERY order the
-- handover is the delivery: it needs the Helpr to have the item (the buyer's
-- "I got it" from the slice 4 card, the task's code / "I got it" / 24 h, or
-- an admin), and it also confirms the task (the Helpr's payout row). An
-- admin paying the seller on a delivery that never happened gives the
-- delivery fee back (B70).
CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_debt, o.items_cents - v_debt,
          CASE WHEN o.items_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    CASE
      WHEN o.items_cents - v_debt = 0 THEN
        format('This sale paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=sales', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    'The handover is done and the sale is final. Leave the seller a review.', '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

-- B10. Record a refund, restated from 20261015042253. keep_buyer_fee's
-- whole-order check counts only the part of the delivery fee still in the
-- order's refund pool (B69: a fee refunded on its own or owed to the Helpr is
-- not the buyer's to get back twice).
CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_kept integer := 0;
  v_seller uuid;
  v_order record;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   ELSE 'full_platform_absorbs' END;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id) THEN
      -- Only a whole paid order can keep its fee; anything else is a bug, never a guess.
      RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
    END IF;
    v_kept := v_order.premium_cents;
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
               WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
               ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;

-- B11. Close a paid order with a refund, restated from 20261015042253. On a
-- delivery order: the refund is the order minus the delivery fee already
-- reserved (refunded alone, or owed to a Helpr who has the item: that Helpr
-- is paid for the trip, B69); a task nobody picked up yet is cancelled.
CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
  v_task public.helpr_tasks;
  v_reserved integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  -- Slice 5: the order's Helpr task.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NOT NULL THEN
    IF v_task.status IN ('picked_up', 'delivered') THEN
      PERFORM public.helpr_task_confirm(v_task.id, 'admin', NULL);
    ELSIF v_task.status IN ('open', 'accepted') THEN
      PERFORM public.helpr_task_close(v_task.id, 'cancelled', p_reason);
    END IF;
  END IF;
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault AND v_reserved > 0
         THEN format('$%s is coming back to your card. The delivery fee paid the Helpr who made the trip.',
                     to_char((o.total_cents - v_reserved) / 100.0, 'FM999990.00'))
         WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. Your buyer''s fee is not refunded.'
                          ELSE 'The item price, $%s, is coming back to your card. Your buyer''s fee is not refunded.' END,
                     to_char((o.total_cents - v_reserved - o.premium_cents) / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way. The card fee is not refunded.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

-- B12. Damage in delivery (row 43), an admin decision on a reported problem:
-- the buyer gets EVERYTHING back (delivery fee too), the seller is still paid,
-- the Helpr is not paid and gets a delivery strike, Louisiana Helpr absorbs
-- the item cost. The seller's payout goes first (it draws on the order's
-- charge); the buyer's refund waits for it (declutter_refunds_due, B71).
DO $do$
BEGIN
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_reporter_side_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_reporter_side_check
    CHECK (reporter_side IN ('buyer', 'seller', 'helpr'));   -- slice 5: the Helpr's "the seller wasn't there"
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_decision_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_decision_check
    CHECK (decision IS NULL OR decision IN ('refund_buyer', 'pay_seller', 'delivery_damage'));
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage'));   -- slice 5: full refund, the platform absorbs (row 43)
  -- Restated from 20261015042253 unchanged: delivery_damage falls in the ELSE
  -- arm (full_platform_absorbs), named here so the reason list and the policy
  -- are read from one migration.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      ELSE 'full_platform_absorbs' END);
END
$do$;
-- DESTRUCTIVE-DDL-ACK: declutter_problems_reporter_side_check (+ 'helpr'),
-- declutter_problems_decision_check and declutter_refunds_reason_check
-- are dropped only to be re-added with one more allowed value ('delivery_damage'), and
-- declutter_refunds_policy is re-added unchanged; every existing row keeps a value the new
-- CHECKs allow. No data is dropped. Reviewed by lane
-- declutter-delivery 2026-10-16.

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_delivery_damage(p_problem_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_hand jsonb;
  v_refund uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'delivery' OR v_task.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000',
      HINT = 'Only a delivery the Helpr picked up can be decided as damaged in delivery.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'delivery_damage', fault = 'none', strike_given = false,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  -- The Helpr: not paid, a delivery strike (row 43).
  UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Damaged in delivery', updated_at = now()
   WHERE id = v_task.id;
  PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'damaged in delivery');
  PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_damage', v_task.id,
    'An item was damaged during a Helpr delivery you made');
  PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided: damaged',
    'Louisiana Helpr decided the item was damaged during your delivery. You are not paid for this delivery.',
    '/declutter?view=deliver', NULL);
  -- The seller: paid (the handover completes as an admin decision; the task is
  -- already 'failed', so no Helpr payout is written).
  v_hand := public.declutter_complete_handover(o.id, 'admin');
  -- The buyer: everything back (full_platform_absorbs). Held until the
  -- seller's payout has gone (declutter_refunds_due).
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, 'delivery_damage', o.total_cents, o.card_fee_cents);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    format('Your item was damaged in delivery. All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', NULL);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'delivery_damage', 'task_id', v_task.id,
                             'handover', v_hand, 'refund_id', v_refund));
  RETURN jsonb_build_object('result', 'delivery_damage', 'refund_id', v_refund, 'payout_id', v_hand->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_delivery_damage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_delivery_damage(uuid, text) TO authenticated, service_role;

-- B12b. The admin's decision on a reported problem, restated from
-- 20261015042253 (its newest definition; no later migration restates it,
-- checked 2026-10-16) with two slice-5 guards: an admin never decides a
-- delivery they made, and an item the Helpr has that is reported damaged or
-- not received is never refunded through the path that pays the Helpr
-- (lh-money-escrow review #1, 2026-10-16).
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_out jsonb;
  v_task public.helpr_tasks;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller')
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none')
     OR p_strike IS NULL OR (p_strike AND p_fault = 'none') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    -- Another admin decides a sale you are part of (both reviews, 2026-10-15).
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  -- Slice 5: the order's Helpr task, if any.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id;
  IF v_task.id IS NOT NULL AND v_uid IS NOT DISTINCT FROM v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- Slice 5 (lh-money-escrow review #1): refunding the buyer on a delivery the
  -- Helpr already has pays the Helpr for the trip (B69). For an item reported
  -- damaged or not received that would pay the Helpr who may have caused it,
  -- so the admin decides it explicitly instead: "Damaged in delivery" (row 43,
  -- declutter_admin_decide_delivery_damage: the Helpr is not paid) or
  -- "Pay the seller".
  IF p_decision = 'refund_buyer' AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.', NULL);
    END IF;
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Louisiana Helpr decided a reported problem on a Declutter sale against you.');
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', p_decision, 'fault', p_fault, 'strike', p_strike, 'result', v_out));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text) TO authenticated, service_role;

-- B13. The handover sweep, restated from 20261015042253: a DELIVERY order is
-- never auto-paid or cancelled by the booking rules (it has no booking; the
-- task sweep runs its clocks). After the no-Helpr fallback it is a pickup
-- order and these rules apply to it again.
CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND b.slot_start IS NOT NULL AND b.slot_start + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover <> 'delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND b.slot_start + interval '24 hours' <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover <> 'delivery' AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover <> 'delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded; the buyer''s fee was not.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

-- B14. The seller payout queue, restated from 20261015042253 with
-- refunds_recorded_cents appended: declutter-money accepts a charge whose
-- refunded amount is at most what the order recorded (the delivery fee given
-- back on its own), instead of only a charge with nothing refunded.
DROP FUNCTION IF EXISTS public.declutter_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.declutter_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, p.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id, p.attempts,
         public.declutter_order_refunds_recorded_cents(o.id)
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;

-- B15. The refund queue, restated from 20261015042253: a delivery_damage
-- refund waits until the order's seller payout has gone (or owes nothing),
-- so the seller's transfer can still draw on the charge (B71).
CREATE OR REPLACE FUNCTION public.declutter_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- buyer/seller pick the Stripe mode (test accounts on the test key) in declutter-money.
  SELECT r.id, r.reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, r.attempts,
         r.payment_livemode, o.stripe_checkout_session_id
    FROM public.declutter_refunds r
    LEFT JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE ((r.status = 'pending' AND r.created_at <= now() - interval '2 minutes')
          OR (r.status = 'failed' AND r.next_attempt_at <= now()))
     AND r.attempts < 12
     AND (r.reason <> 'delivery_damage'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = r.order_id
                       AND p.status IN ('succeeded', 'nothing_due')))
   ORDER BY r.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refunds_due(integer) TO service_role;

-- B16. The delivery-fee refund queue (row 40) and its reporting.
CREATE OR REPLACE FUNCTION public.declutter_delivery_refunds_due(p_limit integer)
RETURNS TABLE (delivery_refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT d.id, d.reason, d.order_id, o.buyer_id, o.seller_id, d.stripe_payment_intent_id, d.refund_cents, d.attempts,
         o.stripe_checkout_session_id
    FROM public.declutter_delivery_refunds d
    JOIN public.declutter_orders o ON o.id = d.order_id
   WHERE d.status IN ('pending', 'failed') AND d.next_attempt_at <= now() AND d.attempts < 12
   ORDER BY d.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refunds_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_refund_executed(p_id uuid, p_stripe_refund_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_ref = COALESCE(p_stripe_refund_id, stripe_refund_ref),
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_id AND status <> 'succeeded'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund_executed(uuid, text, boolean, text) TO service_role;

-- Stripe moved a delivery-fee refund it had taken to failed / canceled
-- (charge.refund.updated). Only the refund the row recorded reopens it; the
-- reversal counts as a try (same cap and reason as declutter_refund_reversed).
CREATE OR REPLACE FUNCTION public.declutter_delivery_refund_reversed(p_id uuid, p_stripe_refund_id text, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE public.declutter_delivery_refunds
     SET status = 'failed', attempts = least(attempts + 1, 100), next_attempt_at = now(),
         last_error = left('Stripe moved refund ' || p_stripe_refund_id || ' to ' || COALESCE(p_why, 'failed'), 500)
   WHERE id = p_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'succeeded'
  RETURNING attempts INTO v_attempts;
  IF NOT FOUND THEN
    RETURN 'unchanged';
  END IF;
  RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund_reversed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund_reversed(uuid, text, text) TO service_role;

-- A11 (defined here, after part B). The Helpr payout queue (the source's money cron executes it). Held
-- while the source holds the money. The source names the charge that funds
-- it, the transfer group, and how much of that charge is already promised
-- back as refunds (so a known partial refund does not read as "not whole").
CREATE OR REPLACE FUNCTION public.helpr_task_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, task_id uuid, source_kind text, source_id uuid, helpr_id uuid, customer_id uuid,
               pickup_contact_id uuid, amount_cents integer, stripe_account_id text, payment_intent_id text,
               transfer_group text, refunds_recorded_cents integer, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, t.id, t.source_kind, t.source_id, p.helpr_id, t.customer_id, t.pickup_contact_id, p.amount_cents,
         pr.stripe_account_id,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN o.stripe_payment_intent_id END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || o.id::text END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_refunds_recorded_cents(o.id) END,
         p.attempts
    FROM public.helpr_task_payouts p
    JOIN public.helpr_tasks t ON t.id = p.task_id
    LEFT JOIN public.declutter_orders o ON t.source_kind = 'declutter_delivery' AND o.id = t.source_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.helpr_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payouts_due(integer) TO service_role;

-- ===========================================================================
-- Cron: the task sweep (every 10 min at :04, before declutter-handovers :06
-- and declutter-money :08, so a delivery confirmed by the 24 h rule is paid in
-- the same 10 minutes).
-- ===========================================================================
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES
      ('helpr-tasks', interval '30 minutes',
       'Helpr pickup tasks (Declutter delivery): closes tasks no Helpr took in time (the delivery fee goes back), reopens tasks a Helpr never picked up, and confirms door drop-offs after 24 h.',
       'exempt', 'While no delivery is in flight, a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('helpr-tasks', '4-59/10 * * * *',
      $c$SELECT public.cron_record_work('helpr-tasks', to_jsonb(public.helpr_task_sweep()));$c$);
  END IF;
END
$do$;

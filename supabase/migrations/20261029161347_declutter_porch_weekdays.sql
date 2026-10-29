-- Porch days the seller picks (owner 2026-10-29, builder 23's leftover): "porch weekday chips" on the
-- sell form. A porch pickup is a DAY (20261028225038); until now the days a buyer could pick were the
-- weekdays of the seller's pickup TIMES (declutter_pickup_windows). Now the seller can pick their porch
-- weekdays on their own; with none picked, the old rule (pickup-time weekdays) still applies.
--
-- Per SELLER, like the pickup windows: one row per seller (declutter_seller_porch_days), written only
-- through declutter_set_porch_days (RPC, the caller's own row), read with declutter_my_porch_days.
-- ONE helper, declutter_is_porch_day(seller, dow), is what both porch functions use, so the days
-- offered (declutter_porch_days) and the days accepted (declutter_book_porch_day) can never disagree.
-- Both are restated verbatim from their newest definition, 20261028225038 (no later migration
-- redefines them), with only the weekday test swapped for the helper.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS; grants restated.

CREATE TABLE IF NOT EXISTS public.declutter_seller_porch_days (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_seller_porch_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS declutter_seller_porch_days_own_read ON public.declutter_seller_porch_days;
CREATE POLICY declutter_seller_porch_days_own_read ON public.declutter_seller_porch_days
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));
REVOKE ALL ON public.declutter_seller_porch_days FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.declutter_seller_porch_days FROM authenticated;
GRANT SELECT ON public.declutter_seller_porch_days TO authenticated;
GRANT ALL ON public.declutter_seller_porch_days TO service_role;

-- The one rule: the seller's picked porch weekdays, else the weekdays of their pickup times.
CREATE OR REPLACE FUNCTION public.declutter_is_porch_day(p_seller uuid, p_dow smallint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.declutter_seller_porch_days s WHERE s.seller_id = p_seller)
      THEN EXISTS (SELECT 1 FROM public.declutter_seller_porch_days s WHERE s.seller_id = p_seller AND p_dow = ANY (s.weekdays))
    ELSE EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = p_seller AND w.weekday = p_dow)
  END;
$fn$;
-- Internal: called only from the SECURITY DEFINER porch functions (it would tell anyone a seller's days).
REVOKE ALL ON FUNCTION public.declutter_is_porch_day(uuid, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_is_porch_day(uuid, smallint) TO service_role;

-- The caller's porch weekdays (0 = Sunday .. 6 = Saturday); an empty list goes back to the pickup-time days.
CREATE OR REPLACE FUNCTION public.declutter_set_porch_days(p_weekdays smallint[])
RETURNS smallint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_days smallint[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_weekdays IS NULL OR EXISTS (SELECT 1 FROM unnest(p_weekdays) d WHERE d IS NULL OR d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'invalid_porch_days' USING ERRCODE = '22023', HINT = 'Pick days from Sunday to Saturday.';
  END IF;
  SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}') INTO v_days FROM unnest(p_weekdays) d;
  IF cardinality(v_days) = 0 THEN
    DELETE FROM public.declutter_seller_porch_days WHERE seller_id = v_uid;
    RETURN v_days;
  END IF;
  INSERT INTO public.declutter_seller_porch_days (seller_id, weekdays) VALUES (v_uid, v_days)
  ON CONFLICT (seller_id) DO UPDATE SET weekdays = EXCLUDED.weekdays, updated_at = now();
  RETURN v_days;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_porch_days(smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_days(smallint[]) TO authenticated, service_role;

-- The caller's picked porch weekdays, or NULL when they have not picked any (the pickup-time days apply).
CREATE OR REPLACE FUNCTION public.declutter_my_porch_days()
RETURNS smallint[]
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
  PERFORM public.require_feature('declutter');
  RETURN (SELECT s.weekdays FROM public.declutter_seller_porch_days s WHERE s.seller_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_porch_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_porch_days() TO authenticated, service_role;

-- Restated from 20261028225038 with only the weekday test swapped for declutter_is_porch_day.
CREATE OR REPLACE FUNCTION public.declutter_porch_days(p_order_id uuid)
RETURNS SETOF date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.id IS NULL OR public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d::date
      FROM generate_series(v_today, v_today + 7, interval '1 day') d
     WHERE (d::date::timestamp AT TIME ZONE 'America/Chicago') < o.paid_at + interval '7 days'
       AND public.declutter_is_porch_day(o.seller_id, extract(dow FROM d::date)::smallint)
     ORDER BY 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_days(uuid) TO authenticated, service_role;

-- Restated from 20261028225038 with only the weekday test swapped for declutter_is_porch_day.
CREATE OR REPLACE FUNCTION public.declutter_book_porch_day(p_order_id uuid, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
  v_start timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_day IS NULL OR p_day < (now() AT TIME ZONE 'America/Chicago')::date
     OR (p_day::timestamp AT TIME ZONE 'America/Chicago') >= o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023',
      HINT = 'Pick a day from today until the 7-day pickup deadline.';
  END IF;
  IF NOT public.declutter_is_porch_day(o.seller_id, extract(dow FROM p_day)::smallint) THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023', HINT = 'Pick one of the seller''s pickup days.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000', HINT = 'The item is already out on the porch.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  -- declutter_book_pickup's own rules, for a day.
  IF v_side = 'buyer' THEN
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer picks the day first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  v_start := p_day::timestamp AT TIME ZONE 'America/Chicago';
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end, porch_mode, pickup_day, reminded_slot_start)
    VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start);
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = v_start, slot_end = v_start + interval '30 minutes', pickup_day = p_day,
           porch_mode = 'all_day', porch_until = NULL, reminded_slot_start = v_start, updated_at = now(),
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'declutter_pickups',
    CASE v_kind WHEN 'booked' THEN 'Porch pickup day booked' ELSE 'Porch pickup day changed' END,
    CASE WHEN v_side = 'buyer'
         THEN format('The buyer picks it up from your porch on %s. Put it out that day and post the porch photo.', to_char(p_day, 'FMDay, Mon FMDD'))
         ELSE format('Your porch pickup is now on %s. We''ll tell you when it''s out.', to_char(p_day, 'FMDay, Mon FMDD')) END,
    CASE WHEN v_side = 'buyer' THEN '/declutter?tab=selling' ELSE '/declutter?tab=buying' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'pickup_day', p_day);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(uuid, date) TO authenticated, service_role;

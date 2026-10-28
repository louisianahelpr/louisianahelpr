-- Q2428 (owner 2026-10-27, for the Declutter launch 2026-10-28): donate what doesn't sell.
--
-- Before: haul-away (Q1962, 20261017070827) let a seller book a Helpr job to take unsold items "to donation,
-- or the dump if donation won't take it", with the Helpr picking the place and no receipt (spec H7, H10).
-- A seller who wanted the things to go to a real charity, and to have a record of it, had no way to say so.
--
-- Now:
-- 1. declutter_donation_partners: charities admins curate per parish (Goodwill, St. Vincent de Paul, ...).
--    Members read them only through declutter_donation_partners_near; admins read the table and write
--    through admin_declutter_save_donation_partner.
-- 2. On the "Haul it away" card the seller picks a partner near the items (declutter_choose_donation).
--    The choice is stored per item (declutter_donations, a snapshot of the charity's name and address, so an
--    admin edit later never rewrites a receipt). Post a Job is then pre-filled to drop the items there.
--    The haul-away job itself is unchanged: an ordinary Helpr job, the seller pays it, before/after photos.
-- 3. When that job is completed, each item it hauled that has a chosen charity NAMED IN THE JOB's
--    description (so the Helpr was told where to take it) gets its receipt: the item, the date, the charity.
--    No value is stated anywhere: the app gives no tax advice and never estimates what a thing is worth.
--    The seller gets one bell. A receipt shows only while the job is still the item's haul-away and the
--    job was not refunded in full (the refund puts the items back on sale: 20261017070827 H12).
--
-- No new money path. The job, its checkout, escrow, fees and payout are the ordinary job ones.
-- declutter_donations has no person column (an item's seller is read through the item), so export_my_data
-- is unchanged; the partners' created_by (the admin) is exempt as staff data.
--
-- REPLAY-SAFETY: tables IF NOT EXISTS, functions CREATE OR REPLACE, the trigger dropped and re-created,
-- the email-gate attach guarded by to_regprocedure.

-- ---------------------------------------------------------------------------
-- 1. Partner charities (admin-curated).
CREATE TABLE IF NOT EXISTS public.declutter_donation_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish text NOT NULL CHECK (char_length(btrim(parish)) BETWEEN 2 AND 60),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 200),
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN 28 AND 34),     -- Louisiana and a margin
  lng numeric(9,6) NOT NULL CHECK (lng BETWEEN -95 AND -88),
  -- What they take, in the charity's words ("Furniture, clothes, housewares. No mattresses.").
  takes text CHECK (takes IS NULL OR char_length(takes) <= 300),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_donation_partners_active_idx ON public.declutter_donation_partners (parish) WHERE active;
ALTER TABLE public.declutter_donation_partners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_donation_partners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_donation_partners TO authenticated;
GRANT ALL ON TABLE public.declutter_donation_partners TO service_role;
DROP POLICY IF EXISTS "donation partners: admins read" ON public.declutter_donation_partners;
CREATE POLICY "donation partners: admins read" ON public.declutter_donation_partners
  FOR SELECT TO authenticated
  USING (COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false));
COMMENT ON TABLE public.declutter_donation_partners IS
  'Q2428: partner charities a Declutter haul-away can take unsold items to, curated by admins per parish. Members '
  'read them only through declutter_donation_partners_near; admins write through admin_declutter_save_donation_partner.';

-- ---------------------------------------------------------------------------
-- 2. The seller's chosen charity per item, and its receipt once the haul-away job is completed.
CREATE TABLE IF NOT EXISTS public.declutter_donations (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.declutter_donation_partners(id) ON DELETE SET NULL,
  -- A snapshot: an admin editing or retiring the charity later never rewrites a choice or a receipt.
  partner_name text NOT NULL CHECK (char_length(partner_name) BETWEEN 2 AND 80),
  partner_address text NOT NULL CHECK (char_length(partner_address) BETWEEN 5 AND 200),
  chosen_at timestamptz NOT NULL DEFAULT now(),
  -- Set together when the haul-away job is completed (the receipt).
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  donated_at timestamptz,
  CHECK (donated_at IS NULL OR donated_at >= chosen_at)
);
CREATE INDEX IF NOT EXISTS declutter_donations_job_idx ON public.declutter_donations (job_id) WHERE job_id IS NOT NULL;
ALTER TABLE public.declutter_donations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_donations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_donations TO service_role;
COMMENT ON TABLE public.declutter_donations IS
  'Q2428: which partner charity a Declutter haul-away takes an item to, and its receipt (item, date, charity; '
  'never a value). No client privilege: declutter_choose_donation writes, declutter_my_donations reads.';

-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 3. The rules, in one place.
CREATE OR REPLACE FUNCTION public.declutter_donation_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- A partner is offered when it is within this many road miles of EVERY item (one trip, one drop-off).
  SELECT jsonb_build_object('near_miles', 30, 'max_items', 10, 'max_partners', 20);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_donation_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_donation_rules() TO authenticated, service_role;

-- The farthest road miles from a partner to any of these items (NULL when an item has no map point).
CREATE OR REPLACE FUNCTION public.declutter_donation_partner_miles(p_partner_id uuid, p_item_ids uuid[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN bool_or(p.pickup_lat IS NULL OR p.pickup_lng IS NULL) OR count(*) = 0 THEN NULL
              ELSE max(public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng)) END
    FROM unnest(p_item_ids) x(id)
    LEFT JOIN public.declutter_item_private p ON p.item_id = x.id
    CROSS JOIN (SELECT dp.lat, dp.lng FROM public.declutter_donation_partners dp WHERE dp.id = p_partner_id) d;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_donation_partner_miles(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_donation_partner_miles(uuid, uuid[]) TO service_role;

-- The caller's own items among these ids, de-duplicated (refuses none, too many, or anyone else's).
CREATE OR REPLACE FUNCTION public.declutter_donation_own_items(p_uid uuid, p_item_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_item_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF cardinality(v_ids) > (public.declutter_donation_rules() ->> 'max_items')::integer THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;
  -- Someone else's item reads exactly as a missing one (no oracle).
  IF (SELECT count(*) FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.seller_id = p_uid) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_ids;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_donation_own_items(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_donation_own_items(uuid, uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Partners near the seller's items (the card's list). The caller's own items only.
CREATE OR REPLACE FUNCTION public.declutter_donation_partners_near(p_item_ids uuid[])
RETURNS TABLE (id uuid, name text, address text, parish text, takes text, miles integer, chosen boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ids uuid[];
  v_rules jsonb := public.declutter_donation_rules();
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_ids := public.declutter_donation_own_items(v_uid, p_item_ids);
  RETURN QUERY
    SELECT p.id, p.name, p.address, p.parish, p.takes, m.miles,
           EXISTS (SELECT 1 FROM public.declutter_donations d
                    WHERE d.partner_id = p.id AND d.item_id = ANY (v_ids) AND d.donated_at IS NULL)
      FROM public.declutter_donation_partners p
     CROSS JOIN LATERAL (SELECT public.declutter_donation_partner_miles(p.id, v_ids) AS miles) m
     WHERE p.active AND m.miles IS NOT NULL AND m.miles <= (v_rules ->> 'near_miles')::integer
     ORDER BY m.miles, p.name
     LIMIT (v_rules ->> 'max_partners')::integer;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_donation_partners_near(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_donation_partners_near(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The seller chooses (or clears, with NULL) the charity for these items, before the haul-away job is posted.
--    Locked once a job holds them: the charity is written into that job for the Helpr, so changing it means
--    taking the job back first ("Put back on sale" / "Finish booking" on My listings).
CREATE OR REPLACE FUNCTION public.declutter_choose_donation(p_item_ids uuid[], p_partner_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ids uuid[];
  v_partner public.declutter_donation_partners%ROWTYPE;
  v_miles integer;
  v_job uuid;
  v_n integer;
  v_backed uuid[];
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_ids := public.declutter_donation_own_items(v_uid, p_item_ids);
  -- Lock order everywhere: items, then jobs, then link rows (as 20261017070827).
  PERFORM 1 FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.seller_id = v_uid ORDER BY i.id FOR UPDATE;
  -- A receipt its job no longer backs (refunded in full, so the items went back on sale; or no longer the item's
  -- haul-away) is void, exactly as declutter_my_donations hides it: cleared, so the item can be donated again
  -- (lh-authz-rls review #1). A receipt still backed stays, and refuses below. The jobs it reads are locked FOR SHARE
  -- (items, then jobs: the lock order above), so a refund or a completion cannot land between the read and the write.
  v_backed := ARRAY(
    SELECT d.item_id FROM public.declutter_donations d
      JOIN public.declutter_haul_aways h ON h.item_id = d.item_id AND h.job_id = d.job_id
      JOIN public.jobs j ON j.id = d.job_id
     WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NOT NULL
       AND j.status = 'completed' AND j.payment_status IS DISTINCT FROM 'refunded'
     ORDER BY j.id FOR SHARE OF j);
  UPDATE public.declutter_donations d SET job_id = NULL, donated_at = NULL
   WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NOT NULL AND NOT (d.item_id = ANY (v_backed));
  IF EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.status NOT IN ('live', 'ended')) THEN
    RAISE EXCEPTION 'haul_away_not_unsold' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_donations d WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'donation_already_done' USING ERRCODE = '22023';
  END IF;
  -- A job that still holds anything (unpaid but payable, paying, booked, hauled) keeps the charity it was
  -- posted with. declutter_haul_job_hold is fail-closed and locks the job row.
  FOR v_job IN SELECT DISTINCT h.job_id FROM public.declutter_haul_aways h
                WHERE h.item_id = ANY (v_ids) AND h.job_id IS NOT NULL ORDER BY h.job_id
  LOOP
    IF public.declutter_haul_job_hold(v_job) <> 'none' THEN
      RAISE EXCEPTION 'donation_locked' USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF p_partner_id IS NULL THEN
    DELETE FROM public.declutter_donations d WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NULL;
    RETURN 0;
  END IF;
  SELECT * INTO v_partner FROM public.declutter_donation_partners p WHERE p.id = p_partner_id AND p.active;
  v_miles := CASE WHEN v_partner.id IS NULL THEN NULL ELSE public.declutter_donation_partner_miles(v_partner.id, v_ids) END;
  IF v_partner.id IS NULL OR v_miles IS NULL OR v_miles > (public.declutter_donation_rules() ->> 'near_miles')::integer THEN
    RAISE EXCEPTION 'donation_partner_unavailable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_donations AS d (item_id, partner_id, partner_name, partner_address, chosen_at)
  SELECT x, v_partner.id, v_partner.name, v_partner.address, now() FROM unnest(v_ids) x
  ON CONFLICT (item_id) DO UPDATE
     SET partner_id = EXCLUDED.partner_id, partner_name = EXCLUDED.partner_name,
         partner_address = EXCLUDED.partner_address, chosen_at = EXCLUDED.chosen_at, job_id = NULL
   WHERE d.donated_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_choose_donation(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_choose_donation(uuid[], uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The seller's choices and receipts (all their items, or these ids). A receipt is shown only while the
--    job is still the item's haul-away and was not refunded in full.
CREATE OR REPLACE FUNCTION public.declutter_my_donations(p_item_ids uuid[] DEFAULT NULL)
RETURNS TABLE (item_id uuid, item_title text, partner_name text, partner_address text, chosen_at timestamptz,
               donated_at timestamptz, receipt boolean)
LANGUAGE plpgsql
STABLE
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
  RETURN QUERY
    SELECT d.item_id, i.title, d.partner_name, d.partner_address, d.chosen_at,
           CASE WHEN r.ok THEN d.donated_at END, COALESCE(r.ok, false)
      FROM public.declutter_donations d
      JOIN public.declutter_items i ON i.id = d.item_id AND i.seller_id = v_uid
      LEFT JOIN LATERAL (
        SELECT d.donated_at IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.item_id = d.item_id AND h.job_id = d.job_id)
               AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = d.job_id AND j.status = 'completed'
                             AND j.payment_status IS DISTINCT FROM 'refunded') AS ok) r ON true
     WHERE (p_item_ids IS NULL OR d.item_id = ANY (p_item_ids))
       -- A choice still waiting for its job, or a receipt; a receipt undone by a refund is neither.
       AND (d.donated_at IS NULL OR r.ok)
     ORDER BY d.donated_at DESC NULLS LAST, d.chosen_at DESC
     LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_donations(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_donations(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The haul-away job is completed: a receipt for each item it hauled whose chosen charity the job names.
--    The job's own write always lands: a failure here is logged for ops, never raised.
CREATE OR REPLACE FUNCTION public.declutter_donation_job_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
  v_seller uuid;
  v_title text;
  v_partner text;
BEGIN
  BEGIN
    FOR r IN
      SELECT d.item_id, d.partner_name, i.seller_id, i.title
        FROM public.declutter_haul_aways h
        JOIN public.declutter_donations d ON d.item_id = h.item_id AND d.donated_at IS NULL
        JOIN public.declutter_items i ON i.id = h.item_id
       WHERE h.job_id = NEW.id
         -- The Helpr was told where to take it: the job's description carries the line Post a Job fills in,
         -- "Drop off at <charity>," (the description is locked once a Helpr is booked: enforce_poster_jobs_money_lock).
         AND strpos(lower(COALESCE(NEW.description, '')), lower('Drop off at ' || d.partner_name || ',')) > 0
       ORDER BY d.item_id
    LOOP
      UPDATE public.declutter_donations SET job_id = NEW.id, donated_at = now()
       WHERE item_id = r.item_id AND donated_at IS NULL;
      IF FOUND THEN
        v_n := v_n + 1;
        v_seller := r.seller_id;
        v_title := r.title;
        v_partner := r.partner_name;
      END IF;
    END LOOP;
    IF v_n > 0 THEN
      PERFORM public.declutter_notify(v_seller, 'info', 'Donation receipt',
        CASE WHEN v_n = 1 THEN format('Your Helpr took "%s" to %s. Your donation receipt is in My listings.', v_title, v_partner)
             ELSE format('Your Helpr took %s items to %s. Your donation receipts are in My listings.', v_n, v_partner) END,
        '/declutter?view=mine');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.log_cron_defect(
      'declutter_donation_job_completed' || CASE WHEN COALESCE((to_jsonb(NEW) ->> 'is_seed')::boolean, false) THEN '-seed' ELSE '' END,
      NEW.id::text,
      format('could not write the donation receipts of completed job %s: %s (%s)', NEW.id, SQLERRM, SQLSTATE));
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_donation_job_completed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_donation_job_completed() TO service_role;

DROP TRIGGER IF EXISTS trg_declutter_donation_job_completed ON public.jobs;
CREATE TRIGGER trg_declutter_donation_job_completed
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.declutter_donation_job_completed();

-- ---------------------------------------------------------------------------
-- 8. Admins add and edit partners.
CREATE OR REPLACE FUNCTION public.admin_declutter_save_donation_partner(p_id uuid, p_parish text, p_name text, p_address text,
  p_lat numeric, p_lng numeric, p_takes text, p_active boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 28 AND 34 OR p_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'donation_partner_invalid' USING ERRCODE = '22023', HINT = 'The map point must be in Louisiana.';
  END IF;
  IF char_length(btrim(COALESCE(p_parish, ''))) NOT BETWEEN 2 AND 60 OR char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 80
     OR char_length(btrim(COALESCE(p_address, ''))) NOT BETWEEN 5 AND 200 OR char_length(COALESCE(p_takes, '')) > 300 THEN
    RAISE EXCEPTION 'donation_partner_invalid' USING ERRCODE = '22023', HINT = 'Fill in the parish, name and address (not too long).';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.declutter_donation_partners (parish, name, address, lat, lng, takes, active, created_by)
    VALUES (btrim(p_parish), btrim(p_name), btrim(p_address), p_lat, p_lng, NULLIF(btrim(COALESCE(p_takes, '')), ''),
            COALESCE(p_active, true), v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.declutter_donation_partners
       SET parish = btrim(p_parish), name = btrim(p_name), address = btrim(p_address), lat = p_lat, lng = p_lng,
           takes = NULLIF(btrim(COALESCE(p_takes, '')), ''), active = COALESCE(p_active, active), updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'donation_partner_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'declutter_donation_partner_added' ELSE 'declutter_donation_partner_saved' END,
          'declutter_donation_partner', v_id::text,
          jsonb_build_object('parish', btrim(p_parish), 'name', btrim(p_name), 'active', COALESCE(p_active, true)));
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_declutter_save_donation_partner(uuid, text, text, text, numeric, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_declutter_save_donation_partner(uuid, text, text, text, numeric, numeric, text, boolean) TO authenticated, service_role;

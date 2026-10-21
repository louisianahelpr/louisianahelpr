-- Q1852 (MEDIUM; lh-authz-rls finding 2026-10-16): declutter_seller_hidden(uuid) was the declutter_items read policy's
-- helper, so authenticated held EXECUTE on it, and any signed-in member could call it directly with any uuid that has a
-- live or reserved listing and learn whether that seller is out of Declutter (banned or suspended, 3 Declutter strikes,
-- under 18, or flagged business-like). The policy itself only hides the listings (a hidden seller looks like one with
-- no listings); the direct call gave a per-person yes/no. Declutter must not open to everyone with that in place.
--
-- Fix: the hidden state lives on declutter_items itself, in a server-maintained column, and the read policy tests the
-- column. declutter_seller_hidden stays (six SECURITY DEFINER functions call it on prod, read 2026-10-21, as their owner) but no client role
-- can execute it any more.
--
--   seller_hidden = public.declutter_seller_out(seller_id), the SAME function every buy / offer / checkout path asks
--   (single source of truth; nothing here restates its rules). It is kept current by triggers on every input that
--   function reads, so no write path (admin ban / unban in admin-user-actions, ban review, auto-suspension, strikes from
--   the deadline sweep, seller cancel or manage-listing, a strike removed on appeal, a date of birth saved in
--   complete-signup or settings, a business-like flag set or cleared by staff, a service-role script) can be missed:
--     * profiles: ban_status, auto_suspended_until, date_of_birth (and user_id), on INSERT and UPDATE OF those columns;
--     * declutter_strikes: INSERT, DELETE, UPDATE OF user_id, removed_at, expires_at, given_at;
--     * declutter_seller_flags: INSERT, DELETE, UPDATE OF user_id, business_like;
--     * declutter_items itself: BEFORE INSERT and UPDATE OF seller_id, status, seller_hidden recompute it, so a new or
--       re-listed item starts right and nobody (not even service_role) can set the column to anything else.
--
-- What triggers cannot see: the passage of time. Three of declutter_seller_out's inputs end on their own with no write:
-- a temporary suspension passes auto_suspended_until, a strike passes expires_at (count falls under 3), and an
-- under-18 seller turns 18 (member_under_18 reads the America/Chicago date). Each of these only ever turns a seller
-- from hidden to NOT hidden; nothing becomes hidden by time alone (a ban, a strike, a birthday under 18 and a flag are
-- all writes, caught above). So the column can only be stale in the SAFE direction (still hidden a little longer), and
-- the 'declutter-seller-hidden' cron (every 10 minutes) re-asks declutter_seller_out for every seller and fixes any
-- row that differs. Worst case: a seller whose suspension or strike ran out, or who just turned 18, stays hidden for
-- up to 10 minutes. The policy never keeps a client-callable check.
--
-- A seller can read seller_hidden on their own rows (the read policy's first branch; table-level SELECT). That says
-- only "your listings are hidden", never which of the four reasons; every reason is one the seller already meets in
-- the app (the ban screen, each strike's notice, their own birthday, checkout's seller_tax_not_ready). Other members
-- only ever read rows where it is false (the policy hides the rest).
--
-- No installed client calls declutter_seller_hidden (git log -S over src/: never; only the generated types list it),
-- so revoking it strands no bundle; adding a column narrows nothing (schemaBreakBumpsClientFloor).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER / POLICY IF EXISTS, cron.schedule
-- by name, ON CONFLICT upsert. Guard: src/test/declutterSellerHiddenColumn.test.ts. PGlite proof:
-- src/test/pglite/declutterSellerHiddenColumn.pglite.mjs (applied 3x).

-- ---------------------------------------------------------------------------
-- 1. The column.
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.declutter_items.seller_hidden IS
  'Q1852: declutter_seller_out(seller_id), kept by triggers on its inputs and the declutter-seller-hidden cron (time-based endings). The items read policy hides a row from everyone but its seller while true. Never written by clients.';

-- ---------------------------------------------------------------------------
-- 2. Recompute one seller's rows. Only issues the UPDATE when a row differs, so an ordinary profile or strike write
--    never touches declutter_items (its statement-level email gate included).
CREATE OR REPLACE FUNCTION public.declutter_refresh_seller_hidden(p_seller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_out boolean;
BEGIN
  IF p_seller IS NULL THEN
    RETURN;
  END IF;
  -- One writer per seller at a time (lh-authz-rls review 2026-10-21 #2): two strikes given at once from two
  -- tabs would each see 2 strikes in their own snapshot and both write "shown". After the lock, the next
  -- statement reads a fresh snapshot, so the last writer always sees every committed input.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_seller_hidden:' || p_seller::text, 0));
  v_out := public.declutter_seller_out(p_seller);
  IF EXISTS (SELECT 1 FROM public.declutter_items i
              WHERE i.seller_id = p_seller AND i.seller_hidden IS DISTINCT FROM v_out) THEN
    UPDATE public.declutter_items i
       SET seller_hidden = v_out
     WHERE i.seller_id = p_seller AND i.seller_hidden IS DISTINCT FROM v_out;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refresh_seller_hidden(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refresh_seller_hidden(uuid) TO service_role;

-- 3. The item's own row: computed on the way in, whatever the writer sent.
CREATE OR REPLACE FUNCTION public.declutter_items_seller_hidden_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- The same per-seller lock as declutter_refresh_seller_hidden, but ONLY where a concurrent refresh cannot
  -- see this row: a new item, or one moved to another seller. A ban committed while this item is being
  -- inserted is then seen by one side or the other, never missed by both. An UPDATE that keeps seller_id is
  -- already serialized with the refresh by the row lock (lh-authz-rls re-review 2026-10-21, V2): taking the
  -- advisory lock there too would reverse the lock order of the 12 functions that lock an item FOR UPDATE and
  -- then change its status, and deadlock with a refresh.
  IF NEW.seller_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.seller_id IS DISTINCT FROM OLD.seller_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_seller_hidden:' || NEW.seller_id::text, 0));
  END IF;
  NEW.seller_hidden := public.declutter_seller_out(NEW.seller_id);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_seller_hidden_set() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_items_seller_hidden ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_seller_hidden
  BEFORE INSERT OR UPDATE OF seller_id, status, seller_hidden ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_seller_hidden_set();

-- 4. The inputs. One trigger function for the three tables (each keys the member by user_id). SECURITY DEFINER:
--    a member's own profile write runs as authenticated, which cannot execute declutter_seller_out.
CREATE OR REPLACE FUNCTION public.declutter_seller_hidden_on_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.declutter_refresh_seller_hidden(OLD.user_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public.declutter_refresh_seller_hidden(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_hidden_on_input() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_declutter_seller_hidden_ins ON public.profiles;
CREATE TRIGGER trg_profiles_declutter_seller_hidden_ins
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.declutter_seller_hidden_on_input();
DROP TRIGGER IF EXISTS trg_profiles_declutter_seller_hidden ON public.profiles;
CREATE TRIGGER trg_profiles_declutter_seller_hidden
  AFTER UPDATE OF ban_status, auto_suspended_until, date_of_birth, user_id ON public.profiles
  FOR EACH ROW
  WHEN (OLD.ban_status IS DISTINCT FROM NEW.ban_status
        OR OLD.auto_suspended_until IS DISTINCT FROM NEW.auto_suspended_until
        OR OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth
        OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION public.declutter_seller_hidden_on_input();

DROP TRIGGER IF EXISTS trg_declutter_strikes_seller_hidden ON public.declutter_strikes;
CREATE TRIGGER trg_declutter_strikes_seller_hidden
  AFTER INSERT OR DELETE OR UPDATE OF user_id, removed_at, expires_at, given_at ON public.declutter_strikes
  FOR EACH ROW EXECUTE FUNCTION public.declutter_seller_hidden_on_input();

DROP TRIGGER IF EXISTS trg_declutter_seller_flags_seller_hidden ON public.declutter_seller_flags;
CREATE TRIGGER trg_declutter_seller_flags_seller_hidden
  AFTER INSERT OR DELETE OR UPDATE OF user_id, business_like ON public.declutter_seller_flags
  FOR EACH ROW EXECUTE FUNCTION public.declutter_seller_hidden_on_input();

-- ---------------------------------------------------------------------------
-- 5. The sweep: time-based endings (suspension over, strike expired, turned 18), and a backstop for anything else.
--    Asks declutter_seller_out once per seller and rewrites only the rows that differ.
CREATE OR REPLACE FUNCTION public.declutter_seller_hidden_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hidden integer := 0;
  v_shown integer := 0;
BEGIN
  WITH s AS (SELECT DISTINCT i.seller_id FROM public.declutter_items i),
       c AS (SELECT s.seller_id, public.declutter_seller_out(s.seller_id) AS out FROM s),
       u AS (UPDATE public.declutter_items i
                SET seller_hidden = c.out
               FROM c
              WHERE i.seller_id = c.seller_id AND i.seller_hidden IS DISTINCT FROM c.out
             RETURNING i.seller_hidden)
  SELECT count(*) FILTER (WHERE u.seller_hidden), count(*) FILTER (WHERE NOT u.seller_hidden)
    INTO v_hidden, v_shown
    FROM u;
  RETURN jsonb_build_object('hidden', v_hidden, 'shown', v_shown);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_hidden_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_hidden_sweep() TO service_role;

-- 6. Backfill every existing row (the BEFORE trigger above computes the same value).
SELECT public.declutter_seller_hidden_sweep();

-- ---------------------------------------------------------------------------
-- 7. Items read policy: restated from 20261020033623_declutter_items_seed_boundary.sql (the newest; equal to the live
--    pg_policies qual read 2026-10-21) with only `NOT public.declutter_seller_hidden(seller_id)` replaced by
--    `NOT seller_hidden`.
DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved')
        AND (SELECT public.feature_enabled_for('declutter'))
        AND NOT seller_hidden
        AND (NOT is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
  );

-- 8. No client role may ask the helper any more. Its six live callers are SECURITY DEFINER and run as their owner.
REVOKE ALL ON FUNCTION public.declutter_seller_hidden(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_hidden(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Cron + dead-cron expectation (the declutter-deadlines pattern, 20261014210518). Every 10 minutes it heals itself
--    on its next run, so no catch-up policy row.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-seller-hidden', interval '30 minutes',
            'Declutter: re-asks declutter_seller_out for every seller and shows again the listings of a seller whose suspension or strike ran out or who turned 18 (Q1852).',
            'exempt', 'Almost every run finds nothing to change: a seller is shown again only when a suspension, strike or under-18 status runs out.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-seller-hidden', '9-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-seller-hidden', to_jsonb(public.declutter_seller_hidden_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 10. declutter_delivery_quote(uuid) (lh-authz-rls review of this change, 2026-10-21, #1 must-fix): it asked
--     declutter_seller_out(p_seller_id) BEFORE anything about the caller, so any member could pass any uuid and
--     tell "out" (item_not_found) from "not out" (delivery_address_needed / cart_empty): the same oracle this
--     migration closes, without even needing a live listing. declutter-checkout calls it AS THE BUYER, so it
--     cannot be revoked. Restated from 20261017055505 (equal to prod's pg_get_functiondef, md5
--     b990cc354064c864beaf0af320c92447, read 2026-10-21) with one change: the caller's OWN cart is asked first,
--     with exactly the predicate declutter_delivery_compute uses (status 'in_cart', checkout_by in the future),
--     the way declutter_start_checkout already does. Someone with nothing in their cart from that seller gets
--     cart_empty whoever the seller is; a buyer who carted the seller's item saw the listing already.
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
  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_cart_items c
                  WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id
                    AND c.status = 'in_cart' AND c.checkout_by > now()) THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
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

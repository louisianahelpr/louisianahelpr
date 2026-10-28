-- Declutter: a listing stays up 30 days a round, relisted by itself up to 3
-- more times, then comes down with the next step offered (owner decision
-- 2026-10-28 on Q2461 / issue #3728: "30 days per round").
--
-- What was there: offers-mode listings had no end time (ends_at NULL, spec
-- B13) and relist_count (0..3, row 47) was never written, so a listing stayed
-- up until it sold or the seller took it down, and the sell flow could not
-- say how long it would stay open (owner 2026-10-28).
--
-- What this adds:
--   1. declutter_items.listed_until (when this round ends) and
--      round_nudged (the relist_count of the round whose "ends soon" notice
--      went out; NULL = not yet). relist_count is now written.
--   2. A trigger stamps listed_until = now() + 30 days whenever a listing
--      goes LIVE without a round still running (publish, admin approve,
--      relist after a pause past its round, back on sale after a missed
--      checkout keeps the round it had). Every path that sets 'live' is
--      covered without restating each RPC.
--   3. declutter_listing_rounds_sweep(), hourly (cron declutter-listing-rounds):
--      a. 3 days before a round ends, ONE notice to the seller per round
--         (declutter_notify: the bell row, with the seed carve-out; push
--         follows the normal pipeline), claimed under the row lock with
--         SKIP LOCKED so it never waits on another sweep;
--      b. a LIVE listing whose round ended: relist_count < 3 -> a new 30-day
--         round (relist_count + 1, told); relist_count = 3 -> off sale
--         ('ended'), its open offers closed (buyers told, nothing charged,
--         as declutter_pause_listing), and the seller told the next step
--         that exists today (spec row 73's haul to donation: haul-away
--         20261017070827 and donate 20261027222743 take an 'ended' item;
--         row 73's "free giveaway" for an ended item is not built, so the
--         notices never offer it). A free item's notices never say "lower
--         the price" (lh-money-escrow review 2026-10-28 #1).
--      Only 'live' rows: a reserved (in a cart / paid) or paused listing is
--      never ended or relisted under a buyer. Each item in its own sub-block;
--      a failure is logged (log_cron_defect) and the run goes on.
--   4. Backfill: every listing live today gets a round ending 30 days after
--      it went live, and never sooner than 3 days from now (so its seller is
--      told before anything changes).
--
-- No money moves: ending a listing only closes open offers (nothing was
-- charged on an open offer). Service role only; no client privilege.
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, the backfill touches only rows with no round, cron.schedule
-- replaces by name. Applied 3x in PGlite
-- (src/test/pglite/declutterListingRounds.pglite.mjs).

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS listed_until timestamptz;
ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS round_nudged smallint;
COMMENT ON COLUMN public.declutter_items.listed_until IS
  'Owner 2026-10-28 (Q2461): when this 30-day round ends. Stamped by trg_declutter_items_listing_round; moved by declutter_listing_rounds_sweep.';
COMMENT ON COLUMN public.declutter_items.round_nudged IS
  'The relist_count of the round whose "ends soon" notice was sent (NULL = not yet). Written only by declutter_listing_rounds_sweep.';

-- 2. A round starts whenever a listing goes live without one running.
CREATE OR REPLACE FUNCTION public.declutter_items_listing_round()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live')
     AND (NEW.listed_until IS NULL OR NEW.listed_until <= now()) THEN
    NEW.listed_until := now() + interval '30 days';
    NEW.round_nudged := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_listing_round() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_listing_round ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_listing_round
  BEFORE INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_items_listing_round();

-- 4. Backfill (only rows with no round: a replay changes nothing).
UPDATE public.declutter_items
   SET listed_until = greatest(COALESCE(live_at, submitted_at, created_at) + interval '30 days', now() + interval '3 days')
 WHERE status = 'live' AND listed_until IS NULL;

-- 3. The hourly sweep.
CREATE OR REPLACE FUNCTION public.declutter_listing_rounds_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_nudged integer := 0;
  v_relisted integer := 0;
  v_ended integer := 0;
  v_errors integer := 0;
  it record;
  r record;
  v_left integer;
  v_day text;
BEGIN
  -- a. "Ends soon": once per round, 3 days ahead.
  FOR it IN
    SELECT i.id, i.seller_id, i.title, i.relist_count, i.listed_until
      FROM public.declutter_items i
     WHERE i.status = 'live'
       AND i.listed_until IS NOT NULL
       AND i.listed_until > now()
       AND i.listed_until <= now() + interval '3 days'
       AND i.round_nudged IS DISTINCT FROM i.relist_count
     ORDER BY i.listed_until
     LIMIT 500
  LOOP
    BEGIN
      -- Claimed under the row lock, skipping a row another sweep holds (it is told on the next run):
      -- never a plain UPDATE that waits while this run holds the rows it already claimed (review nit 2).
      SELECT i.id, i.current_price_cents INTO r
        FROM public.declutter_items i
       WHERE i.id = it.id AND i.status = 'live' AND i.round_nudged IS DISTINCT FROM it.relist_count
       FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.declutter_items SET round_nudged = it.relist_count WHERE id = it.id;
        v_day := to_char(it.listed_until AT TIME ZONE 'America/Chicago', 'FMDay, Mon FMDD');
        v_left := 3 - it.relist_count;
        -- Only steps that exist (review should-fix 1): lowering the price (not for a free item), and after the
        -- last round a Helpr haul to donation (haul-away takes an 'ended' item). No "give it away" for an
        -- ended item: nothing moves one to the Free section.
        PERFORM public.declutter_notify(it.seller_id, 'info',
          CASE WHEN v_left > 0 THEN 'Your listing goes back up soon' ELSE 'Your listing comes down soon' END,
          CASE
            WHEN v_left > 0 AND r.current_price_cents > 0
              THEN format('"%s" hasn''t sold yet. On %s it goes back up for another 30 days by itself (%s more %s after this). You could lower the price to help it sell.',
                          it.title, v_day, v_left, CASE WHEN v_left = 1 THEN 'time' ELSE 'times' END)
            WHEN v_left > 0
              THEN format('No one has claimed "%s" yet. On %s it goes back up for another 30 days by itself (%s more %s after this).',
                          it.title, v_day, v_left, CASE WHEN v_left = 1 THEN 'time' ELSE 'times' END)
            WHEN r.current_price_cents > 0
              THEN format('"%s" has been up four times without selling. It comes down on %s. Lower the price now, or after that you can have a Helpr take it to donation.',
                          it.title, v_day)
            ELSE format('No one has claimed "%s" after four rounds. It comes down on %s. After that you can have a Helpr take it to donation.',
                        it.title, v_day)
          END,
          '/declutter?view=selling');
        v_nudged := v_nudged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'declutter_listing_rounds_sweep: notice for % failed: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_listing_rounds_sweep', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;

  -- b. A round ended: relist, or after the last round take it down.
  FOR it IN
    SELECT i.id
      FROM public.declutter_items i
     WHERE i.status = 'live' AND i.listed_until IS NOT NULL AND i.listed_until <= now()
     ORDER BY i.listed_until
     LIMIT 500
  LOOP
    BEGIN
      -- Under the row lock, re-read: a sale or a pause since the scan wins.
      SELECT i.id, i.seller_id, i.title, i.relist_count INTO r
        FROM public.declutter_items i
       WHERE i.id = it.id AND i.status = 'live' AND i.listed_until <= now()
       FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
      IF r.relist_count < 3 THEN
        UPDATE public.declutter_items
           SET relist_count = r.relist_count + 1, listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()
         WHERE id = r.id;
        PERFORM public.declutter_notify(r.seller_id, 'info', 'Back up for another 30 days',
          format('"%s" is up again for 30 more days (round %s of 4).', r.title, r.relist_count + 2),
          '/declutter?view=selling');
        v_relisted := v_relisted + 1;
      ELSE
        -- Its open offers close (buyers told, nothing charged), as a pause does.
        PERFORM public.declutter_listing_round_close_offers(r.id, r.title, r.seller_id);
        UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = r.id;
        PERFORM public.declutter_notify(r.seller_id, 'info', 'Your listing came down',
          format('"%s" was up four times without a buyer, so it''s off sale now. Open Selling to have a Helpr take it to donation.', r.title),
          '/declutter?view=selling');
        v_ended := v_ended + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'declutter_listing_rounds_sweep: item % not moved: %', it.id, SQLERRM;
      PERFORM public.log_cron_defect('declutter_listing_rounds_sweep', it.id::text, SQLERRM, '{}'::jsonb);
    END;
  END LOOP;

  RETURN jsonb_build_object('nudged', v_nudged, 'relisted', v_relisted, 'ended', v_ended, 'errors', v_errors);
END;
$fn$;

-- The open offers of a listing that came down: voided, each buyer told (nothing was charged on an open offer).
CREATE OR REPLACE FUNCTION public.declutter_listing_round_close_offers(p_item_id uuid, p_title text, p_seller uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer := 0;
  r record;
BEGIN
  FOR r IN
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE item_id = p_item_id AND status = 'open'
    RETURNING id, buyer_id
  LOOP
    INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
    PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item came down',
      format('"%s" came down without selling, so your offer is closed. Nothing was charged.', p_title),
      '/declutter?view=offers', p_seller);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listing_round_close_offers(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_listing_round_close_offers(uuid, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.declutter_listing_rounds_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_listing_rounds_sweep() TO service_role;

-- The cron: hourly at :31, registered with the dead-cron monitor.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-listing-rounds', interval '3 hours',
            'Declutter listing rounds (Q2461), hourly at :31: tells a seller 3 days before a 30-day round ends, relists an unsold listing up to 3 times, then takes it off sale and offers the next step.',
            'exempt',
            'While Declutter is testers-only or no round is ending, a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-listing-rounds', '31 * * * *',
      $c$SELECT public.cron_record_work('declutter-listing-rounds', to_jsonb(public.declutter_listing_rounds_sweep()));$c$);
  END IF;
END
$do$;

-- Declutter: "Keep it up until it sells" (owner decision 2026-10-29, pop-up answer: a seller switch, off by
-- default).
--
-- What was there (20261028164424, owner Q2461 "30 days per round"): a listing is up 30 days a round; the hourly
-- declutter_listing_rounds_sweep tells the seller 3 days before a round ends, relists it by itself up to 3 times
-- (relist_count 0..3), then takes it off sale ('ended', open offers closed, the next step offered). A seller who
-- simply wanted it up until it sold had no way to say so.
--
-- What this adds:
--   1. declutter_item_private.keep_up_until_sold: the seller's private switch, off by default (stored like
--      auto_free_day12, 20261027205327).
--   2. declutter_set_keep_up(item, on) / declutter_keep_up_state(item): the seller's own listing only (draft, in
--      review, live or paused), behind the 'declutter' switch, not for a banned caller. Turning it ON is a selling
--      choice (declutter_assert_member); turning it OFF never is, so a seller who can no longer sell can still stop
--      it (the auto-free pattern). A free item may use it too: free listings run in the same rounds.
--      Turning it OFF on a live listing whose round ends within 3 days moves the end to 3 days from now, and the
--      round's "ends soon" notice is due again (round_nudged cleared), so it never comes down without the notice.
--   3. declutter_keeps_up(item): the sweep's read of the switch (not a definer; no client privilege).
--   4. declutter_listing_rounds_sweep restated from its newest definition (20261028164424) with only this change:
--      with the switch ON, no "ends soon" notice, and a round that ends renews for another 30 days with no cap and
--      no "back up" notice. relist_count is not counted up while it is on, so switching it off picks up the normal
--      rules from the relist_count it had. With the switch OFF it behaves exactly as before. The read of the
--      switch is made under the item's row lock, which declutter_set_keep_up also takes.
--
-- No money moves. Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE; grants by role name (REVOKE ... FROM
-- PUBLIC, anon). Proof: src/test/pglite/declutterKeepUp.pglite.mjs (applied 3x). Guard:
-- src/test/declutterKeepUp.test.ts.

ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS keep_up_until_sold boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.declutter_item_private.keep_up_until_sold IS
  'Owner 2026-10-29: the seller''s "Keep it up until it sells". Set only by declutter_set_keep_up; read by declutter_listing_rounds_sweep (renews every 30 days, no cap, no notices).';

CREATE OR REPLACE FUNCTION public.declutter_keeps_up(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((SELECT p.keep_up_until_sold FROM public.declutter_item_private p WHERE p.item_id = p_item_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_keeps_up(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_keeps_up(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_set_keep_up(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_was boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_on THEN
    v_uid := public.declutter_assert_member(true);
  ELSE
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- The item's row lock: the sweep reads the switch under the same lock.
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  SELECT p.keep_up_until_sold INTO v_was FROM public.declutter_item_private p WHERE p.item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_item_private SET keep_up_until_sold = p_on, updated_at = now() WHERE item_id = p_item_id;
  -- Switched off: the normal rounds pick up from its relist_count, and it never comes down sooner than 3 days
  -- from now, with this round's "ends soon" notice due again.
  IF v_was AND NOT p_on AND v_item.status = 'live' THEN
    UPDATE public.declutter_items
       SET listed_until = CASE WHEN listed_until IS NULL OR listed_until < now() + interval '3 days'
                               THEN now() + interval '3 days' ELSE listed_until END,
           round_nudged = NULL,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_keep_up(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_keep_up(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_keep_up_state(p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_on boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT p.keep_up_until_sold INTO v_on
    FROM public.declutter_item_private p JOIN public.declutter_items i ON i.id = p.item_id
   WHERE p.item_id = p_item_id AND i.seller_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_keep_up_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_keep_up_state(uuid) TO authenticated, service_role;

-- The hourly sweep, restated from 20261028164424 with only the keep-it-up change.
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
  v_renewed integer := 0;
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
       -- Keep it up until it sells (owner 2026-10-29): no "ends soon" notice; it just renews.
       AND NOT public.declutter_keeps_up(i.id)
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
      -- Re-read under the row lock (declutter_set_keep_up takes the same lock): switched on since the scan, no notice.
      IF FOUND AND NOT public.declutter_keeps_up(it.id) THEN
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
      IF public.declutter_keeps_up(r.id) THEN
        -- Keep it up until it sells (owner 2026-10-29): another 30 days, no cap, no notice. relist_count is
        -- not counted up, so switching it off picks up the normal rounds where they were.
        UPDATE public.declutter_items
           SET listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()
         WHERE id = r.id;
        v_renewed := v_renewed + 1;
      ELSIF r.relist_count < 3 THEN
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

  RETURN jsonb_build_object('nudged', v_nudged, 'relisted', v_relisted, 'renewed', v_renewed, 'ended', v_ended, 'errors', v_errors);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_listing_rounds_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_listing_rounds_sweep() TO service_role;

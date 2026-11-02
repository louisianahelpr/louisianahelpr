-- Q2418: a haul-away retry that re-links its job just before the daily sweep can no longer be paid after the sweep
-- put its items back on sale.
--
-- What was broken: declutter_link_haul_away answers a same-job re-link (Post a Job re-links before every retry of
-- the payment hand-off) as success WITHOUT writing anything. declutter_haul_away_sweep Part C undoes a link whose
-- updated_at is 7+ days old when its job is an open 'abandoned' one, and puts the item back on sale; create-payment
-- can then re-mint a checkout for that 'abandoned' job, so the seller pays for a haul-away whose item is on sale.
--
-- The fix (the item's second option): the same-job re-link touches the link rows' updated_at. Both take the item
-- row locks first, so they run one after the other: a re-link before the sweep makes the link fresh (the sweep
-- re-reads it under the lock and skips it); a sweep before the re-link deletes the link, and the re-link then takes
-- the ordinary path and links (and takes off sale) the items again before any payment.
--
-- Restated verbatim from 20261028223036 (the newest definition), changes marked Q2418. Grants as there.
-- Replay-safe: CREATE OR REPLACE. Proof: src/test/pglite/declutterHaulAwayRelinkTouches.pglite.mjs.

CREATE OR REPLACE FUNCTION public.declutter_link_haul_away(p_item_ids uuid[], p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_ids uuid[];
  v_id uuid;
  v_item public.declutter_items%ROWTYPE;
  v_link public.declutter_haul_aways%ROWTYPE;
  v_hold text;
  v_addresses integer;
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_item_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL;
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;

  -- Lock order everywhere: items, then jobs, then link rows (undo and a job
  -- DELETE's SET NULL take the same order), so two tabs never deadlock.
  PERFORM 1 FROM public.declutter_items i WHERE i.id = ANY (v_ids) AND i.seller_id = v_uid ORDER BY i.id FOR UPDATE;

  -- Already done: every item is the caller's and already linked to this very
  -- job (Post a Job re-links before every retry of the payment hand-off).
  -- Answered as success BEFORE the job-state check, because by then the job
  -- may be funded (a gift card settles it inside create-payment, whose answer
  -- was lost): refusing would tell the app the booking failed for a job that
  -- holds money (re-review 2026-10-17, finding 1). Changes nothing; the job
  -- row is locked (items, then job: the lock order below), as the checks below lock it.
  -- '=' (never IS NOT DISTINCT FROM): a NULL job id, or a link whose job was
  -- deleted (job_id SET NULL), never counts as linked.
  IF p_job_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid FOR UPDATE)
     AND (SELECT count(*) FROM public.declutter_haul_aways h
            JOIN public.declutter_items i ON i.id = h.item_id AND i.seller_id = v_uid
           WHERE h.item_id = ANY (v_ids) AND h.job_id = p_job_id) = cardinality(v_ids)
     -- ... and the job hauls nothing else (else haul_away_job_taken below).
     AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h
                      WHERE h.job_id = p_job_id AND NOT (h.item_id = ANY (v_ids))) THEN
    -- Q2418: the re-link is recorded (link rows last, the lock order below), so the daily sweep, which undoes only
    -- a link untouched for 7 days, never puts the items back on sale under a retry that is about to pay.
    UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id;
    RETURN cardinality(v_ids);
  END IF;

  -- The caller's own OPEN, never-paid job (the link is made before payment;
  -- a funded job is never one), locked FOR UPDATE: it cannot be paid,
  -- cancelled or deleted under us, and two links to one job run one at a time
  -- (so "one job, one address" holds).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
                    AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
                  FOR UPDATE) THEN
    RAISE EXCEPTION 'haul_away_job_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- One haul-away per job: a job already hauling OTHER items is refused.
  IF EXISTS (SELECT 1 FROM public.declutter_haul_aways h
              WHERE h.job_id = p_job_id AND NOT (h.item_id = ANY (v_ids))) THEN
    RAISE EXCEPTION 'haul_away_job_taken' USING ERRCODE = '22023';
  END IF;

  -- One trip, one address.
  SELECT count(DISTINCT lower(regexp_replace(p.pickup_address, '\s+', '', 'g')))::integer INTO v_addresses
    FROM public.declutter_item_private p WHERE p.item_id = ANY (v_ids) AND p.seller_id = v_uid;
  IF v_addresses > 1 THEN
    RAISE EXCEPTION 'haul_away_addresses_differ' USING ERRCODE = '22023';
  END IF;

  -- Items in id order (one lock order for every caller), each re-checked
  -- under its row lock: the screen's state is never trusted.
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_item FROM public.declutter_items i
     WHERE i.id = v_id AND i.seller_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Lock order: item, then job, then link row (as a job DELETE's ON DELETE
    -- SET NULL does: job, then link). The item lock already serializes every
    -- writer of this item's link; only that SET NULL can change it meanwhile.
    SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = v_item.id;
    IF FOUND THEN
      IF v_link.job_id = p_job_id THEN
        -- Q2418: touched, as above.
        UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = v_item.id;
        CONTINUE;  -- this same post, linked again (retry)
      END IF;
      v_hold := public.declutter_haul_job_hold(v_link.job_id);
      IF v_hold = 'paying' THEN
        RAISE EXCEPTION 'haul_away_checkout_open' USING ERRCODE = '22023';
      ELSIF v_hold IN ('job_open', 'job_stuck') THEN
        RAISE EXCEPTION 'haul_away_job_open' USING ERRCODE = '22023';
      ELSIF v_hold <> 'none' THEN
        RAISE EXCEPTION 'haul_away_already_booked' USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = v_item.id FOR UPDATE;
      -- The old job holds nothing: point the item at the new post. It stays
      -- off sale and keeps the status it had before.
      UPDATE public.declutter_haul_aways SET job_id = p_job_id, updated_at = now() WHERE item_id = v_item.id;
      CONTINUE;
    END IF;

    IF v_item.status IN ('reserved', 'sold', 'completed')
       OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                   WHERE c.item_id = v_item.id AND c.status IN ('in_cart', 'paid')) THEN
      RAISE EXCEPTION 'haul_away_in_sale' USING ERRCODE = '22023';
    END IF;
    IF v_item.status = 'live' THEN
      IF COALESCE(v_item.live_at, v_item.submitted_at, v_item.created_at) + interval '14 days' > now() THEN
        RAISE EXCEPTION 'haul_away_too_soon' USING ERRCODE = '22023';
      END IF;
    ELSIF v_item.status <> 'ended' THEN
      RAISE EXCEPTION 'haul_away_not_unsold' USING ERRCODE = '22023';
    END IF;

    -- Its open offers close now (buyers told, nothing charged), as when the
    -- seller takes an item down (B46).
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = now(), updated_at = now()
       WHERE item_id = v_item.id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'new_offers', 'Item off sale',
        format('"%s" is off sale now, so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_uid);
    END LOOP;

    INSERT INTO public.declutter_haul_aways (item_id, job_id, prior_status)
    VALUES (v_item.id, p_job_id, v_item.status);
    UPDATE public.declutter_items SET status = 'ended', updated_at = now() WHERE id = v_item.id;
  END LOOP;

  RETURN cardinality(v_ids);
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) TO authenticated, service_role;

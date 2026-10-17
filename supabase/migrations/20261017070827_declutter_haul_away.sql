-- DECLUTTER HAUL-AWAY (owner, 2026-10-16; spec row 73, decision record
-- docs/specs/declutter-haul-away.md): when a listing has not sold, the seller
-- gets one tap to book a Helpr who takes the item(s) to a donation center or
-- the dump.
--
-- NO NEW MONEY PATH. The haul-away is an ordinary Helpr job: the seller's
-- Declutter screen opens Post a Job pre-filled (/post-job?haulAway=<ids>), the
-- seller checks it and pays through the normal job checkout (create-payment,
-- escrow, normal payouts, normal fees). The job asks for before/after photos
-- (the existing require_photo_proof gate), so the Helpr's "after" photo is the
-- proof at drop-off. This migration only adds the LINK between listing and
-- job, the same shape as the STR turnover link (20261007145950):
--   declutter_haul_aways           item -> job (nullable: ON DELETE SET NULL,
--                                  because Post a Job deletes an unpaid job it
--                                  could not take to checkout), plus the status
--                                  the item had, so an unpaid haul-away can be
--                                  undone exactly.
--   declutter_haul_away_state(ids) the seller's own items: can each be hauled
--                                  yet, and is one already booked.
--   declutter_link_haul_away(ids, job)
--                                  called right after the job row is created,
--                                  BEFORE payment (the ids cannot ride the
--                                  Stripe round trip). Takes the items off
--                                  sale ('ended') so nobody buys an item a
--                                  Helpr is about to haul, closes their open
--                                  offers (buyers told, nothing charged).
--   declutter_cancel_haul_away(item, job)
--                                  undo while the job holds no money and no
--                                  open checkout (abandoned, deleted, or
--                                  cancelled): the item goes back to the
--                                  status it had.
--   declutter_haul_job_hold(job)   ONE fail-closed rule for "what does this
--                                  job still hold" (money review 2026-10-16):
--                                  'none' | 'job_open' | 'job_stuck' | 'paying' | 'booked' | 'hauled'.
--   trg_declutter_haul_away_job_refunded
--                                  owner, 2026-10-17: when a finished (or
--                                  disputed, or cancelled) haul-away job is
--                                  refunded IN FULL, its items go back on sale
--                                  automatically (the status each had before,
--                                  with the photos a listing needs) and the
--                                  seller is told.
--
-- MONEY IN FLIGHT (lh-money-escrow review 2026-10-16, must-fix 1): an unpaid
-- job with stripe_session_id set is a Stripe checkout that can still be paid
-- (create-payment stamps it; only checkout.session.expired clears it, up to
-- 60 min later; the webhook funds unpaid/failed/abandoned). So a link is
-- never moved or undone while its job is 'paying' (haul_away_checkout_open)
-- or holds money in any form ('booked': escrow, payout_pending, released,
-- cancelling, chargeback, or any status this rule does not know). Nothing
-- here writes public.jobs: closing a job is the job flow's own business
-- (trg_cancellation_requires_rpc), and a job left open, unpaid and with no
-- session can only be paid again by the app's retry from the same form,
-- which re-links first (useJobSubmit).
-- Kept minimal on purpose so Helpr delivery (slice 5, a separate lane) can
-- merge its own "Helpr picks up an item at an address" link next to it.
--
-- WHEN AN ITEM CAN BE HAULED (defaults chosen by the lane, owner to confirm,
-- docs/specs/declutter-haul-away.md H1-H3): 'live' for at least 14 days
-- (counted from live_at, or submitted_at for an older row) with no sale in
-- progress, or 'ended' (off sale without a sale, row 47). Up to 10 items per
-- haul-away, all from the same pickup address.
--
-- HIDDEN: a new switch 'declutter_haul_away', created for TESTERS only, and
-- the 'declutter' switch too: every RPC here starts with both
-- require_feature calls.
--
-- Error codes: 42501 refusals (feature_disabled, not_authenticated,
-- account_restricted), P0002 item/job not the caller's (a stranger is never
-- told "exists but not yours"), 22023 the rest.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING; grants
-- restated by role name. Applied 3x in PGlite by
-- src/test/pglite/declutterHaulAway.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The hidden switch, testers only.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_haul_away', 'testers',
        'Declutter haul-away: book a Helpr job to take unsold items to donation or the dump. '
        'Gates the declutter_*haul_away* RPCs (Declutter must be on too).')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. The link. One row per item; no person column (the seller is the item's,
--    the poster is the job's), no client privilege: read and written only by
--    the functions below.
CREATE TABLE IF NOT EXISTS public.declutter_haul_aways (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- What the item was before the haul-away took it off sale.
  prior_status text NOT NULL CHECK (prior_status IN ('live', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_haul_aways_job_idx ON public.declutter_haul_aways (job_id);
ALTER TABLE public.declutter_haul_aways ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_haul_aways TO service_role;
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_haul_aways IS
  'Declutter haul-away: which Helpr job hauls an unsold item away (docs/specs/declutter-haul-away.md). '
  'No client privilege; written only by declutter_link_haul_away / declutter_cancel_haul_away.';

-- ---------------------------------------------------------------------------
-- 2. What a linked job still holds. Fail-closed: anything not explicitly
--    listed is 'booked'. Service-only (the RPCs below call it).
--      none        no job (deleted), or cancelled with no money kept: the link
--                  may be moved or undone
--      job_open    open + never paid + no live checkout, and the poster's own
--                  DELETE policy allows deleting it (unpaid with no session, or
--                  abandoned): create-payment could still open a checkout for
--                  it, so the app deletes that job first, then moves or undoes
--      job_stuck   open + 'failed' (declined card) + no session: nothing is
--                  payable, but the poster's DELETE policy refuses it, so the
--                  app never tries (Q?declutter-haul-away-nudge sweeps it)
--      paying      open + unpaid/failed + a checkout session that can still be paid
--                  (an 'abandoned' job's session is known dead: job_open)
--      hauled      the job is completed
--      booked      everything else (escrow, payout_pending, released, cancelling,
--                  chargeback, refund states on a live job, unknown values)
--    declutter_haul_away_state reads the same rule inline (a read takes no
--    lock); src/test/declutterHaulAway.test.ts keeps the two identical.
--    Locks the job row FOR UPDATE, so create-payment cannot stamp a session,
--    the webhook cannot fund it and the poster cannot delete it until the
--    caller's transaction ends.
CREATE OR REPLACE FUNCTION public.declutter_haul_job_hold(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
  v_pay text;
  v_session text;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN 'none';
  END IF;
  SELECT j.status, COALESCE(j.payment_status, 'unpaid'), j.stripe_session_id INTO v_status, v_pay, v_session
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  -- A FULL refund of a finished (completed) or disputed haul-away job (owner,
  -- 2026-10-17): the money went back, so the haul-away holds nothing and its
  -- items go back on sale (trg_declutter_haul_away_job_refunded below does it
  -- at the refund; this is the same rule for the undo, should that trigger
  -- have logged a failure). A live job with 'refunded' stays 'booked' (fail
  -- closed: it may still be worked), and a chargeback is never a refund.
  IF v_pay = 'refunded' AND v_status IN ('completed', 'disputed') THEN
    RETURN 'none';
  END IF;
  IF v_status = 'completed' THEN
    RETURN 'hauled';
  END IF;
  IF v_status = 'cancelled' AND v_pay IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN
    RETURN 'none';
  END IF;
  IF v_status = 'open' AND v_pay IN ('unpaid', 'abandoned', 'failed') THEN
    -- 'abandoned' is set only once Stripe says the session is dead (or a
    -- re-mint expired it), so a stamped session there is not payable.
    -- 'failed' with no session: nothing payable, but the poster's DELETE
    -- policy (20260903055308) refuses it, so the app must not try (job_stuck).
    RETURN CASE WHEN v_session IS NOT NULL AND v_pay <> 'abandoned' THEN 'paying'
                WHEN v_pay = 'failed' THEN 'job_stuck'
                ELSE 'job_open' END;
  END IF;
  RETURN 'booked';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_job_hold(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_job_hold(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The seller's items and their haul-away state. NULL ids = every one of
--    the caller's live or off-sale items. state:
--      eligible    can be hauled now
--      too_soon    live, but not for 14 days yet (eligible_at says when)
--      in_sale     an offer was accepted or it sold: not the seller's to haul
--      hauled      the haul-away job is done
--      booked      the haul-away job holds money (see declutter_haul_job_hold)
--      paying      its checkout is open: finish paying there, or wait for it
--                  to run out (up to an hour)
--      unpaid      linked to a job that holds nothing (never paid, deleted or
--                  cancelled): book it again, or put it back on sale (the app
--                  first deletes a never-paid job that is still open)
--      not_unsold  any other status (draft, pending review, taken down ...)
--    job_hold: the linked job's hold (declutter_haul_job_hold's rule), so the
--    app deletes a job only when it is 'job_open' (never a cancelled one, and
--    never 'job_stuck', which the poster's DELETE policy refuses).
--    pickup_group: a hash of the pickup address, so the app only offers one
--    trip for items at the same address (the address itself is not returned;
--    declutter_seller_item_private gives it to the seller).
CREATE OR REPLACE FUNCTION public.declutter_haul_away_state(p_item_ids uuid[] DEFAULT NULL)
RETURNS TABLE(item_id uuid, title text, description text, delivery_size text, item_status text,
              state text, eligible_at timestamptz, job_id uuid, pickup_group text, photo_paths text[],
              job_hold text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_item_ids IS NOT NULL AND cardinality(p_item_ids) > 10 THEN
    RAISE EXCEPTION 'haul_away_too_many' USING ERRCODE = '22023';
  END IF;
  -- Asked for by id: every id must be the caller's (never "exists but not yours").
  IF p_item_ids IS NOT NULL AND EXISTS (
       SELECT 1 FROM unnest(p_item_ids) x(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = x.id AND i.seller_id = v_uid)) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
    WITH mine AS (
      SELECT i.*, COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '14 days' AS due
        FROM public.declutter_items i
       WHERE i.seller_id = v_uid
         AND (CASE WHEN p_item_ids IS NULL THEN i.status IN ('live', 'ended') ELSE i.id = ANY (p_item_ids) END)
    ),
    held AS (
      SELECT m.*, h.item_id AS linked, h.job_id AS link_job,
             CASE
               WHEN h.item_id IS NULL THEN NULL
               WHEN j.id IS NULL THEN 'none'
               WHEN COALESCE(j.payment_status, 'unpaid') = 'refunded' AND j.status IN ('completed', 'disputed') THEN 'none'
               WHEN j.status = 'completed' THEN 'hauled'
               WHEN j.status = 'cancelled' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN 'none'
               WHEN j.status = 'open' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed')
                 THEN CASE WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') <> 'abandoned' THEN 'paying'
                           WHEN j.payment_status = 'failed' THEN 'job_stuck'
                           ELSE 'job_open' END
               ELSE 'booked'
             END AS hold
        FROM mine m
        LEFT JOIN public.declutter_haul_aways h ON h.item_id = m.id
        LEFT JOIN public.jobs j ON j.id = h.job_id
    )
    SELECT m.id, m.title, m.description, m.delivery_size, m.status,
           CASE
             WHEN m.hold = 'hauled' THEN 'hauled'
             WHEN m.hold = 'booked' THEN 'booked'
             WHEN m.hold = 'paying' THEN 'paying'
             WHEN m.hold IN ('none', 'job_open', 'job_stuck') AND m.status = 'ended' THEN 'unpaid'
             WHEN m.status IN ('reserved', 'sold', 'completed')
                  OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                              WHERE c.item_id = m.id AND c.status IN ('in_cart', 'paid')) THEN 'in_sale'
             WHEN m.linked IS NOT NULL THEN 'not_unsold'
             WHEN m.status = 'ended' THEN 'eligible'
             WHEN m.status = 'live' AND m.due <= now() THEN 'eligible'
             WHEN m.status = 'live' THEN 'too_soon'
             ELSE 'not_unsold'
           END,
           CASE WHEN m.status = 'live' THEN m.due END,
           m.link_job,
           -- Salted with the seller's id: never a fingerprint of a home address.
           md5(v_uid::text || ':' || lower(regexp_replace(COALESCE(p.pickup_address, ''), '\s+', '', 'g'))),
           COALESCE((SELECT array_agg(ph.storage_path ORDER BY ph.position)
                       FROM public.declutter_item_photos ph WHERE ph.item_id = m.id), ARRAY[]::text[]),
           m.hold
      FROM held m
      LEFT JOIN public.declutter_item_private p ON p.item_id = m.id
     ORDER BY m.due, m.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_state(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_state(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Link the items to the haul-away job just posted (before payment, and
--    again before every retry of the payment hand-off) and take them off sale.
--    Returns how many items it linked. Linking the same items to the same job
--    again is a no-op that answers the same count, whatever the job's state
--    since (it may have been funded meanwhile).
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
        '/declutter?view=offers', v_uid);
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

-- ---------------------------------------------------------------------------
-- 5. Undo a haul-away whose job is gone or cancelled with no money kept: the
--    item goes back on sale if it was for sale before. Returns the item's
--    status. p_job_id (optional): Post a Job undoing its own failed booking,
--    after deleting that job; a link to another, existing job is left alone
--    and the item's status comes back unchanged.
CREATE OR REPLACE FUNCTION public.declutter_cancel_haul_away(p_item_id uuid, p_job_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_status text;
  v_hold text;
  v_link public.declutter_haul_aways%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_haul_away');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: item, job, link row (see the link function).
  SELECT * INTO v_link FROM public.declutter_haul_aways h WHERE h.item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'haul_away_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Post a Job undoing its own failed booking: only a link to THAT job, or
  -- one whose job is already gone (Post a Job deletes it first).
  IF p_job_id IS NOT NULL AND v_link.job_id IS NOT NULL AND v_link.job_id <> p_job_id THEN
    RETURN v_status;
  END IF;
  -- Money held, a checkout that can still be paid, or a job that could still
  -- open one: the haul-away stands.
  v_hold := public.declutter_haul_job_hold(v_link.job_id);
  IF v_hold = 'paying' THEN
    RAISE EXCEPTION 'haul_away_checkout_open' USING ERRCODE = '22023';
  ELSIF v_hold IN ('job_open', 'job_stuck') THEN
    RAISE EXCEPTION 'haul_away_job_open' USING ERRCODE = '22023';
  ELSIF v_hold <> 'none' THEN
    RAISE EXCEPTION 'haul_away_already_booked' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = p_item_id FOR UPDATE;

  DELETE FROM public.declutter_haul_aways WHERE item_id = p_item_id;
  -- Only an item the haul-away left off sale comes back; anything an admin
  -- did since (removed) stays. Back on sale only with the 3-12 photos a live
  -- listing needs (row 31): taking it down meanwhile removed them, and it
  -- stays off sale (lh-authz-rls review 2026-10-16 #4).
  IF v_status = 'ended' AND v_link.prior_status = 'live'
     AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id) BETWEEN 3 AND 12 THEN
    UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id;
    v_status := 'live';
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_cancel_haul_away(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_cancel_haul_away(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. A FULL refund puts the items back on sale (owner, 2026-10-17, morning
--    pop-up Q3: "Haul-away after a full refund: items go BACK ON SALE
--    automatically"). Before this, a finished haul-away job that was later
--    refunded in full kept its items off sale forever: the hold rule read a
--    completed job as 'hauled' and a disputed one as 'booked', whatever its
--    money said.
--    WHEN: the job's payment_status becomes 'refunded' (only a FULL refund
--    sets it: the charge.refunded webhook's compare-and-set, the admin refund
--    and dispute paths) while the job is over: completed, disputed (a
--    dispute split that pays the Helpr nothing; its whole-dollar rounding
--    can make a 95/5 split on a small job one, lh-money-escrow review of
--    bf3cd5730 #1) or cancelled (an admin refund cancels and refunds in one
--    write). A Stripe partial refund never sets 'refunded'; a
--    live job (open, accepted, in progress) with 'refunded' is left alone
--    (fail closed, the hold rule's 'booked'). Fires on a status change too,
--    so a job refunded while live and closed later is handled then.
--    WHAT: the same undo as declutter_cancel_haul_away: the link goes, and an
--    item the haul-away left off sale comes back to the status it had before
--    ('live' only with the 3-12 photos a listing needs; an item that was
--    already off sale stays off sale). Anything an admin did since (removed)
--    is left alone. The seller gets one notice per item put back, because a
--    Helpr may really have taken it: they can take it down in My listings.
--    NEVER BLOCKS THE REFUND: the money write that fires this must land
--    whatever happens here, so the work runs in its own sub-block and a
--    failure is recorded (log_cron_defect: error_logs, the ops feed) and the
--    items stay as they were; the hold rule above then reads the job as
--    'none', so the seller's "Put back on sale" still works.
--    Lock order: this runs inside the job's UPDATE (job row locked), then
--    takes each item and its link row. The seller's link/undo take item then
--    job; a collision is a deadlock Postgres breaks by aborting one side: if
--    it is this sub-block, it is logged and the refund still lands; if it is
--    the seller's call, they try again and find the job refunded.
-- lock_timeout 1s (lh-money-escrow review of bf3cd5730 #2): a wait on an
-- item lock fails as a caught 55P03 long before the session's 8s statement
-- timeout, which WHEN OTHERS cannot catch and would cancel the refund write.
CREATE OR REPLACE FUNCTION public.declutter_haul_away_job_refunded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_status text;
BEGIN
  BEGIN
    FOR r IN
      SELECT h.item_id, h.prior_status FROM public.declutter_haul_aways h
       WHERE h.job_id = NEW.id ORDER BY h.item_id
    LOOP
      SELECT i.status INTO v_status FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;
      PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id AND h.job_id = NEW.id FOR UPDATE;
      DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id AND job_id = NEW.id;
      IF NOT FOUND THEN
        CONTINUE;  -- moved by a concurrent undo meanwhile
      END IF;
      IF v_status = 'ended' AND r.prior_status = 'live'
         AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = r.item_id) BETWEEN 3 AND 12 THEN
        UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = r.item_id;
        PERFORM public.declutter_notify(i.seller_id, 'info', 'Back on sale',
          format('Your haul-away job was refunded in full, so "%s" is back on sale. If it is gone, take it down in My listings.', i.title),
          '/declutter?view=mine')
          FROM public.declutter_items i WHERE i.id = r.item_id;
      ELSIF v_status = 'ended' AND r.prior_status = 'live' THEN
        -- It was for sale before, but it cannot go back without the 3-12
        -- photos a listing needs: say so (lh-silent-failure review of
        -- bf3cd5730 #4), never leave the seller guessing.
        PERFORM public.declutter_notify(i.seller_id, 'info', 'Haul-away refunded',
          format('Your haul-away job was refunded in full. "%s" stays off sale until it has 3 to 12 photos: add them in My listings to put it back on sale.', i.title),
          '/declutter?view=mine')
          FROM public.declutter_items i WHERE i.id = r.item_id;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- The refund must land: record why the items were not put back, keep them as they were.
    -- A seed (test) job's failure is logged under a '-seed' source, which
    -- never pages (lh-silent-failure review of bf3cd5730 #5).
    PERFORM public.log_cron_defect(
      'declutter_haul_away_job_refunded' || CASE WHEN COALESCE((to_jsonb(NEW) ->> 'is_seed')::boolean, false) THEN '-seed' ELSE '' END,
      NEW.id::text,
      format('could not put the haul-away items of refunded job %s back on sale: %s (%s)', NEW.id, SQLERRM, SQLSTATE));
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_haul_away_job_refunded() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_haul_away_job_refunded() TO service_role;

DROP TRIGGER IF EXISTS trg_declutter_haul_away_job_refunded ON public.jobs;
CREATE TRIGGER trg_declutter_haul_away_job_refunded
  AFTER UPDATE OF payment_status, status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.payment_status = 'refunded' AND NEW.status IN ('completed', 'disputed', 'cancelled')
        AND (OLD.payment_status IS DISTINCT FROM NEW.payment_status OR OLD.status IS DISTINCT FROM NEW.status))
  EXECUTE FUNCTION public.declutter_haul_away_job_refunded();

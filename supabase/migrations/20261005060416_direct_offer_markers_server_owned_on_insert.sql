-- Q1283 (docs/OPEN.md): a poster's INSERT could set any direct-offer marker.
--
-- enforce_jobs_insert_column_lock left direct_offer_status and
-- direct_offer_expires_at as the client sent them, so a post could carry
-- 'pending' with a NULL or far-future expiry (expire_pending_direct_offers
-- never clears it), or 'accepted'/'declined' with no offer at all.
--
-- Now, on the client-INSERT branch only:
--   * no offered_to_helper_id  -> both markers NULL (no offer, no marker);
--   * an offered_to_helper_id  -> status is 'pending' and the expiry is held
--     to the windows the app offers (src/lib/offerResponseWindow.ts
--     OFFER_RESPONSE_WINDOWS: 1 to 48 hours): NULL -> the 24h default
--     (DEFAULT_OFFER_RESPONSE_HOURS), earlier than now()+1h -> now()+1h,
--     later than now()+48h -> now()+48h.
-- Clamped, not refused: the client computes the expiry from the PHONE's
-- clock (jobSubmitHelpers.ts), and a refused post over a skewed clock would
-- cost a real poster their job (Q995: clocks hours off are a known case).
-- Every value the app sends (now + 1/2/4/8/12/24/48h) lands unchanged, up to
-- that skew. Server inserts (service_role, definer RPCs) are untouched.
--
-- Restated from its newest definition, 20261004191544 (live body read
-- 2026-10-05 = that file), plus the one block. Replay-safe: CREATE OR
-- REPLACE; the trigger is unchanged.
-- Guard: src/test/directOfferMarkersOnInsert.test.ts +
-- src/test/pglite/directOfferMarkersOnInsert.pglite.mjs.

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A server context and anyone not inserting their own job pass through
  -- untouched. Same gate as the UPDATE money lock.
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;
  -- Q356: a series' standing helper is stamped from the hire, never posted.
  NEW.recurring_helper_id      := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.helper_arrival_near_miss_at := NULL;
  NEW.helper_arrival_near_miss_ft := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  -- Q1189: the row's birth time is the database's. A poster-supplied value
  -- would forge the storage sweep's 90-day trust window (deleted_jobs_log
  -- is keyed on it) and the browse freshness score / early-access cutoff.
  -- The column default is now(), so a normal insert is unchanged.
  NEW.created_at                  := now();

  -- Q1253: the row's id is the database's too. A poster-chosen id could
  -- reuse one whose deleted_jobs_log row was pruned (the storage sweep's
  -- trust window is keyed on it) or collide on purpose with a known id. No
  -- client sends one (useJobSubmit's payload, every e2e REST post: measured
  -- 2026-10-04); the post reads the id back with .select("id").
  NEW.id                          := gen_random_uuid();

  -- Q1283: the direct-offer markers follow the offer, never the poster.
  IF NEW.offered_to_helper_id IS NULL THEN
    NEW.direct_offer_status     := NULL;
    NEW.direct_offer_expires_at := NULL;
  ELSE
    NEW.direct_offer_status     := 'pending';
    NEW.direct_offer_expires_at := LEAST(
      GREATEST(COALESCE(NEW.direct_offer_expires_at, now() + interval '24 hours'),
               now() + interval '1 hour'),
      now() + interval '48 hours');
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon, authenticated;

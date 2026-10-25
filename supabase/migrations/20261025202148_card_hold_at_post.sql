-- Q2399 (owner 2026-10-25): hold the poster's card when a job is posted and
-- charge it only when someone is hired. Behind the switch card_hold_at_post
-- (created 'testers'; the lead flips it, never a migration).
--
-- THE MODEL. A job whose card is only authorized (or saved for a hold placed
-- closer to the date) is payment_status 'held', never 'escrow'. 'escrow' keeps
-- meaning the money is CAPTURED, so every payout, release, refund, tip,
-- dispute and cancellation-fee path stays exactly as it was and cannot run on
-- money nobody collected (release transfers from the platform balance; it
-- does not capture).
--   * LISTED = funded or held (job_payment_is_listed): browse, the ranked /
--     map / landing feeds, apply, the Helpr alerts, the direct-offer clock and
--     notices, the poster's Hire (an offer). Those objects are re-created below
--     from their NEWEST definition, verbatim except the marked Q2399 lines.
--   * CAPTURED = funded (job_payment_is_funded, unchanged): the hire
--     COMPLETING. complete_job_accept keeps it, so a held job's hire cannot
--     complete on any path, a server one included; accept_job_offer,
--     respond_to_direct_offer and rpc_group_member_confirm answer
--     payment_not_captured to a ready Helpr (create-payment capture_hold
--     charges the card first) and record an unready one as pending, as today.
--   * BACKSTOP for every role, service_role included: CHECK
--     jobs_held_is_never_hired (a held job carries no helper_confirmed_at) and
--     trigger crew_seat_held_is_never_confirmed on group_job_helpers.
--
-- REPLAY-SAFE: CREATE OR REPLACE, DROP ... IF EXISTS before every CREATE
-- TRIGGER / ADD CONSTRAINT, CREATE TABLE IF NOT EXISTS, the switch row
-- ON CONFLICT DO NOTHING. CREATE OR REPLACE keeps each function's ACL; the
-- view's grants are restated (its newest migration's own lines).

-- ─── 1. payment_status 'held' ───────────────────────────────────────────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'unpaid'::text, 'escrow'::text, 'payout_pending'::text, 'released'::text,
    'refunded'::text, 'cancelled'::text, 'abandoned'::text, 'failed'::text,
    'chargeback'::text, 'cancelling'::text, 'held'::text
  ]));

-- A held card is never a hire, whoever writes the row.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_held_is_never_hired;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_held_is_never_hired
  CHECK (payment_status IS DISTINCT FROM 'held' OR helper_confirmed_at IS NULL);

-- ─── 2. LISTED: the predicate ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.job_payment_is_listed(p_payment_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(p_payment_status, '') = ANY (
    ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text]
  );
$fn$;
COMMENT ON FUNCTION public.job_payment_is_listed(text) IS
  'Q2399: true when a job is posted and payable: funded (job_payment_is_funded) or its card is held (payment_status ''held''). '
  'Browse, apply, Helpr alerts and offers read this; a hire COMPLETING reads job_payment_is_funded (captured money).';
REVOKE ALL ON FUNCTION public.job_payment_is_listed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_payment_is_listed(text) TO authenticated, service_role;

-- job_is_funded's one caller is the applications policy (20260907060556): an
-- application is allowed on a listed job, a held card included.
CREATE OR REPLACE FUNCTION public.job_is_funded(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT public.job_payment_is_listed(j.payment_status)
      FROM public.jobs j
     WHERE j.id = p_job_id
  ), false);
$fn$;
COMMENT ON FUNCTION public.job_is_funded(uuid) IS
  'True when the job exists and is listed (funded, or its card held: Q2399). The applications policy''s gate; never a money test.';

-- ─── 3. The award gate splits: an offer needs listed, a hire needs captured ──
-- Newest definition 20260915101102_null_uid_is_not_server.sql, with the one
-- v_awarding test split in two.
CREATE OR REPLACE FUNCTION public.enforce_job_funded_before_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_offering   boolean;
  v_confirming boolean;
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- does. The stripe webhook, the payout crons, str-ical-sync and
  -- charge-recurring-visits all run as service role with a NULL auth.uid() and
  -- must keep being able to write these columns. They are a server context;
  -- an anon request (NULL uid, role anon) is not, and is judged.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- The two transitions that mean "this job is now theirs" -- same definition
  -- as enforce_helper_award_gate, deliberately. A re-save that leaves both
  -- columns as they were is not an award: an already-hired helper on a job
  -- whose escrow has since been refunded must still be able to have that job
  -- completed, cancelled or disputed.
  -- Q2399: the poster's Hire (helper_id) is an OFFER, allowed on a listed job
  -- (a card hold included); the hire COMPLETING (helper_confirmed_at) needs
  -- captured money.
  v_offering :=
    NEW.helper_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_id IS DISTINCT FROM NEW.helper_id);
  v_confirming :=
    NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL);

  IF NOT (v_offering OR v_confirming) THEN
    RETURN NEW;
  END IF;

  -- Judge the funding state the row is LANDING in, not the one it left. The
  -- webhook sets payment_status and helper_id in separate statements, but a
  -- service-role session is already exempt above, so NEW is the honest read
  -- for every session this gate actually judges.
  IF (v_confirming AND NOT public.job_payment_is_funded(NEW.payment_status))
     OR (v_offering AND NOT public.job_payment_is_listed(NEW.payment_status)) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released before jobs.helper_confirmed_at may be set, and one of those or held (a card hold, Q2399) before jobs.helper_id may be set. See enforce_job_funded_before_award().';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 4. A crew seat on a held card is never confirmed (every role) ──────────
CREATE OR REPLACE FUNCTION public.enforce_crew_seat_held_never_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.helper_confirmed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.payment_status = 'held') THEN
    RAISE EXCEPTION 'payment_not_captured'
      USING ERRCODE = '42501',
            HINT = 'Q2399: the poster''s card is only held; create-payment capture_hold charges it before a crew spot is confirmed.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_crew_seat_held_never_confirmed() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS crew_seat_held_is_never_confirmed ON public.group_job_helpers;
    CREATE TRIGGER crew_seat_held_is_never_confirmed
      BEFORE INSERT OR UPDATE OF helper_confirmed_at ON public.group_job_helpers
      FOR EACH ROW EXECUTE FUNCTION public.enforce_crew_seat_held_never_confirmed();
  END IF;
END
$do$;

-- ─── 5. The Helpr fan-outs fire on the move INTO listed (held counts) ───────
-- Same four triggers as 20260902015059 / 20260902033222 / 20260901035245,
-- with 'held' in both the NEW and the OLD list: posting (unpaid -> held)
-- announces the job, the capture at hire (held -> escrow) announces nothing.
DROP TRIGGER IF EXISTS trg_notify_helpers_funded_insert ON public.jobs;
CREATE TRIGGER trg_notify_helpers_funded_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
  )
  EXECUTE FUNCTION public.notify_helpers_on_job_post();

DROP TRIGGER IF EXISTS trg_notify_helpers_funded_update ON public.jobs;
CREATE TRIGGER trg_notify_helpers_funded_update
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND NOT (
      OLD.status = 'open'::job_status
      AND COALESCE(OLD.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    )
  )
  EXECUTE FUNCTION public.notify_helpers_on_job_post();

DROP TRIGGER IF EXISTS trg_notify_saved_searches_funded_insert ON public.jobs;
CREATE TRIGGER trg_notify_saved_searches_funded_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
  )
  EXECUTE FUNCTION public.notify_saved_searches_on_new_job();

DROP TRIGGER IF EXISTS trg_notify_saved_searches_funded_update ON public.jobs;
CREATE TRIGGER trg_notify_saved_searches_funded_update
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND NOT (
      OLD.status = 'open'::job_status
      AND COALESCE(OLD.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    )
  )
  EXECUTE FUNCTION public.notify_saved_searches_on_new_job();

-- ─── 6. The hold itself ─────────────────────────────────────────────────────
-- One row per held job. Written only by create-payment, stripe-webhook and the
-- card-hold-sweep cron (service role); no client privilege at all. The poster
-- reads their own through get_my_job_card_hold below.
--   authorized   a PaymentIntent in requires_capture (capture_before = its
--                charge's payment_method_details.card.capture_before)
--   scheduled    the card is saved; the sweep places the hold at place_at
--   needs_action the hold needs the poster on-session ($300+, Q210b; a taxed
--                category, whose tax only Checkout computes; or 3D Secure
--                asked for): the job is payment_status 'failed' (not listed,
--                nobody can be hired) and the poster was told to confirm it
--   failed       placing or capturing failed: the job is payment_status
--                'failed' and the poster was told to pay again (create-payment
--                escrow re-mints a checkout, as for any failed payment)
--   captured     charged at the hire; the job moved to escrow
--   released     cancelled: nobody was hired (the poster was told they were not charged)
-- ON DELETE CASCADE: a deleted job's authorization is dropped by Stripe at its
-- expiry and is never captured (nothing else can capture it).
CREATE TABLE IF NOT EXISTS public.job_card_holds (
  job_id              uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  stripe_mode         text NOT NULL CHECK (stripe_mode IN ('live', 'test')),
  stripe_customer_id  text,
  payment_method_id   text,
  payment_intent_id   text,
  state               text NOT NULL CHECK (state IN ('authorized', 'scheduled', 'needs_action', 'failed', 'captured', 'released')),
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  -- the one-time setup fee inside amount_cents; settled at the capture, and
  -- left out of it when another job collected the fee first (no refund)
  onboarding_fee_cents integer NOT NULL DEFAULT 0 CHECK (onboarding_fee_cents >= 0 AND onboarding_fee_cents < amount_cents),
  -- create-payment's PaymentIntent metadata, reused on a hold placed later
  intent_metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the last state the poster was told about, so each notice goes out once
  notified_state      text,
  capture_before      timestamptz,
  place_at            timestamptz,
  failure_code        text,
  failure_message     text,
  attempts            integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_card_holds_authorized_has_intent CHECK (state <> 'authorized' OR payment_intent_id IS NOT NULL),
  CONSTRAINT job_card_holds_scheduled_has_card CHECK (state <> 'scheduled' OR (payment_method_id IS NOT NULL AND place_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS job_card_holds_open_state_idx
  ON public.job_card_holds (state) WHERE state IN ('authorized', 'scheduled', 'needs_action', 'failed');
ALTER TABLE public.job_card_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_card_holds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_card_holds TO service_role;

-- The poster's own hold, for the "Your card is on hold" line.
CREATE OR REPLACE FUNCTION public.get_my_job_card_hold(p_job_id uuid)
 RETURNS TABLE (state text, amount_cents integer, place_at timestamptz, capture_before timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('card_hold_at_post');
  RETURN QUERY
    SELECT h.state, h.amount_cents, h.place_at, h.capture_before
      FROM public.job_card_holds h
      JOIN public.jobs j ON j.id = h.job_id
     WHERE h.job_id = p_job_id
       AND j.customer_id = auth.uid();
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_job_card_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_job_card_hold(uuid) TO authenticated, service_role;

-- ─── 7. The switch ──────────────────────────────────────────────────────────
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('card_hold_at_post', 'testers', 'Q2399: a posted job holds the poster''s card (card and Link) and charges it only when a Helpr is hired; nobody hired cancels the hold.')
ON CONFLICT (key) DO NOTHING;

-- ─── 8. card-hold-sweep every 10 minutes ────────────────────────────────────
-- Releases holds on jobs closed unhired, completes pending accepts, places
-- scheduled holds and renews expiring ones (supabase/functions/card-hold-sweep).
-- Same shape as recheck-pending-accepts (20261007033422): tagged, timed out,
-- with its gap expectation. Replay-safe: cron.schedule upserts by name.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('card-hold-sweep', interval '30 minutes',
            'Q2399: every 10 minutes, releases card holds on jobs closed unhired, completes pending accepts on held jobs, places scheduled holds and renews expiring ones.',
            'exempt',
            'No hold to move is the healthy state, so a run that changes nothing is not a silent failure. A run that could not read or write answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('card-hold-sweep', '3-59/10 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'card-hold-sweep')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/card-hold-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;

-- ─── 9. Objects re-created from their NEWEST definition ─────────────────────
-- LISTING: open_jobs_browse, newest definition 20261015034054_open_jobs_browse_fee_stamp.sql verbatim except the Q2399 lines.
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok,
        CASE
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open,
    materials_note,
    helper_fee_flat_cents
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND (date_needed IS NULL OR (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > now()) AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)));

-- LISTING: get_ranked_open_jobs, newest definition 20261021062609_memberships_off_paid_perks.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text, helper_fee_flat_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode, j.helper_fee_flat_cents,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates, the identical
      -- masked pair open_jobs_browse already publishes.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED (20260901031421, 20260915051752).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            -- Q1848 (2): no poster boost while memberships are off for the poster.
            WHEN NOT public.feature_enabled_for_user('memberships', j.customer_id) THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'plus'  THEN 2.5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
      -- A series visit is re-offered only inside its series (20260927015010).
      AND j.parent_job_id IS NULL
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now())
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- Q1411: not while the poster is under an open ban settlement review.
      AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term, so distance cannot be recovered
    -- by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band,
    -- Q1839: the jobs flat-fee stamp (roadmap F3), so a flat job's pay is
    -- priced 5% + 70c, never the viewer's tier.
    helper_fee_flat_cents
  FROM scored
  WHERE
    -- Radius filter. An unevaluable radius KEEPS the row.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term orders the feed and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unknown distance is NEUTRAL (the middle band), never "far".
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$
;

-- LISTING: get_open_jobs_for_map, newest definition 20261017094018_browse_rpcs_carry_fee_stamp.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer, boost_expires_at timestamp with time zone, expires_at timestamp with time zone, helper_fee_flat_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_hidden_in_discovery() AS seed_hidden,  -- Q552: false for a test account
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ~ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed,
    j.boost_expires_at,
    j.expires_at,
    -- Q1839: the jobs flat-fee stamp (roadmap F3); the pin popup's JobCard
    -- prices a flat job 5% + 70c from it, never the viewer's tier.
    j.helper_fee_flat_cents
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    AND j.customer_id IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    AND (j.date_needed IS NULL OR public.job_offer_cutoff(j.date_needed, j.start_time) > now())
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    AND (
      j.created_at <= cutoff.ts
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- LISTING: get_public_open_jobs, newest definition 20261012185633_listing_closes_at_start.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  SELECT j.id, j.title, j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent,
         (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) AS is_boosted
  FROM public.jobs j
  WHERE (j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))
    -- A series visit is re-offered only inside its series (20260927015010).
    AND j.parent_job_id IS NULL
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    -- Funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    -- Credentials, on the shared rule. A signed-out visitor is tier 0.
    AND (
      COALESCE(j.credential_tier, 0) = 0
      OR COALESCE((SELECT public.get_user_credential_tier((SELECT auth.uid()))), 0) >= j.credential_tier
    )
    -- The seed switch. Same expression the other three surfaces use.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed IS NOT NULL
    AND public.job_offer_cutoff(j.date_needed, j.start_time) > now()
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- BD-002: Early Access, on the SAME shared authority the other three
    -- discovery surfaces use. No offered_to_helper_id escape hatch here: the
    -- line above already withholds every job under a live direct offer.
    AND j.created_at <= public.early_access_cutoff()
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

-- LISTING: job_announceable_to, newest definition 20261012185633_listing_closes_at_start.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.job_announceable_to(p_job jobs, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- open_jobs_browse's WHERE for a recipient who is neither the poster nor
  -- the offered helper, with get_user_credential_tier(recipient) in place of
  -- my_credential_tier(). The early-access clock is NOT here: a caller that
  -- may queue asks early_access_visible_at() itself.
  SELECT COALESCE(
        p_user_id IS NOT NULL
    AND p_job.status = 'open'
    -- A series visit is re-offered only inside its series (20260927015010).
    AND p_job.parent_job_id IS NULL
    AND p_job.customer_id IS NOT NULL
    AND p_job.customer_id <> p_user_id
    AND COALESCE(p_job.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
    AND (p_job.offered_to_helper_id IS NULL
         OR COALESCE(p_job.direct_offer_status, 'pending') IN ('declined', 'expired'))
    AND (NOT COALESCE(p_job.is_seed, false) OR NOT public.seed_jobs_hidden_publicly())
    AND (COALESCE(p_job.credential_tier, 0) = 0
         OR COALESCE(public.get_user_credential_tier(p_user_id), 0) >= p_job.credential_tier)
    -- Q1401: never announce a listing that has closed (its start passed).
    AND (p_job.date_needed IS NULL OR public.job_offer_cutoff(p_job.date_needed, p_job.start_time) > now())
    -- Q1411: not while the poster is under an open ban settlement review.
    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = p_job.customer_id AND q.review_state = 'open'),
    false);
$function$;

-- LISTING: deliver_saved_search_alert, newest definition 20261021042132_saved_searches_every_section.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.deliver_saved_search_alert(p_user_id uuid, p_job_id uuid, p_search_name text, p_search_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_ids uuid[];
  v_email_ids uuid[];
  v_title TEXT := 'New job matches your saved search';
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  -- FOR SHARE: the job cannot be hired, cancelled or unfunded between this
  -- check and the send. NOWAIT: if a writer (the funding transaction, a hire)
  -- holds the row, this raises lock_not_available instead of waiting, and the
  -- sweep keeps the row for its next run. The sweep never waits on a job.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The job must still be what open_jobs_browse shows this user: open,
  -- funded, not under a live direct offer, not a hidden fixture, not
  -- ownerless (the poster deleted their account), not the recipient's own,
  -- and not above the recipient's credential tier (the view's gate, with
  -- get_user_credential_tier(recipient) in place of my_credential_tier()).
  IF v_job.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010).
     OR v_job.parent_job_id IS NOT NULL
     OR COALESCE(v_job.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
     OR (v_job.offered_to_helper_id IS NOT NULL
         AND COALESCE(v_job.direct_offer_status, 'pending') NOT IN ('declined', 'expired'))
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly())
     OR v_job.customer_id IS NULL
     OR v_job.customer_id = p_user_id
     OR (COALESCE(v_job.credential_tier, 0) <> 0
         AND COALESCE(public.get_user_credential_tier(p_user_id), 0) < v_job.credential_tier)
     -- Q1411: not while the poster is under an open ban settlement review.
     OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = v_job.customer_id AND q.review_state = 'open')
     -- Q2275: Jobs Browse hides a poster on either side of a block (Q573);
     -- so does the alert.
     OR EXISTS (SELECT 1 FROM public.user_blocks b
                 WHERE (b.blocker_id = p_user_id AND b.blocked_id = v_job.customer_id)
                    OR (b.blocker_id = v_job.customer_id AND b.blocked_id = p_user_id))
  THEN
    RETURN false;
  END IF;

  -- V-008: never before the job is in this user's feed.
  IF public.early_access_visible_at(p_user_id, v_job.created_at) > now() THEN
    RETURN false;
  END IF;

  -- The recipient must still be verified, active and opted in to job matches.
  PERFORM 1
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
   WHERE p.user_id = p_user_id
     AND p.email_verified
     AND COALESCE(p.ban_status, 'active') = 'active'
     -- Q2275: "Pause all alerts".
     AND NOT COALESCE(np.saved_searches_paused, false)
     AND COALESCE(np.job_matches, true) IS TRUE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_is_urgent := COALESCE(v_job.is_urgent, false);

  -- ST-011: the matched searches that still notify and are past the hourly
  -- throttle. None left means this alert is dropped, as a throttled match is.
  -- FOR UPDATE (in id order, so two sends cannot deadlock): a concurrent send
  -- for the same searches waits here, then re-reads last_notified_at after the
  -- first one's stamp commits and finds nothing left. Without the lock both
  -- read the old stamp and both send.
  SELECT ARRAY_AGG(x.id)
    INTO v_ids
    FROM (
      SELECT s.id
        FROM public.saved_searches s
       WHERE s.id = ANY(p_search_ids)
         AND s.user_id = p_user_id
         AND s.notify_enabled = true
         AND s.section = 'jobs'
         AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
       ORDER BY s.id
         FOR UPDATE
    ) x;
  IF v_ids IS NULL THEN
    RETURN false;
  END IF;

  -- ST-011: the throttle is spent only when the user is actually notified.
  UPDATE public.saved_searches
     SET last_notified_at = now()
   WHERE id = ANY(v_ids); -- ST-011 stamp on notify only

  -- Q2275: email is its own channel per search, at most once a day, and only
  -- when something new matched (this send is that something). The in-app
  -- alert above is always on for a saved search.
  SELECT ARRAY_AGG(s.id)
    INTO v_email_ids
    FROM public.saved_searches s
   WHERE s.id = ANY(v_ids)
     AND s.notify_email
     AND (s.last_emailed_at IS NULL OR s.last_emailed_at < now() - interval '1 day');

  v_link := '/home?job=' || v_job.id::text;
  v_message :=
    'A new job matches "' || p_search_name || '": '
    || v_job.title || ' ($' || v_job.budget || ')'
    || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (p_user_id, v_title, v_message, 'job_match', v_link);

  IF v_email_ids IS NOT NULL THEN
  UPDATE public.saved_searches
     SET last_emailed_at = now()
   WHERE id = ANY(v_email_ids);

  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'title', v_title,
      'message', v_message,
      'type', 'job_match',
      'link', v_link
    )
  );
  END IF;

  RETURN true;
END;
$function$;

-- LISTING: notify_helpers_on_job_post, newest definition 20261012042612_job_match_emails_followups.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Every member, any parish (owner, 2026-10-09): a job with no parish is
  -- announced too.
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the browse surfaces use.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  -- Q1585 (c): one set-based INSERT, not a loop over every profile inside
  -- the funding transaction. V-008: queued, never sent here, even when already
  -- visible; the sweep sends once the job is in THIS user's feed, and
  -- deliver_parish_match_alert re-checks every predicate below (and claims
  -- the ledger row) at send time.
  INSERT INTO public.parish_match_alert_queue (user_id, job_id, notify_at)
    WITH candidates AS (
      -- Every member (owner, 2026-10-09). Was: same parish AND had already
      -- applied or worked a job, which left every new member out.
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.user_id IS NOT NULL
        -- Test accounts (is_seed) are not told about real jobs (review, 2026-10-09).
        AND NOT COALESCE(p2.is_seed, false)
    )
    SELECT DISTINCT c.user_id, NEW.id, public.early_access_visible_at(c.user_id, NEW.created_at)
    FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      -- Q392: the browse gate (open, a living poster who is not this user,
      -- funded, no live offer, not a hidden fixture, credential tier).
      AND public.job_announceable_to(NEW, c.user_id)
      -- Q392: a block either way.
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
         WHERE (b.blocker_id = NEW.customer_id AND b.blocked_id = c.user_id)
            OR (b.blocker_id = c.user_id AND b.blocked_id = NEW.customer_id)
      )
      -- Q392 (MQ29, never twice): already in the ledger from either source.
      -- Q723: a row an error dropped does not count; it retries.
      AND NOT EXISTS (
        SELECT 1 FROM public.job_match_queue l
         WHERE l.user_id = c.user_id AND l.job_id = NEW.id
           AND NOT (l.status = 'dropped' AND COALESCE(l.drop_reason, '') LIKE 'error:%')
      )
      -- 'Job Matches' switch (not 'Job Offers', 2026-09-11). Unset means on.
      -- Q1585 (owner, 2026-10-12): digest mode no longer stands a member down.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- N-007: once per (job, Helpr). A funded job that leaves 'open' and comes
      -- back re-fires this trigger; it must not re-notify the whole parish.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.job_id = NEW.id AND n.type = 'job_match'
      )  -- N-007 once per job
      -- N-007's hourly cap is NOT applied here any more (Q1585 a): filtering a
      -- member out at queue time dropped their alert for good. Every member is
      -- queued; deliver_parish_match_alert holds the cap at send time and
      -- re-queues an alert over it for when a slot opens.
  ON CONFLICT (user_id, job_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- LISTING: notify_saved_searches_on_new_job, newest definition 20261021072206_saved_search_alerts_by_group.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_visible_at TIMESTAMPTZ;
BEGIN
  IF NEW.status <> 'open'
     -- A series visit is re-offered only inside its series (20260927015010):
     -- a vacated visit going accepted -> open while funded fires this
     -- trigger's UPDATE path and must not alert saved searches.
     OR NEW.parent_job_id IS NOT NULL
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])
  THEN
    RETURN NEW;
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      -- Q2275: one table holds every section's saved searches; only the
      -- Jobs ones match a job.
      AND s.section = 'jobs'
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- These rows are type 'job_match'; the category switch is the master
      -- over every saved search. Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Q2275: "Pause all alerts" keeps the searches and stops every alert.
      AND NOT COALESCE(np.saved_searches_paused, false)
      -- A search's category is a Browse group id ("home", the 8 groups Post a
      -- job and the filter sheet share) or, from before the groups, one
      -- category. Either matches through the one rule below.
      AND public.saved_search_category_matches(s.category, NEW.category)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      AND (
        s.radius_miles IS NULL
        OR (
          p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles
        )
        OR (
          (p.latitude IS NULL OR p.longitude IS NULL
           OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
          AND p.parish IS NOT NULL
          AND NEW.parish IS NOT NULL
          AND p.parish = NEW.parish
        )
      )
      -- ST-011: the hourly throttle stops notification spam. The digest that
      -- once bypassed it is retired (Q1657), so it binds every match.
      AND (
        s.last_notified_at IS NULL
        OR s.last_notified_at < now() - interval '1 hour'
      )
    GROUP BY s.user_id
  LOOP
    -- V-008: queued, never sent here, even when already visible. This
    -- runs inside the funding write; the sweep sends once the job is in
    -- THIS user's feed.
    v_visible_at := public.early_access_visible_at(match_record.user_id, NEW.created_at);
    INSERT INTO public.saved_search_alert_queue (user_id, job_id, notify_at, search_name, matched_search_ids)
    VALUES (match_record.user_id, NEW.id, v_visible_at, match_record.search_name, match_record.matched_search_ids)
    ON CONFLICT (user_id, job_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- LISTING: apply_to_job, newest definition 20261013010621_under_18_cannot_apply_or_post.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_payment_status text;
  v_count int;
  v_cap_minute int := public.application_cap('minute');
  v_cap_hour   int := public.application_cap('hour');
  v_cap_day    int := public.application_cap('day');
BEGIN
  -- Q1586(c) (owner, 2026-10-12): a member whose saved birthday makes them
  -- under 18 cannot apply. Checked first, so the refusal never counts toward
  -- the rate ladder. The applications trigger refuses every other path too.
  IF public.member_under_18(auth.uid()) THEN
    RAISE EXCEPTION 'under_18'
      USING ERRCODE = '42501', HINT = 'You must be 18 or older to apply for jobs.';
  END IF;

  -- Serialize this helper's concurrent applications so the counts below see
  -- each other's inserts. Released automatically at transaction end.
  --
  -- Taken unconditionally, INCLUDING when every cap is off. It is not only the
  -- rate ladder's lock: it is also what stops two simultaneous applies from
  -- both passing the "already applied" check below and inserting a duplicate.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  IF v_cap_minute IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
    IF v_count >= v_cap_minute THEN
      RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
    END IF;
  END IF;

  IF v_cap_hour IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
    IF v_count >= v_cap_hour THEN
      RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
    END IF;
  END IF;

  IF v_cap_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
    IF v_count >= v_cap_day THEN
      RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
    END IF;
  END IF;

  -- FOR SHARE: composes with accept_application's FOR UPDATE so an application
  -- can't be inserted against a job being accepted in the same instant.
  SELECT status, payment_status INTO v_status, v_payment_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  -- Q1409: a booked crew's free spot is re-listed until 15 minutes before
  -- its start (crew_spots_open), so it takes applications like an open job.
  IF v_status != 'open' AND NOT (v_status = 'accepted' AND COALESCE(public.crew_spots_open(p_job_id), 0) > 0) THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;

  -- ADDED 2026-09-06 -- the funding gate. Read under the same FOR SHARE lock
  -- as the status, so it cannot be raced by a refund landing mid-apply.
  -- Deliberately worded for the helper, not the poster: the job's funding
  -- state is not the helper's business beyond "you cannot take this yet".
  IF NOT public.job_payment_is_listed(v_payment_status) THEN
    RAISE EXCEPTION 'This job is not accepting applications yet'
      USING HINT = 'The poster has not completed checkout, so there is no payment held for this job.';
  END IF;

  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;

-- LISTING: notify_helper_on_direct_offer, newest definition 20261021061341_member_display_name.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     -- No notice for a job whose money has not arrived (owner, 2026-10-17).
     AND public.job_payment_is_listed(NEW.payment_status)
     -- Only a live job's offer is news (review #4: not a pending_approval or
     -- cancelled row).
     AND NEW.status::text = 'open'
     -- Money that arrives after the job's start cutoff cannot be answered in
     -- time: no notice about an offer nobody can accept (review #3).
     AND (NEW.date_needed IS NULL
          OR public.job_offer_cutoff(NEW.date_needed, NEW.start_time) > now())
     AND (
       TG_OP = 'INSERT'
       -- The money just arrived for the FIRST time: the notice that waited
       -- for it goes out now. "Never paid" is the set a job leaves only when
       -- money arrives (NULL, unpaid, abandoned, failed), NOT "anything not
       -- funded": escrow -> cancelling -> escrow (cancel_escrow putting a
       -- cancel claim back) is the same money, already announced (review #2).
       OR OLD.payment_status IS NULL
       OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed')
       -- A funded job's offer moved to a different Helpr.
       OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id
     )
     -- A job booked from an agreed quote, offered to its quoter: paying hires
     -- them (quote_job_funded_hires_quoter), which sends the one notice.
     AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id)
  THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- LISTING: restart_direct_offer_clock_on_funding, newest definition 20261018024631_direct_offer_waits_for_funding.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.restart_direct_offer_clock_on_funding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.direct_offer_status = 'pending'
     AND NEW.direct_offer_expires_at IS NOT NULL
     AND public.job_payment_is_listed(NEW.payment_status)
     -- First arrival of the money only (review #2): a cancel claim put back
     -- (escrow -> cancelling -> escrow) keeps the window already running.
     AND (OLD.payment_status IS NULL
          OR OLD.payment_status IN ('unpaid', 'abandoned', 'failed'))
  THEN
    -- Never past the job's start cutoff (review #3); LEAST ignores the NULL
    -- cutoff of a job with no date.
    NEW.direct_offer_expires_at := LEAST(
      now() + GREATEST(
        OLD.direct_offer_expires_at - OLD.created_at,
        interval '55 minutes'
      ),
      public.job_offer_cutoff(NEW.date_needed, NEW.start_time)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- LISTING: expire_pending_direct_offers, newest definition 20261018024631_direct_offer_waits_for_funding.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
       -- Q1891: only an offer on a job still open lapses into "open to
       -- everyone". A cancelled job's offer is retired by the cancel itself.
       AND status::text = 'open'
       -- An unfunded offer was never shown to anyone, so it cannot lapse; its
       -- window starts when the money arrives (owner, 2026-10-17).
       AND public.job_payment_is_listed(payment_status)
    RETURNING id, customer_id, title, date_needed, start_time
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now open to everyone.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
       -- Past the start cutoff the job is not "open to everyone" in any
       -- useful sense (money that landed late, delta review #3): it lapses
       -- quietly.
       AND (date_needed IS NULL
            OR public.job_offer_cutoff(date_needed, start_time) > now())
    RETURNING 1
  ), told AS (
    -- Q1185 (re-review should-fix C): a Helpr who said yes while their setup
    -- was unfinished hears the offer lapsed, with no strike, as a regular
    -- offer's Helpr does (expire_unanswered_offers). The statement's snapshot
    -- still holds the pending rows trg_jobs_clear_accept_pending removes.
    -- Setup can be done and the accept still not complete (the job's date
    -- passed, a block): the copy says which (final review #3).
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT p.helper_id,
           'You lost a job offer',
           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL
                THEN 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
                ELSE 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your accept could be completed, so it went back to everyone. No strike.'
           END,
           'expired',
           '/jobs?job=' || e.id::text,
           e.id
      FROM expired e
      JOIN public.job_accept_pending p ON p.job_id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$;

-- LISTING: get_my_pending_direct_offers, newest definition 20261018024631_direct_offer_waits_for_funding.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
           )
         ) AS rec
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
    -- An offer on a job whose money has not arrived is not an offer yet
    -- (owner, 2026-10-17).
    AND public.job_payment_is_listed(j.payment_status)
  ORDER BY j.created_at DESC;
END;
$function$;

-- LISTING: jobs_offer_target_gone_retires_offer, newest definition 20261018050953_offer_notices_wait_for_funding.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.jobs_offer_target_gone_retires_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.offered_to_helper_id IS NOT NULL
     AND NEW.offered_to_helper_id IS NULL
     AND NEW.direct_offer_status = 'pending' THEN
    NEW.direct_offer_status := 'expired';
    IF NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id,
              'Direct offer closed',
              -- Q2093: a job whose money has not arrived is open to no one.
              CASE WHEN public.job_payment_is_listed(NEW.payment_status) THEN
                'The Helpr you offered "' || COALESCE(NEW.title, 'your job')
                  || '" to is no longer on Helpr. The job is now open to everyone.'
              ELSE
                'The Helpr you offered "' || COALESCE(NEW.title, 'your job')
                  || '" to is no longer on Helpr, so the offer is closed.'
              END,
              'job_updates',
              '/posts?job=' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- LISTING: record_backout_notice, newest definition 20261021131322_member_names_first_and_initial.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.record_backout_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
  v_recipient uuid;
  v_actor uuid;
  v_actor_name text;
  v_link text;
  v_text record;
BEGIN
  IF OLD.is_group_job IS TRUE OR OLD.parent_job_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A10 (20261017073146): a setup job the Declutter seller's backing out
  -- cancelled is not the poster's cancel; declutter_refund_cancels_setup_jobs
  -- tells the Helpr itself, in the right words (lh-silent-failure review of
  -- c57d948d0 #2: this said "<poster> cancelled").
  IF COALESCE(current_setting('app.declutter_seller_fault_cancel', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF OLD.helper_id IS NOT NULL AND NEW.helper_id IS NULL
     AND OLD.status::text IN ('accepted', 'in_progress') AND NEW.status::text = 'open' THEN
    -- The booked (or offered) Helpr is off the job and it reopened.
    v_recipient := OLD.customer_id;
    v_actor := OLD.helper_id;
    v_kind := CASE
      WHEN COALESCE(current_setting('app.repost_unconfirmed', true), '') = '1' THEN 'helper_unconfirmed'
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL
     -- Q2131: "<Helpr> declined your offer ... open to everyone again" only
     -- about a funded job (the notification row says "was declined." alone).
     AND public.job_payment_is_listed(NEW.payment_status) THEN
    v_recipient := OLD.customer_id;
    v_actor := OLD.offered_to_helper_id;
    v_kind := CASE WHEN NEW.direct_offer_status = 'declined' THEN 'offer_declined' ELSE 'offer_expired' END;
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text IN ('accepted', 'in_progress')
     AND OLD.helper_id IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.helper_id THEN
    v_recipient := OLD.helper_id;
    v_actor := COALESCE(NEW.cancelled_by, OLD.customer_id);
    v_kind := 'poster_cancelled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), '') INTO v_actor_name
    FROM public.profiles p WHERE p.user_id = v_actor;

  INSERT INTO public.backout_notices (job_id, user_id, actor_name, backout_kind)
  VALUES (OLD.id, v_recipient, v_actor_name, v_kind);

  v_link := CASE WHEN v_recipient = OLD.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || OLD.id::text;
  SELECT * INTO v_text FROM public.backout_notice_text(v_kind, v_actor_name, OLD.title);
  PERFORM public.send_backout_email(v_recipient, OLD.id, v_text.title, v_text.message, v_link);
  RETURN NULL;
END;
$fn$;

-- LISTING: direct_accept_block_reason, newest definition 20261012185633_listing_closes_at_start.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.direct_accept_block_reason(p_job_id uuid, p_helper uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_job record;
  v_profile record;
BEGIN
  SELECT j.status::text AS status, j.helper_id, j.customer_id, j.offered_to_helper_id,
         j.direct_offer_status, j.direct_offer_expires_at, j.parent_job_id, j.is_seed,
         j.date_needed, j.start_time, j.expires_at, j.payment_status, COALESCE(j.credential_tier, 0) AS credential_tier
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'job_not_found';
  END IF;
  -- the offer itself
  IF v_job.status IS DISTINCT FROM 'open' OR v_job.helper_id IS NOT NULL
     OR v_job.offered_to_helper_id IS DISTINCT FROM p_helper
     OR v_job.direct_offer_status IS DISTINCT FROM 'pending' THEN
    RETURN 'offer_not_active';
  END IF;
  IF v_job.direct_offer_expires_at IS NOT NULL AND v_job.direct_offer_expires_at < now() THEN
    RETURN 'offer_expired';
  END IF;
  -- enforce_application_job_state's refusals
  IF v_job.customer_id IS NULL OR v_job.customer_id = p_helper THEN
    RETURN 'offer_not_active';
  END IF;
  IF public.are_users_blocked(p_helper, v_job.customer_id) THEN
    RETURN 'applicant_blocked';
  END IF;
  IF v_job.parent_job_id IS NOT NULL
     -- Q552: a test account may still accept a test job's direct offer.
     OR (COALESCE(v_job.is_seed, false) AND public.seed_hidden_for(p_helper)) THEN
    RETURN 'offer_not_active';
  END IF;
  -- Q1401: the listing closes at the start, as enforce_application_job_state.
  IF v_job.date_needed IS NOT NULL
     AND public.job_offer_cutoff(v_job.date_needed, v_job.start_time) <= now() THEN
    RETURN 'job_date_has_passed';
  END IF;
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RETURN 'job_expired';
  END IF;
  -- funded (enforce_job_funded_before_award; the server path skips it)
  IF NOT public.job_payment_is_listed(v_job.payment_status::text) THEN
    RETURN 'job_not_funded';
  END IF;
  -- enforce_application_credential_tier
  IF v_job.credential_tier > 0
     AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN
    RETURN 'credential_tier_required';
  END IF;
  -- enforce_ban_gate (is_caller_banned's predicate, for this Helpr) and block_shadowbanned_applications
  SELECT p.ban_status, p.auto_suspended_until INTO v_profile FROM public.profiles p WHERE p.user_id = p_helper;
  IF v_profile.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_profile.ban_status <> 'temp_banned' OR v_profile.auto_suspended_until IS NULL
          OR v_profile.auto_suspended_until > now()) THEN
    RETURN 'account_restricted';
  END IF;
  IF public.is_helper_shadowbanned(p_helper) THEN
    RETURN 'account_restricted';
  END IF;
  RETURN NULL;
END;
$fn$;

-- LISTING: enforce_group_roster_award_gate, newest definition 20261007011530_crew_hire_before_payout_setup.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.enforce_group_roster_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment text;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- The funding gate (enforce_job_funded_before_award) used to judge a crew
  -- through the first hire's jobs.helper_id write. A crew has no lead now, so
  -- it is judged here, on every member: same predicate, same message.
  -- FOR SHARE: a refund or cancel_escrow claim cannot move the job out of
  -- funding between this read and the roster row landing. accept_group_application
  -- already holds the row FOR UPDATE, so this adds no wait on the hire path.
  SELECT j.payment_status INTO v_payment FROM public.jobs j WHERE j.id = NEW.job_id FOR SHARE;
  IF NOT public.job_payment_is_listed(v_payment) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending, released or held (a card hold, Q2399) before a crew member is added. See enforce_group_roster_award_gate().';
  END IF;
  -- The Helpr's payout setup is NOT judged at the hire: a crew hire is an
  -- offer, and the member's Confirm waits on it (rpc_group_member_confirm,
  -- 20261007011530).
  RETURN NEW;
END;
$function$;

-- LISTING: link_str_turnover_job, newest definition 20261007145950_str_turnover_link_job.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.link_str_turnover_job(p_event_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cur uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE: the ownership read decides the write (race-class rule).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
                  FOR SHARE) THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  -- The caller's own turnover, locked; anyone else's (or none) answers false.
  SELECT e.job_id INTO v_cur
    FROM public.str_processed_events e
    JOIN public.str_calendar_connections c ON c.id = e.connection_id
   WHERE e.id = p_event_id AND c.user_id = v_uid
   FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- One turnover per job.
  IF EXISTS (SELECT 1 FROM public.str_processed_events o WHERE o.job_id = p_job_id AND o.id <> p_event_id) THEN
    RETURN false;
  END IF;
  -- A funded post is never re-pointed; a never-funded or cancelled one may be.
  IF v_cur IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.jobs cur
        WHERE cur.id = v_cur
          AND cur.status <> 'cancelled'
          AND cur.payment_status IN ('escrow', 'payout_pending', 'released', 'held')
        FOR SHARE) THEN
    RETURN false;
  END IF;
  UPDATE public.str_processed_events SET job_id = p_job_id WHERE id = p_event_id;
  RETURN true;
END;
$fn$;

-- LISTING: rentals_request_job_state, newest definition 20261017220911_rentals_link_one_live_job.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.rentals_request_job_state(p_request_id uuid)
RETURNS TABLE (job_id uuid, booking text, job_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.job_id,
           CASE
             WHEN j.id IS NULL THEN 'none'
             WHEN COALESCE(j.payment_status, 'unpaid') IN ('refunded', 'cancelled')
               OR (j.status::text = 'cancelled'
                   AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed', 'abandoned')
                   AND (j.stripe_session_id IS NULL OR j.payment_status = 'abandoned')) THEN 'none'
             WHEN j.payment_status IN ('cancelling', 'chargeback') THEN 'refunding'
             WHEN j.payment_status IN ('escrow', 'payout_pending', 'released', 'held') AND j.status::text = 'cancelled' THEN 'refunding'
             WHEN j.payment_status IN ('escrow', 'payout_pending', 'released', 'held') THEN 'booked'
             WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'failed') THEN 'paying'
             ELSE 'unpaid'
           END,
           j.status::text
      FROM public.maintenance_requests r
      LEFT JOIN public.jobs j ON j.id = r.job_id
     WHERE r.id = p_request_id AND (r.tenant_id = v_uid OR r.landlord_id = v_uid);
END;
$fn$;

-- HIRE: accept_job_offer, newest definition 20261003193541_accept_completes_after_stripe_setup.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.accept_job_offer(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_job    record;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Profile before job: the same lock order as the profiles trigger below, so
  -- a Stripe status write landing mid-accept either completes this pending row
  -- after it commits or is read here fresh, never missed (review #5).
  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR SHARE;

  SELECT j.id, j.helper_id, j.status, j.helper_confirmed_at, j.response_deadline, j.is_group_job,
         j.payment_status
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'group_job_not_supported';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  IF v_job.response_deadline IS NOT NULL AND v_job.response_deadline <= now() THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;
  -- Q2399: a card hold is listed, so an offer on it may be answered; the
  -- accept COMPLETES only on captured money (complete_job_accept keeps
  -- job_payment_is_funded).
  IF NOT public.job_payment_is_listed(v_job.payment_status::text) THEN
    RAISE EXCEPTION 'job_not_funded';
  END IF;

  v_reason := public.helper_accept_block_reason(v_uid);
  IF v_reason IS NULL THEN
    -- Q2399: a ready Helpr on a held card: create-payment capture_hold charges
    -- the card first and moves the job to escrow, then this accept is retried.
    -- An unready Helpr's accept is recorded below and the card-hold sweep
    -- captures and completes it once they are ready.
    IF v_job.payment_status::text = 'held' THEN
      RAISE EXCEPTION 'payment_not_captured' USING ERRCODE = '42501';
    END IF;
    IF NOT public.complete_job_accept(p_job_id) THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN jsonb_build_object('state', 'accepted');
  END IF;
  IF v_reason = 'helper_unknown' THEN
    RAISE EXCEPTION 'helper_unknown';
  END IF;

  INSERT INTO public.job_accept_pending (job_id, helper_id)
  VALUES (p_job_id, v_uid)
  ON CONFLICT (job_id) DO UPDATE
    SET helper_id = EXCLUDED.helper_id, requested_at = now()
    WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
  RETURN jsonb_build_object('state', 'pending_setup', 'missing', to_jsonb(public.helper_accept_missing(v_uid)));
END;
$fn$;

-- HIRE: respond_to_direct_offer, newest definition 20261018050953_offer_notices_wait_for_funding.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_now timestamptz := now();
  v_reason text;
  v_block text;
  v_done jsonb;
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- Q1185 (re-review must-fix A, should-fix B): everything the deferred
    -- completion will check is checked now, so nobody is told "thanks" for an
    -- accept that can never complete.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_block := public.direct_accept_block_reason(p_job_id, auth.uid());
    IF v_block = 'credential_tier_required' THEN
      RAISE EXCEPTION 'credential_tier_required' USING ERRCODE = '42501';
    ELSIF v_block = 'job_date_has_passed' THEN
      RAISE EXCEPTION 'job_date_has_passed' USING ERRCODE = '42501';
    ELSIF v_block = 'job_expired' THEN
      RAISE EXCEPTION 'job_expired' USING ERRCODE = '42501';
    ELSIF v_block = 'job_not_funded' THEN
      RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
    ELSIF v_block = 'account_restricted' THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;

    -- Q1185 (owner, 2026-10-03: "Same as a regular offer"): the accept needs
    -- payout setup and Stripe ID, as accept_job_offer's does. Unready, the
    -- direct offer stays exactly as it is (open, pending, on its own clock,
    -- the poster told nothing) and the yes is remembered in job_accept_pending;
    -- trg_profiles_complete_pending_accepts completes it once both are done.
    v_reason := public.helper_accept_block_reason(auth.uid());
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (p_job_id, auth.uid())
      ON CONFLICT (job_id) DO UPDATE
        SET helper_id = EXCLUDED.helper_id, requested_at = now()
        WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(auth.uid())));
    END IF;

    -- Q2399: a ready Helpr on a held card: create-payment capture_hold charges
    -- the card first (the job moves to escrow), then this accept is retried.
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.payment_status = 'held') THEN
      RAISE EXCEPTION 'payment_not_captured' USING ERRCODE = '42501';
    END IF;

    -- Ready: the accept completes now, through the one completion both doors
    -- share (the poster is told "<name> accepted your offer"). NULL means it
    -- did not (the offer moved on between the check and the write): an error,
    -- never an answer the app shows as "Job accepted" (final review #4).
    v_done := public.complete_direct_offer_accept(p_job_id, auth.uid());
    IF v_done IS NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN v_done;
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         -- Q2131: only a funded job is "open to everyone again".
         CASE WHEN public.job_payment_is_listed(payment_status) THEN
           'Your direct offer for "' || title || '" was declined. The job is open to everyone again.'
         ELSE
           'Your direct offer for "' || title || '" was declined.'
         END,
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;

-- HIRE: complete_direct_offer_accept, newest definition 20261020043346_id_once_gates_every_accept.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_customer uuid;
  v_app_id   uuid;
BEGIN
  -- Locked here too (both callers already hold it; re-taking it is free), so
  -- this function is race-safe on its own reading (scripts/check-race-class.mjs).
  SELECT j.customer_id INTO v_customer FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF public.are_users_blocked(p_helper, v_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  -- Everything else the applications gates would have refused in a user
  -- session, checked here because this runs in a server context too.
  IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- ID once (owner 2026-10-20): payout setup and the identity rule, from the
  -- one helper every accept reads. Every caller already asked it
  -- (respond_to_direct_offer, quote_job_funded_hires_quoter,
  -- complete_pending_accepts_on_setup); asked again here so no future caller
  -- can book an unready Helpr through this completion.
  IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- Q2399: a card hold is never a hire. direct_accept_block_reason lets a
  -- held job's offer be answered; it completes only once capture_hold (or the
  -- card-hold sweep) has charged the card and moved the job to escrow.
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.payment_status = 'held') THEN
    RETURN NULL;
  END IF;

  -- The real applications row the synthetic 'direct-<id>' card stood in for.
  -- ON CONFLICT covers a Helpr who also applied before the offer landed.
  INSERT INTO public.applications (job_id, helper_id, message, status)
  VALUES (p_job_id, p_helper, NULL, 'accepted')
  ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
  RETURNING id INTO v_app_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = p_helper,
         direct_offer_status = 'accepted',
         response_deadline = NULL,
         direct_offer_expires_at = NULL
   WHERE id = p_job_id
     AND status = 'open'
     AND helper_id IS NULL
     AND offered_to_helper_id = p_helper
     AND direct_offer_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_active';  -- undoes the applications row above
  END IF;

  IF NOT public.complete_job_accept(p_job_id) THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
END;
$fn$;

-- HIRE: rpc_group_member_confirm, newest definition 20261020043346_id_once_gates_every_accept.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.rpc_group_member_confirm(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
  v_reason text;
  v_payment text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text, j.payment_status INTO v_status, v_payment FROM public.jobs j WHERE j.id = _job_id;

  -- `in_progress` is admitted here and is NOT admitted by the single-helper
  -- `enforce_confirm_on_live_job`, on purpose. `jobs.status` on a crew job is a
  -- CREW-WIDE aggregate: the first member to set out flips it to in_progress
  -- (rpc_group_member_on_the_way, below). Judging a member's own confirmation
  -- against it would mean a slower crew member is locked out of confirming
  -- their slot by a colleague's departure — the same class of deadlock the
  -- 2026-09-19 arrival reversal removed. A member's confirmation is judged
  -- against their OWN slot; the job only has to still be live.
  IF v_status IS NULL OR v_status NOT IN ('open', 'accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_confirmable' USING ERRCODE = '23514',
      HINT = 'This job is no longer live (status=' || COALESCE(v_status, 'null') || ').';
  END IF;

  -- Payouts or ID not ready: the Confirm is RECORDED and completes when both
  -- are (complete_pending_crew_confirms_on_setup), as a single job's Accept
  -- does (accept_job_offer's pending_setup), judged by the SAME helper
  -- (helper_accept_block_reason: payout setup AND the one identity rule;
  -- owner 2026-10-20, ID once at the accept). A spot already confirmed stays
  -- confirmed.
  IF v_row.helper_confirmed_at IS NULL THEN
    v_reason := public.helper_accept_block_reason(v_uid);
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.crew_confirm_pending (slot_id, job_id, helper_id)
      VALUES (v_slot, _job_id, v_uid)
      ON CONFLICT (slot_id) DO NOTHING;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(v_uid)));
    END IF;
  END IF;

  -- Q2399: the first confirmed spot on a held card is the hire: create-payment
  -- capture_hold charges the card first (the job moves to escrow), then this
  -- Confirm is retried. An unready member's Confirm was recorded above.
  IF v_row.helper_confirmed_at IS NULL AND v_payment = 'held' THEN
    RAISE EXCEPTION 'payment_not_captured' USING ERRCODE = '42501';
  END IF;

  UPDATE public.group_job_helpers
     SET helper_confirmed_at = COALESCE(helper_confirmed_at, v_now)
   WHERE id = v_slot
   RETURNING helper_confirmed_at INTO v_stamp;

  RETURN jsonb_build_object('helper_confirmed_at', v_stamp);
END;
$function$;

-- HIRE: complete_pending_crew_confirms_on_setup, newest definition 20261021062140_member_display_name_crew_confirm.sql verbatim except the Q2399 lines.
CREATE OR REPLACE FUNCTION public.complete_pending_crew_confirms_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crew_confirm_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  -- Payout setup AND the identity rule, the one helper every accept reads.
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force completes nothing (complete_pending_accepts_on_setup's
  -- predicate); the recorded Confirm waits.
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT p.slot_id, p.job_id, j.title, j.customer_id, g.helper_id = NEW.user_id AS still_theirs,
           j.status::text IN ('open', 'accepted', 'in_progress') AS live,
           g.helper_confirmed_at
      FROM public.crew_confirm_pending p
      JOIN public.group_job_helpers g ON g.id = p.slot_id
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
       -- Q2399: a held card is captured by the card-hold sweep, which then
       -- completes this Confirm; until then it waits, logging nothing.
       AND j.payment_status IS DISTINCT FROM 'held'
     ORDER BY p.requested_at
       FOR UPDATE OF g
  LOOP
    BEGIN
      IF r.still_theirs AND r.live AND r.helper_confirmed_at IS NULL THEN
        UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = r.slot_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your setup is done, so your spot on "' || COALESCE(r.title, 'the job') || '" is confirmed.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
        -- The poster hears it as from any member's Confirm-after-setup, as a
        -- single job's completed accept tells them (complete_job_accept).
        IF r.customer_id IS NOT NULL THEN
          SELECT public.member_display_name(pp.full_name, 'Someone') INTO v_name
            FROM public.profiles pp WHERE pp.user_id = NEW.user_id;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            r.customer_id,
            COALESCE(v_name, 'Someone') || ' confirmed their spot',
            COALESCE(v_name, 'Someone') || ' confirmed their spot on "' || COALESCE(r.title, 'your job') || '".',
            'job_updates',
            '/posts?job=' || r.job_id::text,
            r.job_id
          );
        END IF;
      END IF;
      DELETE FROM public.crew_confirm_pending WHERE slot_id = r.slot_id;
    EXCEPTION WHEN OTHERS THEN
      -- seed-policy: no seed branch needed: a seed Helpr is never setup-blocked
      -- (helper_accept_missing's fixture carve-out), so a seed account never
      -- has a pending crew Confirm and never reaches this log.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        'pending crew confirm completion failed',
        jsonb_build_object('source', 'complete_pending_crew_confirms_on_setup', 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'slot_id', r.slot_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- open_jobs_browse's grants, as its newest migration (20261015034054) states them.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

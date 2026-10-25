-- A gift-card PURCHASE whose Checkout Session expired unpaid is settled:
-- payment_status 'abandoned' (the word jobs already use for "the checkout
-- expired and nothing was charged").
--
-- Before: checkout.session.expired stamped status 'expired' and left
-- payment_status 'pending' on purpose ("nothing was ever charged, so
-- 'refunded' would be a lie"), and the column allowed only pending / paid /
-- refunded. Measured on prod 2026-10-25: 20 gift_cards rows read
-- payment_status 'pending' with status 'expired' (cs_live_ sessions,
-- 2026-10-01 .. 10-16; Stripe GET of the newest, cs_live_a1T41VGw...: status
-- expired, payment_status unpaid). A pending payment that will never complete
-- reads like money in flight to every reader of payment_status.
--
-- Now: the column also allows 'abandoned', and the webhook writes it with
-- status 'expired' (stripe-webhook checkoutSessionExpired.ts). The 20 old rows
-- are repaired by ops/repairs/2026-10-25-lane-b-money.sql (owner-approved
-- run), not here.
--
-- Nothing spends a gift that is not 'paid' and status 'sent', so an
-- 'abandoned' row is never spendable (unchanged: status 'expired' already
-- made it so).
--
-- The seed purge (purge_old_seed_data, Q455) deleted expired seed gift
-- purchases only while they read 'pending'; it now also takes 'abandoned'
-- ones (lh-money-escrow review 2026-10-25 #1). Restated from its live
-- definition (prosrc md5 matches 20261015000241 byte for byte, measured
-- 2026-10-25) with exactly that change in its dry-run and delete branches.
--
-- REPLAY-SAFETY: the constraint is dropped if present and re-added with the
-- same name; CREATE OR REPLACE FUNCTION. A second run ends in the same state.

DO $$
BEGIN
  IF to_regclass('public.gift_cards') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.gift_cards DROP CONSTRAINT IF EXISTS gift_cards_payment_status_check;
  ALTER TABLE public.gift_cards
    ADD CONSTRAINT gift_cards_payment_status_check
    CHECK (payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'abandoned'::text]));
END
$$;

CREATE OR REPLACE FUNCTION public.purge_old_seed_data(p_dry_run boolean DEFAULT true, p_older_than interval DEFAULT '14 days'::interval, p_batch integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_gift    int := 0;
  -- NULL is a dry run: the destructive branch needs an explicit false.
  v_dry     boolean     := p_dry_run IS DISTINCT FROM false;
  -- The window never drops under 7 days, so a typo cannot purge today's runs.
  v_cut     timestamptz := now() - greatest(coalesce(p_older_than, interval '14 days'), interval '7 days');
  v_batch   integer     := least(greatest(coalesce(p_batch, 100), 0), 500);
  -- (table, column) pairs whose rows must outlive the job they name.
  v_refs    text[]      := ARRAY[
    'public.payout_transfers:job_id', 'public.payment_refunds:job_id', 'public.tips:job_id',
    'public.chargeback_clawbacks:job_id', 'public.disputes:job_id', 'public.dispute_settlement_claims:job_id',
    'public.helper_w9_records:job_id', 'public.gift_cards:job_id', 'public.gift_cards:restored_from_job_id',
    'public.recurring_visit_releases:parent_job_id', 'public.user_violations:job_id',
    'public.str_processed_events:job_id', 'public.jobs:parent_job_id'
  ];
  v_ref     text;
  v_tbl     text;
  v_col     text;
  v_hit     boolean;
  v_hold    text;
  v_job     record;
  v_done    integer := 0;
  v_skipped jsonb   := '[]'::jsonb;
  v_held    jsonb;
  v_held_n  integer;
  v_left    integer;
  v_notif   integer := 0;
  v_result  jsonb;
BEGIN
  -- MONEY: listed, never deleted.
  SELECT count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status,
                  'payment_status', s.payment_status, 'created_at', s.created_at)
                  ORDER BY s.created_at) FILTER (WHERE s.rn <= 50), '[]'::jsonb)
    INTO v_held_n, v_held
    FROM (SELECT j.id, j.status, j.payment_status, j.created_at,
                 row_number() OVER (ORDER BY j.created_at) AS rn
            FROM public.jobs j
           WHERE j.is_seed
             AND j.created_at < v_cut
             AND coalesce(j.payment_status, 'unpaid') NOT IN ('unpaid', 'abandoned', 'cancelled')) s;

  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.is_seed
       AND j.created_at < v_cut
       AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'cancelled')
       AND substr(j.id::text, 15, 1) = '4'
       AND NOT EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.user_id = j.customer_id AND NOT p.is_seed)
     ORDER BY j.created_at, j.id
     LIMIT v_batch
     -- A job some other transaction holds is skipped this run, not waited on
     -- or deleted under it.
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_hold := NULL;
    FOREACH v_ref IN ARRAY v_refs LOOP
      v_tbl := split_part(v_ref, ':', 1);
      v_col := split_part(v_ref, ':', 2);
      CONTINUE WHEN to_regclass(v_tbl) IS NULL;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_tbl, v_col)
        INTO v_hit USING v_job.id;
      IF v_hit THEN
        v_hold := v_ref;
        EXIT;
      END IF;
    END LOOP;
    IF v_hold IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_job.id, 'held_by', v_hold);
      CONTINUE;
    END IF;

    BEGIN
      DELETE FROM public.jobs WHERE id = v_job.id AND is_seed;
      IF v_dry THEN
        RAISE EXCEPTION 'seed_purge_dry_run';
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'seed_purge_dry_run' THEN
        v_done := v_done + 1;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('id', v_job.id, 'error', SQLSTATE || ' ' || SQLERRM);
      END IF;
    END;
  END LOOP;

  -- Eligible jobs this run did not reach (the batch bound). A live run's
  -- deletions are already gone from the count; a dry run's are not.
  SELECT greatest(count(*)::int - jsonb_array_length(v_skipped) - CASE WHEN v_dry THEN v_done ELSE 0 END, 0) INTO v_left
    FROM public.jobs j
   WHERE j.is_seed
     AND j.created_at < v_cut
     AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'cancelled')
     AND substr(j.id::text, 15, 1) = '4'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.user_id = j.customer_id AND NOT p.is_seed);

  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF v_dry THEN
      SELECT count(*)::int INTO v_notif
        FROM (SELECT n.id FROM public.notifications n
                JOIN public.profiles p ON p.user_id = n.user_id AND p.is_seed
               WHERE n.created_at < v_cut
               LIMIT v_batch * 10) d;
    ELSE
      DELETE FROM public.notifications
       WHERE id IN (SELECT n.id FROM public.notifications n
                      JOIN public.profiles p ON p.user_id = n.user_id AND p.is_seed
                     WHERE n.created_at < v_cut
                     ORDER BY n.created_at
                     LIMIT v_batch * 10);
      GET DIAGNOSTICS v_notif = ROW_COUNT;
    END IF;
  END IF;

  -- Q455: the gift-card journey's residue. Under the live Stripe key the
  -- journey stops at the pre-registered checkout, so each run leaves one
  -- unpaid gift_cards row (donor = a seed account) that expires with the
  -- session. gift_cards has no is_seed column and no client DELETE, so it was
  -- never cleaned. Only rows that are certainly test residue go: never paid,
  -- expired, older than the cutoff, donated by a seed account to nobody or to
  -- a seed account, spent on no job and parent of no other gift.
  IF to_regclass('public.gift_cards') IS NOT NULL THEN
    IF v_dry THEN
      SELECT count(*)::int INTO v_gift
        FROM (SELECT g.id FROM public.gift_cards g
               WHERE g.payment_status IN ('pending', 'abandoned')
                 AND g.status = 'expired'
                 AND g.created_at < v_cut
                 AND g.job_id IS NULL
                 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = g.donor_id AND p.is_seed)
                 AND (g.recipient_id IS NULL
                      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = g.recipient_id AND p.is_seed))
                 AND NOT EXISTS (SELECT 1 FROM public.gift_cards c WHERE c.parent_credit_id = g.id)
               LIMIT v_batch) d;
    ELSE
      DELETE FROM public.gift_cards
       WHERE id IN (SELECT g.id FROM public.gift_cards g
                     WHERE g.payment_status IN ('pending', 'abandoned')
                       AND g.status = 'expired'
                       AND g.created_at < v_cut
                       AND g.job_id IS NULL
                       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = g.donor_id AND p.is_seed)
                       AND (g.recipient_id IS NULL
                            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = g.recipient_id AND p.is_seed))
                       AND NOT EXISTS (SELECT 1 FROM public.gift_cards c WHERE c.parent_credit_id = g.id)
                     ORDER BY g.created_at
                     LIMIT v_batch);
      GET DIAGNOSTICS v_gift = ROW_COUNT;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'dry_run', v_dry,
    'cutoff', v_cut,
    'batch', v_batch,
    CASE WHEN v_dry THEN 'jobs_would_delete' ELSE 'jobs_deleted' END, v_done,
    'jobs_eligible_not_reached', v_left,
    'jobs_skipped', v_skipped,
    CASE WHEN v_dry THEN 'notifications_would_delete' ELSE 'notifications_deleted' END, v_notif,
    CASE WHEN v_dry THEN 'gift_cards_would_delete' ELSE 'gift_cards_deleted' END, v_gift,
    'money_held_count', v_held_n,
    'money_held', v_held
  );

  DELETE FROM public.seed_purge_runs WHERE ran_at < now() - interval '90 days';
  INSERT INTO public.seed_purge_runs (dry_run, result) VALUES (v_dry, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_old_seed_data(boolean, interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_seed_data(boolean, interval, integer) TO service_role;

-- Test stuff never reaches an admin or the owner: the five admin alerts
-- 20261030143141 left open (owner, 2026-10-30, top priority).
--
-- 20261030143141 taught the notification gate (notification_crosses_seed_boundary)
-- to drop an admin alert about a test subject when it can see one: a subject in
-- the link, the row's job, or the signed-in member. Its guard
-- (src/test/adminAlertsSkipTestAccounts.test.ts) listed five admin notifiers the
-- gate cannot see through, because they run from a cron or the service role
-- with a bare '/admin...' link. Each now skips a test subject itself.
--
-- Every function below is restated from a body whose md5 equals prod's prosrc
-- (read 2026-10-30), changing only the test skip:
--   * facilitated_la_sales_cents (md5 cc7e84db...): the Louisiana sales total
--     behind facilitator_threshold_check's "sales tax registration coming"
--     admin alert already left out is_seed orders; it now also leaves out an
--     order whose buyer or seller is a test subject (an unmarked test account).
--   * shop_refund_sweep (md5 e9032b8b...): the "Shops order refunded by the
--     clock" admin alert is skipped for a seed order or a test buyer or seller.
--     The refund, strike and member notices are unchanged.
--   * enforce_retained_payment_ban (md5 5f3c20ac...): the "Ban settlement
--     review" admin alert is skipped for a test account, and its error_logs
--     row is tagged seed (error_log_is_seed), so it goes to the daily digest
--     instead of paging. The ban, holds and fraud flag are unchanged.
--   * sweep_open_ban_settlement_reviews (md5 f0a7fa1f...): the same for the
--     24-hour "still waiting" page and bell.
--   * open_dispute_as (md5 2134e232...): the "Job disputed" admin alert is
--     skipped when the opener, the poster or the Helpr is a test subject.
--   * notify_ops_dispute_filed (md5 d7c3ed28...): the Slack page for that same
--     dispute goes to the digest for the same subjects (it already did for an
--     is_seed job).
--
-- public.is_test_subject comes from 20261030143141 (is_test_member, or a
-- fixture / reserved-domain email).
--
-- PGlite proof: src/test/pglite/adminAlertsSkipTestGaps.pglite.mjs.
-- Replay-safe: CREATE OR REPLACE only; grants restated as on prod (service_role
-- only; PUBLIC, anon and authenticated revoked).

CREATE OR REPLACE FUNCTION public.facilitated_la_sales_cents(p_year integer)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH bounds AS (
    SELECT (make_date(p_year, 1, 1)::timestamp AT TIME ZONE 'America/Chicago') AS t0,
           (make_date(p_year + 1, 1, 1)::timestamp AT TIME ZONE 'America/Chicago') AS t1
  )
  SELECT COALESCE((SELECT sum(o.items_cents) FROM public.shop_orders o, bounds b
                    WHERE NOT o.is_seed
                      AND NOT public.is_test_subject(o.buyer_id) AND NOT public.is_test_subject(o.seller_id)
                      AND ((o.status = 'handed_over' AND o.handed_over_at >= b.t0 AND o.handed_over_at < b.t1)
                        OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')
                            AND o.closed_at >= b.t0 AND o.closed_at < b.t1))), 0)::bigint
       + COALESCE((SELECT sum(d.items_cents) FROM public.declutter_orders d, bounds b
                    WHERE NOT d.is_seed AND d.status = 'handed_over'
                      AND NOT public.is_test_subject(d.buyer_id) AND NOT public.is_test_subject(d.seller_id)
                      AND d.handed_over_at >= b.t0 AND d.handed_over_at < b.t1), 0)::bigint;
$fn$;
REVOKE ALL ON FUNCTION public.facilitated_la_sales_cents(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facilitated_la_sales_cents(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_refund_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c record;
  o public.shop_orders;
  r public.shop_refunds;
  a record;
  v_done integer := 0;
BEGIN
  FOR c IN
    SELECT so.id FROM public.shop_orders so
      LEFT JOIN public.shop_handovers h ON h.order_id = so.id
     WHERE so.status = 'accepted' AND so.captured_at IS NOT NULL AND so.handover_mode = 'porch'
       AND h.ready_photo_path IS NULL AND h.problem_at IS NULL
       AND ((so.ready_date + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '3 days' <= now()
     ORDER BY so.ready_date, so.id LIMIT 100
  LOOP
    BEGIN
      o := public.shop_lock_open_charged_order(c.id, false);
      -- Re-read under the lock: a photo posted since the scan wins.
      IF EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = o.id AND h.ready_photo_path IS NOT NULL) THEN
        CONTINUE;
      END IF;
      UPDATE public.shop_orders SET status = 'refunded', close_reason = 'no_ready_photo', closed_at = now()
       WHERE id = o.id AND status = 'accepted';
      r := public.shop_write_refund(o.id, 'no_ready_photo', NULL);
      PERFORM public.shop_give_strike(o.seller_id, 'shop', 'no_ready_photo', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',
        format('The shop never marked your order for %s ready, so all $%s is on its way back to your card.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.refund_cents / 100.0, 'FM999999990.00')),
        '/shops/orders', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'warning', 'Order refunded',
        format('You never posted the ready photo for the order for %s, so the buyer was refunded in full. The $%s card fee comes out of your next payout, and it counts as a Shops strike.',
               to_char(o.ready_date, 'FMMonth FMDD'), to_char(r.card_fee_cents / 100.0, 'FM999990.00')),
        '/shops/dashboard', o.buyer_id);
      -- Test stuff never reaches an admin (owner 2026-10-30): a cron has no
      -- signed-in member and the link is bare '/admin', so the skip is here.
      IF NOT (o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
        FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
          PERFORM public.declutter_notify(a.user_id, 'warning', 'Shops order refunded by the clock',
            'A left-out Shops order had no ready photo 3 days after its date, so the buyer was refunded and the shop got a strike.', '/admin');
        END LOOP;
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('shop_refund_sweep', c.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('no_ready_photo_refunded', v_done);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_refund_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_refund_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_retained_payment_ban(
  p_user_id            uuid,
  p_kind               text,
  p_stripe_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_h        text;
  v_email    text;
  v_status   text;
  v_own_h    text;
  v_row      RECORD;
  v_already  boolean;
  v_test     boolean;
  v_own_reason CONSTANT text :=
    'A payment method on this account is linked to an account closed for breaking our Platform Rules. '
    || 'Contact support if you think this is a mistake.';
BEGIN
  -- Caller errors are errors: an edge function that passes nothing must hear
  -- about it, not get a quiet "not banned".
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('card', 'bank') THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: kind must be card or bank, got %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_stripe_fingerprint IS NULL OR btrim(p_stripe_fingerprint) = '' THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: a Stripe fingerprint is required' USING ERRCODE = '22023';
  END IF;

  -- Raises if the Vault salt is missing (ban_fingerprint_salt), which the
  -- caller reports. Never an unsalted hash.
  v_h := public.ban_fingerprint(p_kind, p_stripe_fingerprint);

  SELECT email, ban_status INTO v_email, v_status
    FROM public.profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enforce_retained_payment_ban: no profile for %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.payment_fingerprints (user_id, fingerprint_kind, fingerprint_sha256)
  VALUES (p_user_id, p_kind, v_h)
  ON CONFLICT (user_id, fingerprint_kind, fingerprint_sha256) DO UPDATE SET last_seen_at = now();

  v_already := COALESCE(v_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned');
  v_own_h := CASE WHEN v_email IS NULL OR btrim(v_email) = '' THEN NULL
                  ELSE encode(sha256(lower(btrim(v_email))::bytea), 'hex') END;

  -- A banned account that attaches a new card or bank: its own retained row
  -- picks the new key up, so the NEXT account to use it is caught.
  IF v_already THEN
    PERFORM public.retain_ban_for_user(p_user_id, 'ban');
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans rb
   WHERE ((p_kind = 'card' AND v_h = ANY (rb.card_sha256))
       OR (p_kind = 'bank' AND v_h = ANY (rb.bank_sha256)))
     AND rb.email_sha256 IS DISTINCT FROM v_own_h
     -- An admin looked at this account with this card / bank and lifted the
     -- ban: the same payment method does not ban it again (every retained
     -- row that holds it, including later accounts banned on it).
     AND NOT EXISTS (
       SELECT 1 FROM public.ban_evasion_matches m
        WHERE m.user_id = p_user_id AND m.matched_on = p_kind
          AND m.match_sha256 = v_h AND m.cleared_at IS NOT NULL
     )
   -- The OLDEST live retained ban on it: the account that first used this
   -- card / bank and was banned, not a later account banned only for it.
   ORDER BY (rb.expires_at IS NULL) DESC, rb.retained_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  -- A spent suspension is retired on sight, as on every other key.
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  -- Apply the retained judgment, exactly as enforce_retained_ban does, unless
  -- the account is already banned (never soften or re-date an existing ban).
  --
  -- user_bans BEFORE the profile write: the profile write fires
  -- trg_retain_ban_on_ban, whose retain_ban_for_user reads the newest active
  -- user_bans row for the reason this account's own retained row will carry.
  IF NOT v_already THEN
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

    -- The reason the person sees on /account-banned (and in their data
    -- export) is about THEM, never the other account's ban reason: a shared
    -- card or bank account may belong to someone else entirely.
    -- 'banned' with no end date while the review is open (authz review,
    -- 2026-10-05): a temporary judgment must not expire and lift the account
    -- (sweep_expired_auto_bans) before an admin has decided. The retained
    -- judgment itself is kept on the review and applied by the confirm.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           'banned',
           v_own_reason,
           p_user_id,
           NULL,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_own_reason
     );

    PERFORM set_config('app.retained_ban_reapply', 'off', true);

    INSERT INTO public.ban_settlement_queue (user_id, matched_on, original_ban_status, original_expires_at)
    VALUES (p_user_id, p_kind, v_row.ban_status, v_row.expires_at)
    ON CONFLICT (user_id) WHERE review_state = 'open' DO NOTHING;

    -- BAN NOW, ADMIN SETTLES (owner 2026-10-05): the profile write below fires
    -- the permanent-ban settlement triggers; this transaction-local flag makes
    -- them leave the jobs to the review instead of cancelling them.
    PERFORM set_config('app.ban_settlement_review', 'on', true);
    UPDATE public.profiles
       SET ban_status           = 'banned',
           auto_suspended_until = NULL
     WHERE user_id = p_user_id;
    PERFORM set_config('app.ban_settlement_review', 'off', true);

    -- Every admin hears of it now (the hourly ban-review-watch pages again
    -- once it has waited 24 hours). Not for a test account (owner
    -- 2026-10-30): no admin bell, and its error_logs row is seed-tagged, so it
    -- goes to the daily digest instead of paging.
    v_test := public.is_test_subject(p_user_id);
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ban settlement review: an account was banned automatically',
             'It matched a banned account''s ' || p_kind || '. Its jobs and escrow are frozen until you confirm or lift the ban in the fraud console.',
             'admin_alert',
             '/admin?view=fraud'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         AND NOT v_test;
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Ban settlement review opened: account %s banned automatically on a %s match. Its jobs and escrow are frozen until an admin confirms or lifts it (docs/OPEN.md Q1324).', p_user_id, p_kind),
              jsonb_build_object('source', 'ban-settlement-review-opened', 'area', 'money', 'seed', v_test),
              jsonb_build_object('user_id', p_user_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_retained_payment_ban: review alert failed for %: %', p_user_id, SQLERRM;
    END;

    -- "Can't get paid": a payout hold stops every transfer to the account
    -- (Q764) and freezes its Stripe automatic payouts (Q1221). A hold an
    -- admin already placed is left as it is.
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (p_user_id,
            'Q1324: banned automatically (a banned account''s ' || p_kind || ' matched). Ban settlement review open.',
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
  END IF;

  -- The other account's ban details, for admins only (never exported).
  INSERT INTO public.ban_evasion_matches (
    user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
    original_recorded_at, original_expires_at, auto_banned
  )
  VALUES (p_user_id, p_kind, v_h, v_row.id, v_row.ban_status, v_row.reason,
          v_row.retained_at, v_row.expires_at, NOT v_already)
  ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;

  -- The fraud console notice. It holds nothing about the OTHER account: this
  -- row is exported to the person it is about (export_my_data).
  BEGIN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    SELECT
      p_user_id,
      'ban_evasion_attempt',
      format(
        'Payment method blocked: this account''s %s matched one retained from a banned account. %s '
        || 'Account email: %s.',
        p_kind,
        CASE WHEN v_already THEN 'It was already banned; its ban was left as it was.'
             ELSE 'It was banned automatically; its jobs wait for an admin decision.' END,
        COALESCE(v_email, '(unknown)')
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fraud_flags f
       WHERE f.user_id = p_user_id
         AND f.flag_type = 'ban_evasion_attempt'
         AND NOT f.resolved
         AND f.details LIKE 'Payment method blocked: this account''s ' || p_kind || ' matched%'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_retained_payment_ban: fraud flag failed for %: %', p_user_id, SQLERRM;
  END;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',         true,
    'matched_on',     p_kind,
    'already_banned', v_already,
    'ban_status',     v_row.ban_status,
    'expires_at',     v_row.expires_at,
    'retained_id',    v_row.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_retained_payment_ban(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_open_ban_settlement_reviews()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r       record;
  v_open  integer := 0;
  v_paged integer := 0;
  v_test  boolean;
BEGIN
  FOR r IN
    SELECT q.id, q.user_id, q.matched_on, q.created_at, q.alerted_at
      FROM public.ban_settlement_queue q
     WHERE q.review_state = 'open'
     ORDER BY q.created_at
  LOOP
    v_open := v_open + 1;
    IF r.created_at < now() - interval '24 hours'
       AND (r.alerted_at IS NULL OR r.alerted_at < now() - interval '24 hours') THEN
      -- A test account's review never pages or reaches an admin's bell (owner
      -- 2026-10-30): its row is seed-tagged (daily digest) and no notification.
      v_test := public.is_test_subject(r.user_id);
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('fatal',
              format('Ban settlement review open for %s hours (account %s, banned on a %s match). Its jobs and their escrow are frozen until an admin confirms or lifts it in the fraud console (docs/OPEN.md Q1324).',
                     floor(extract(epoch FROM now() - r.created_at) / 3600)::int, r.user_id, r.matched_on),
              jsonb_build_object('source', 'ban-settlement-review-open', 'area', 'money', 'seed', v_test),
              jsonb_build_object('user_id', r.user_id, 'review_id', r.id, 'opened_at', r.created_at));
      BEGIN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        SELECT ur.user_id,
               'Ban settlement review still waiting',
               format('An account banned on a %s match has waited %s hours. Its jobs and escrow are frozen until you confirm or lift the ban.',
                      r.matched_on, floor(extract(epoch FROM now() - r.created_at) / 3600)::int),
               'admin_alert',
               '/admin?view=fraud'
          FROM public.user_roles ur
         WHERE ur.role = 'admin'
           AND NOT v_test;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ban review watch: admin alert failed: %', SQLERRM;
      END;
      UPDATE public.ban_settlement_queue SET alerted_at = now() WHERE id = r.id;
      v_paged := v_paged + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('open', v_open, 'paged', v_paged);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_open_ban_settlement_reviews() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_open_ban_settlement_reviews() TO service_role;

CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
  _payment_status text;
  _is_group boolean;
  _crew boolean := false;
  _on_crew boolean := false;
  _member uuid;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text, payment_status, is_group_job
    INTO _customer, _helper, _title, _status, _payment_status, _is_group
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- A crew has no lead (Q407): jobs.helper_id is NULL on every group job, so
  -- the Helpr side of a crew is its roster. Read under the jobs lock above.
  _crew := _is_group IS TRUE;
  _on_crew := _crew AND _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid);

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  -- NULL-safe (Q728): this read `_uid <> _customer AND _uid <> _helper`, and
  -- on a crew `_uid <> NULL` is NULL, so the IF never fired and ANY signed-in
  -- account could open a dispute on any booked crew job, freezing its escrow.
  IF NOT _system
     AND _uid IS DISTINCT FROM _customer
     AND (_helper IS NULL OR _uid IS DISTINCT FROM _helper)
     AND NOT _on_crew THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  -- (Live guard from 20260915025607, kept verbatim when this migration was
  -- re-derived from the live definition on 2026-09-15.)
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  -- ── Evidence is the filer's own uploads, nothing else (authz review of the
  -- dispute-races rebase, MEDIUM). Both the new-dispute path and the re-file
  -- branch below store `_evidence_urls` verbatim, and they render as <a>/<img>
  -- in the admin console and the other party's dialog. A person may attach only
  -- signed proof-photos URLs for their own uploads on this job
  -- (dispute_evidence_url_ok, section 8); the platform files with none.
  IF _system THEN
    IF COALESCE(cardinality(_evidence_urls), 0) > 0 THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'A platform filing carries no evidence.';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_urls, '{}'::text[])) AS e(u)
     WHERE NOT public.dispute_evidence_url_ok(e.u, _uid, _job_id)
  ) THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- ── Not over a decided dispute whose money has not moved ────────────────
  -- rpc_decide_dispute leaves the job completed/cancelled with the escrow held
  -- until execute-dispute-split settles it. A party re-filing then flipped the
  -- job back to `disputed` (and a withdrawal to in_progress), which handed the
  -- escrow to Quick Release / Quick Refund / the sweep and, via
  -- poster_cancel_job, to void-cancelled-payments — each settling over the
  -- admin's decision, and "Retry settlement" moving the split on top (both
  -- reviews, round 2, HIGH; live shape on prod: job bb2c3732 / dispute
  -- c7a12050). The decision stands until it executes.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) THEN
    RAISE EXCEPTION 'dispute_already_decided'
      USING HINT = 'An admin has already decided this dispute and its payment is being settled.';
  END IF;

  -- ── Not while the escrow is being cancelled ─────────────────────────────
  -- `cancelling` is cancel_escrow's claim: its Stripe refund is in flight.
  -- A dispute stamped onto that job made it `disputed` with the refund still
  -- going out, and an admin Quick Release then paid the Helpr beside it.
  -- claim_dispute_settlement now refuses that shape too; this stops it being
  -- created. Read under the FOR UPDATE above, so cancel_escrow's claim either
  -- committed first (visible here) or waits behind this filing (and its own
  -- status-pinned claim then matches zero rows).
  IF _payment_status = 'cancelling' THEN
    RAISE EXCEPTION 'dispute_payment_being_cancelled'
      USING HINT = 'This job''s payment is being cancelled and refunded, so it can no longer be disputed.';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- Set-like append, 20260915034822. A DOUBLE SUBMIT from the dispute
    -- dialog — two clicks inside one JS task, both past the React-state
    -- `submitting` flag because state does not land until the next render —
    -- sends two calls. The second blocks on the FOR UPDATE above, then lands
    -- HERE, and with a bare `||` it appended the SAME evidence urls a second
    -- time: the admin queue showed each photo twice and `evidence_urls` grew
    -- without bound on every retry. The client now holds a synchronous ref
    -- guard as well (DisputeDialog.tsx), but a guard in the browser is not a
    -- guarantee; this is.
    UPDATE public.disputes
    SET evidence_urls = (
          SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
            FROM (
              SELECT u, min(ord) AS ord
                FROM unnest(
                       evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
                     ) WITH ORDINALITY AS t(u, ord)
               GROUP BY u
            ) d
        )
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = (
             SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
               FROM (
                 SELECT u, min(ord) AS ord
                   FROM unnest(
                          COALESCE(dispute_evidence_urls, '{}'::text[])
                            || COALESCE(_evidence_urls, '{}'::text[])
                        ) WITH ORDINALITY AS t(u, ord)
                  GROUP BY u
               ) d
           )
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  -- ── The job must still be disputable, 20260915034822 ────────────────────
  -- The re-freeze branch above has always checked `_status` against the
  -- transition matrix's own `-> disputed` edges. The NEW-dispute path below
  -- never did: it inserted the row and stamped status='disputed'
  -- unconditionally. `_status` was read under the FOR UPDATE above, so a
  -- concurrent `poster_cancel_job` / completion / payout either commits BEFORE
  -- this call takes the lock (and is therefore visible in `_status`) or waits
  -- behind it — which is exactly why checking it here closes the window
  -- instead of merely narrowing it.
  --
  -- Without it, filing a dispute that raced a cancellation either stamped
  -- `disputed` onto a cancelled job (freezing an escrow that had already been
  -- refunded) or raised `enforce_job_status_transition`'s raw Postgres prose at
  -- the filer. A terse code instead, so `lifecycleErrorMessage` can say what
  -- happened; the allowed set is the same list the re-freeze branch uses.
  IF _status NOT IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- Q1262(1): the Helpr's answer to the PREVIOUS dispute on this job is kept
  -- on that dispute's own row before the UPDATE below clears the job's copy
  -- (Q1165). Without this a poster could withdraw and re-file to wipe the
  -- Helpr's statement for good. Only into a closed row that has none yet.
  -- This runs as a definer INSIDE the party's session, so the opener
  -- whitelist trigger sees a party's write: a transaction-local flag, set only
  -- here and cleared right after (as rpc_withdraw_dispute's
  -- app.dispute_withdraw_rpc), lets exactly this NULL -> answer write through
  -- (lh-authz-rls review, 2026-10-05: without it the re-file raised 42501).
  PERFORM set_config('app.dispute_archive_rpc', '1', true);
  UPDATE public.disputes d
     SET helper_response = j.dispute_helper_response
    FROM public.jobs j
   WHERE j.id = _job_id
     AND j.dispute_helper_response IS NOT NULL
     AND d.helper_response IS NULL
     AND d.id = (SELECT p.id FROM public.disputes p
                  WHERE p.job_id = _job_id AND p.status <> 'open'
                  ORDER BY p.created_at DESC LIMIT 1);
  PERFORM set_config('app.dispute_archive_rpc', '0', true);

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         -- Q1165: a NEW dispute starts with no Helpr answer. A withdrawn
         -- dispute's answer survived the re-file, rendered under the new
         -- complaint, and (write-once since 20261003180355) stopped the Helpr
         -- answering it. SECURITY DEFINER, so the table-door trigger does not
         -- apply to this write.
         dispute_helper_response = NULL,
         dispute_status = 'open',
         -- Q1262(3): a NEW dispute starts from its own evidence and is not
         -- resolved: the job's legacy mirror no longer carries the withdrawn
         -- dispute's photos under the new complaint (they stay on that
         -- dispute's own row), and the withdrawal's dispute_resolved_at stamp
         -- (can_review_job reads it) is cleared with the answer.
         dispute_resolved_at = NULL,
         dispute_evidence_urls = COALESCE(_evidence_urls, '{}'::text[])
   -- Belt and braces on the predicate above: the same allowed set, written
   -- into the statement itself so the freeze can never land on a job that
   -- moved on, even if a future edit drops the IF.
   WHERE id = _job_id
     AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed — dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and an admin will decide it — add your side.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END IF;
    -- A crew has no helper_id: every hired member is told instead.
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE _crew AND g.job_id = _job_id AND g.helper_id IS NOT NULL
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _crew THEN
    -- A crew: every hired member's pay is now on hold, so every member other
    -- than the filer is told; so is the poster when a member filed.
    IF _uid IS DISTINCT FROM _customer AND _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL AND g.helper_id IS DISTINCT FROM _uid
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The crew''s payment is on hold while it is reviewed — add your side so an admin hears it.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  -- Not for test accounts (owner 2026-10-30): a dispute a test account opened,
  -- or on a job a test account posted or works, never reaches an admin's bell.
  IF NOT (public.is_test_subject(_uid) OR public.is_test_subject(_customer) OR public.is_test_subject(_helper)) THEN
    FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        _admin,
        'Job disputed',
        '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
        'warning',
        '/admin?view=disputes',
        _job_id
      );
    END LOOP;
  END IF;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_ops_dispute_filed(
  _job_id uuid,
  _job_title text,
  _reason text,
  _opener_id uuid,
  _refiled boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_key text;
  v_seed boolean;
  v_title text;
  v_message text;
  v_fields jsonb;
  v_link text := 'https://www.louisianahelpr.com/admin?view=disputes';
BEGIN
  v_title := CASE WHEN _refiled THEN 'Job re-disputed — escrow re-frozen'
                  ELSE 'Job disputed' END;
  v_message := '*' || COALESCE(_job_title, 'a job') || '* — ' || COALESCE(_reason, 'no reason given')
               || '. Payment is on hold pending admin review.';
  v_fields := jsonb_build_object(
    'Job ID',      _job_id::text,
    'Reason',      COALESCE(_reason, '—'),
    'Disputed by', _opener_id::text,
    'Re-filed',    CASE WHEN _refiled THEN 'yes' ELSE 'no' END
  );

  SELECT j.is_seed INTO v_seed FROM public.jobs j WHERE j.id = _job_id FOR KEY SHARE;
  -- A test account's dispute goes to the digest too (owner 2026-10-30: test
  -- stuff never reaches the owner): the opener, or the job's poster or Helpr.
  v_seed := coalesce(v_seed, false)
    OR public.is_test_subject(_opener_id)
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id
                 AND (public.is_test_subject(j.customer_id) OR public.is_test_subject(j.helper_id)));
  IF coalesce(v_seed, false) THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      'info',
      left(v_title || ' — ' || v_message, 1000),
      jsonb_build_object('source', 'ops-alert-seed', 'kind', 'dispute_filed',
                         'seed', true, 'would_have_been', 'critical'),
      jsonb_build_object('fields', v_fields, 'link', v_link)
    );
    RETURN;
  END IF;

  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notify_ops_dispute_filed: vault secrets missing — Slack alert skipped for job %', _job_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/slack-ops-alert',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'kind',     'dispute_filed',
      'severity', 'critical',
      'title',    v_title,
      'message',  v_message,
      'fields',   v_fields,
      -- `?view=`, not `?tab=`: Admin.tsx reads searchParams.get("view").
      'link',     v_link
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_net absent, http_post signature changed, vault unreadable — none of
  -- these are worth failing a dispute over.
  RAISE WARNING 'notify_ops_dispute_filed: alert not posted for job %: %', _job_id, SQLERRM;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) TO service_role;

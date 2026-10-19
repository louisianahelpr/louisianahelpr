-- A payout waits for its payee's Stripe setup without starving the queue or
-- going silent (Q2150 follow-up, /code-review of f6551863a; closes Q2197 for Shops).
--
-- Before: declutter-money skipped a payout whose payee could not be paid yet
-- (no payout account, Stripe setup unfinished, on payout hold, under ban review,
-- a failed hold read) WITHOUT moving its next_attempt_at, so those rows kept the
-- oldest dates and filled the 25-row batch of declutter_payouts_due /
-- helpr_task_payouts_due / shop_payouts_due every run: ready payees behind them
-- were never reached (starvation), and a payee who never finished setup waited
-- forever with nobody told.
--
-- The queues are NOT changed (declutter-money still reconciles every offered row
-- against Stripe before anything else, so a transfer that was sent but not
-- recorded is always recorded, never paid twice). Instead:
--   payout_defer          every skipped row moves its next_attempt_at forward
--                         (no try used), so nothing stays at the front: the
--                         three payout queues, and the two refund queues for a
--                         refund skipped under ban review (declutter_refunds_due
--                         is restated so a deferred PENDING refund waits too).
--   payout_payee_wait_seen one sighting of EVERY deferred payout (no defer is
--                         unbounded): ops are paged once per payout when its
--                         bound is reached (at once for rejected / unusable /
--                         payee deleted / mixed parties; 24 h for passing
--                         failures, an unrecorded transfer or an unreadable
--                         account; 7 days for setup, review, holds), again only
--                         when the reason turns into one that will not fix
--                         itself; the payee is reminded every 3 days (per payee)
--                         in words for the reasons they can act on.
--   payout_mark_sending / payout_send_marks_for  a send is marked before the
--                         Stripe call, so a transfer sent but not recorded is
--                         reconciled first next run even with no try counted.
--   payout_payee_paged    marks the payout paged (with its reason), called only
--                         AFTER the Slack post went through (a failed post is
--                         retried next run).
--   payout_payee_wait_cleared / payout_payee_waits_prune  a payout that reached
--                         ANY end (paid, nothing due, gave up, cancelled) loses its
--                         wait row, so a later wait starts fresh and is paged again.
-- The money stays on the platform the whole time; nothing gives up.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE; grants by role name; REVOKE ... FROM
-- PUBLIC, anon, authenticated (service only). No index beyond the primary key,
-- no foreign key (no new advisor finding). Applied 3x by
-- src/test/pglite/payoutWaitsForPayee.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.payout_payee_waits (
  payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund')),
  payout_id uuid NOT NULL,
  -- NULL: the payee deleted their account (the payout row's person column was set null).
  payee_id uuid,
  -- Why it waits now, and the reason the one ops page was sent for (a change to a reason
  -- that will not fix itself pages again).
  category text NOT NULL DEFAULT 'setup_unfinished',
  paged_category text,
  first_waiting_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_reason text NOT NULL CHECK (char_length(last_reason) BETWEEN 1 AND 200),
  last_reminded_at timestamptz,
  ops_paged_at timestamptz,
  PRIMARY KEY (payout_kind, payout_id)
);
ALTER TABLE public.payout_payee_waits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_payee_waits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payout_payee_waits TO service_role;
COMMENT ON TABLE public.payout_payee_waits IS
  'Payouts waiting on the payee''s Stripe setup: when the wait began, the last reminder, the one ops page. Cleared when paid. Service only.';

-- A skipped row: try it again later WITHOUT using a try. Only an unsent row moves.
CREATE OR REPLACE FUNCTION public.payout_defer(p_kind text, p_payout_id uuid, p_minutes integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_until timestamptz := now() + make_interval(mins => least(greatest(COALESCE(p_minutes, 60), 5), 1440));
BEGIN
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_defer(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_defer(text, uuid, integer) TO service_role;

-- The refund queue, restated from 20261017055505 with TWO changes: a seller payout settled by
-- hand counts as gone (a delivery_damage refund is not blocked forever), and a PENDING row
-- also waits for its next_attempt_at, so a refund skipped under ban review and
-- deferred leaves the front of the queue (it used to be picked by created_at
-- alone). A new pending row's next_attempt_at is its insert time, so nothing
-- else moves.
CREATE OR REPLACE FUNCTION public.declutter_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- buyer/seller pick the Stripe mode (test accounts on the test key) in declutter-money.
  SELECT r.id, r.reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, r.attempts,
         r.payment_livemode, o.stripe_checkout_session_id
    FROM public.declutter_refunds r
    LEFT JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE ((r.status = 'pending' AND r.created_at <= now() - interval '2 minutes' AND r.next_attempt_at <= now())
          OR (r.status = 'failed' AND r.next_attempt_at <= now()))
     AND r.attempts < 12
     AND (r.reason <> 'delivery_damage'
          OR EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = r.order_id
                       AND p.status IN ('succeeded', 'nothing_due', 'settled_by_hand')))
   ORDER BY r.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refunds_due(integer) TO service_role;

-- The 3-day reminder throttle is per PAYEE and outlives any one wait row (clearing a
-- paid payout's wait never re-reminds the payee about the others).
CREATE TABLE IF NOT EXISTS public.payout_payee_reminders (
  payee_id uuid PRIMARY KEY,
  last_reminded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payout_payee_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_payee_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payout_payee_reminders TO service_role;

-- A transfer is about to be sent for this payout: marked BEFORE the Stripe call, so if
-- the transfer goes out and recording it fails, the next run knows a transfer may exist
-- and reconciles before anything else (attempts alone does not show it).
CREATE TABLE IF NOT EXISTS public.payout_send_marks (
  payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
  payout_id uuid NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payout_kind, payout_id)
);
ALTER TABLE public.payout_send_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_send_marks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payout_send_marks TO service_role;

CREATE OR REPLACE FUNCTION public.payout_mark_sending(p_kind text, p_payout_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  INSERT INTO public.payout_send_marks (payout_kind, payout_id) VALUES (p_kind, p_payout_id)
  ON CONFLICT (payout_kind, payout_id) DO UPDATE SET marked_at = now();
$fn$;
REVOKE ALL ON FUNCTION public.payout_mark_sending(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_mark_sending(text, uuid) TO service_role;

-- Which of these payouts may already have a transfer (a send was started for them).
CREATE OR REPLACE FUNCTION public.payout_send_marks_for(p_kind text, p_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT m.payout_id FROM public.payout_send_marks m WHERE m.payout_kind = p_kind AND m.payout_id = ANY (p_ids);
$fn$;
REVOKE ALL ON FUNCTION public.payout_send_marks_for(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_send_marks_for(text, uuid[]) TO service_role;

-- One sighting of a payout declutter-money deferred (EVERY defer: no defer is unbounded).
-- p_category says why, and sets the bound after which ops are paged ONCE per payout
-- (again only if the reason changes to one that will not fix itself):
--   at once   rejected (Stripe rejected the account), unusable (the account is gone),
--             payee_deleted (the payee deleted their Louisiana Helpr account),
--             mixed_parties (a test account and a real one: settle by hand)
--   24 hours  transient (Stripe / lookup failures), record_failed (a transfer Stripe
--             holds could not be recorded), unreadable (Stripe refuses OUR read of
--             this one account)
--   7 days    no_account, setup_unfinished, under_review, held (admin payout hold),
--             ban_review
-- The payee is reminded (every 3 days per payee, payout_payee_reminders; never a banned
-- payee or one on payout hold) only for the reasons they can act on, in words for it:
--   no_account / setup_unfinished -> "finish payout setup"; under_review -> "Stripe is
--   reviewing your account"; rejected -> "contact support"; unusable -> "set up again".
CREATE OR REPLACE FUNCTION public.payout_payee_wait_seen(p_kind text, p_payout_id uuid, p_payee uuid, p_amount_cents integer,
  p_category text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w public.payout_payee_waits;
  v_page boolean := false;
  v_remind boolean := false;
  v_quiet boolean;
  v_bound interval;
  v_amount text := to_char(COALESCE(p_amount_cents, 0) / 100.0, 'FM999999990.00');
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund') OR p_payout_id IS NULL
     OR p_category IS NULL OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable',
       'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'transient', 'record_failed', 'unreadable', 'held', 'ban_review',
       'suspended', 'needs_reconcile') THEN
    RAISE EXCEPTION 'invalid_wait' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payout_payee_waits (payout_kind, payout_id, payee_id, category, last_reason)
  VALUES (p_kind, p_payout_id, p_payee, p_category, left(p_category || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''), 200))
  ON CONFLICT (payout_kind, payout_id) DO UPDATE
    SET last_checked_at = now(), last_reason = EXCLUDED.last_reason, payee_id = EXCLUDED.payee_id, category = EXCLUDED.category
  RETURNING * INTO w;
  -- The payee is nudged only for what they can act on, never when banned or on payout hold.
  v_quiet := p_payee IS NULL
          OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable')
          OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = p_payee
                       AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned'))
          OR EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = p_payee);
  IF NOT v_quiet AND NOT EXISTS (SELECT 1 FROM public.payout_payee_reminders r
                                  WHERE r.payee_id = p_payee AND r.last_reminded_at > now() - interval '3 days') THEN
    v_remind := true;
    INSERT INTO public.payout_payee_reminders (payee_id, last_reminded_at) VALUES (p_payee, now())
    ON CONFLICT (payee_id) DO UPDATE SET last_reminded_at = now();
    UPDATE public.payout_payee_waits SET last_reminded_at = now() WHERE payout_kind = p_kind AND payout_id = p_payout_id;
    PERFORM public.declutter_notify(p_payee, 'payment',
      CASE p_category
        WHEN 'under_review' THEN 'Stripe is reviewing your payout account'
        WHEN 'rejected' THEN 'Your payout account needs help'
        WHEN 'unusable' THEN 'Set up payouts again to get paid'
        ELSE 'Finish payout setup to get paid' END,
      CASE p_category
        WHEN 'under_review' THEN format('$%s is waiting for you. Stripe is reviewing your payout account; we send it as soon as they finish. Nothing to do unless Stripe asks you for something.', v_amount)
        WHEN 'rejected' THEN format('$%s is waiting for you, but Stripe would not approve your payout account. Contact Louisiana Helpr support and we will help you sort it out.', v_amount)
        WHEN 'unusable' THEN format('$%s is waiting for you, but your payout account can no longer be used. Set up payouts again in your profile''s Earnings tab.', v_amount)
        ELSE format('$%s is waiting for you. Finish payout setup in your profile''s Earnings tab and we send it right away.', v_amount) END,
      '/profile?tab=earnings');
  END IF;
  -- Ops: ONCE per payout when its bound is reached; again only when the reason changed to
  -- one that will not fix itself. Only ANSWERED here: payout_payee_paged marks it after the
  -- Slack post went through.
  v_bound := CASE WHEN p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile') THEN interval '0'
                  WHEN p_category IN ('transient', 'record_failed', 'unreadable') THEN interval '24 hours'
                  ELSE interval '7 days' END;
  IF (w.ops_paged_at IS NULL
      OR (w.paged_category IS DISTINCT FROM p_category AND p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile')))
     AND w.first_waiting_at <= now() - v_bound THEN
    v_page := true;
  END IF;
  RETURN jsonb_build_object('page_due', v_page, 'reminded', v_remind, 'waiting_since', w.first_waiting_at,
    'payee_seed', COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = p_payee), false));
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) TO service_role;

-- The Slack page for this payout went through: marked with the reason it was paged for.
CREATE OR REPLACE FUNCTION public.payout_payee_paged(p_kind text, p_payout_id uuid, p_category text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  UPDATE public.payout_payee_waits SET ops_paged_at = now(), paged_category = p_category
   WHERE payout_kind = p_kind AND payout_id = p_payout_id;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_paged(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_paged(text, uuid, text) TO service_role;

-- Every wait whose payout reached an end (paid, nothing due, gave up after 12 tries,
-- or gone): the row goes, so a later wait starts fresh. Run once per money run.
CREATE OR REPLACE FUNCTION public.payout_payee_waits_prune()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.payout_payee_waits w
   WHERE NOT EXISTS (
     SELECT 1 FROM public.declutter_payouts p WHERE w.payout_kind = 'declutter' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.helpr_task_payouts p WHERE w.payout_kind = 'helpr_task' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.shop_payouts p WHERE w.payout_kind = 'shop' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.declutter_refunds r WHERE w.payout_kind = 'declutter_refund' AND r.id = w.payout_id
        AND r.status IN ('pending', 'failed') AND r.attempts < 12
     UNION ALL
     SELECT 1 FROM public.declutter_delivery_refunds r WHERE w.payout_kind = 'delivery_refund' AND r.id = w.payout_id
        AND r.status IN ('pending', 'failed') AND r.attempts < 12);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- A send mark of a payout that ended is no longer needed (the ended row is never offered again);
  -- a held-for-review row keeps its mark until it is settled or released (a transfer may exist).
  DELETE FROM public.payout_send_marks m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.declutter_payouts p WHERE m.payout_kind = 'declutter' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')
     UNION ALL
     SELECT 1 FROM public.helpr_task_payouts p WHERE m.payout_kind = 'helpr_task' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')
     UNION ALL
     SELECT 1 FROM public.shop_payouts p WHERE m.payout_kind = 'shop' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review'));
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_waits_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_waits_prune() TO service_role;

-- Paid, settled by hand, or its payee is ready: the wait (and its page marker) goes.
CREATE OR REPLACE FUNCTION public.payout_payee_wait_cleared(p_kind text, p_payout_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_payout_id;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_wait_cleared(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_wait_cleared(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- HELD FOR REVIEW (/code-review of the payout-readiness change): a payout or refund that will
-- not pay itself (rejected / unusable account, payee deleted, mixed test and real parties, a
-- banned payee, a data defect, or a transfer that may already exist: needs_reconcile) leaves
-- EVERY cron queue for good: status 'held_for_review' (the queues offer only 'pending' /
-- 'failed'). Only an admin moves it on, both audited, both synchronous (no pending state):
--   admin_payout_release        back to 'pending'. ALWAYS needs the admin's confirmation
--                               "I confirmed in Stripe that no transfer / refund for this row
--                               was made outside the app".
--   admin_payout_settle_by_hand  terminal at once, with what it was settled with: a Stripe id
--                               (tr_ / po_ for a payout, re_ / pyr_ for a refund) or
--                               "other: <how>" for money paid outside Stripe (a deleted payee
--                               paid by check), the amount and a note. Guardrails only, the
--                               human decides: the Stripe id must not already be recorded on
--                               ANY money row in the app (money_ref_in_use scans every text
--                               column that stores a Stripe transfer / refund / payout id;
--                               payout_settlements is UNIQUE), except a Dashboard refund the
--                               hand-refund ledger recorded with no row for THIS row's payment,
--                               which is ADOPTED (linked). A tr_ on a payout and a re_ / pyr_
--                               on a refund make the row 'succeeded' with that id (a refund
--                               only for at least the amount owed: settle_amount_short) (a Declutter refund
--                               through the hand-refund ledger, so a later failure still
--                               reconciles); anything else is 'settled_by_hand'.
-- A payee who re-onboards later is never sent a second transfer: the row never returns to a queue.
DO $do$
BEGIN
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_status_check;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
  ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_status_check;
  ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
  ALTER TABLE public.shop_payouts DROP CONSTRAINT IF EXISTS shop_payouts_status_check;
  ALTER TABLE public.shop_payouts ADD CONSTRAINT shop_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_status_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand'));
  ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_status_check;
  ALTER TABLE public.declutter_delivery_refunds ADD CONSTRAINT declutter_delivery_refunds_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'held_for_review', 'settled_by_hand'));
END
$do$;
ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;
ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;
ALTER TABLE public.shop_payouts ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;
ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;
ALTER TABLE public.declutter_delivery_refunds ADD COLUMN IF NOT EXISTS review_reason text, ADD COLUMN IF NOT EXISTS review_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;

-- ONE ledger of everything a held row was settled by hand with: one Stripe id settles one
-- row, once (UNIQUE); money paid outside Stripe is recorded by its note.
CREATE TABLE IF NOT EXISTS public.payout_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_ref text UNIQUE CHECK (stripe_ref IS NULL OR stripe_ref ~ '^(tr|re|pyr|po)_[A-Za-z0-9]+$'),
  off_stripe_note text CHECK (off_stripe_note IS NULL OR char_length(off_stripe_note) BETWEEN 3 AND 300),
  row_kind text NOT NULL CHECK (row_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund')),
  row_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_settlements_what CHECK ((stripe_ref IS NULL) <> (off_stripe_note IS NULL))
);
ALTER TABLE public.payout_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_settlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payout_settlements TO service_role;

-- Is this Stripe id already recorded on ANY money row in the app? Every base-table text column
-- whose name says it holds a Stripe transfer / refund / payout id (job payouts, instant payouts,
-- crew and cancellation fees, tips, Declutter, Shops, refunds, the hand-refund ledger, this
-- settle ledger), found from the catalog so a table added later is covered too.
CREATE OR REPLACE FUNCTION public.money_ref_in_use(p_ref text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c record;
  v boolean;
BEGIN
  FOR c IN
    SELECT col.table_name, col.column_name
      FROM information_schema.columns col
      JOIN information_schema.tables tab ON tab.table_schema = col.table_schema AND tab.table_name = col.table_name
     WHERE col.table_schema = 'public' AND tab.table_type = 'BASE TABLE' AND col.data_type = 'text'
       AND (col.column_name ~ '(transfer_id|refund_id|refund_ref|payout_id|transfer_ref)$'
            OR col.column_name IN ('stripe_ref', 'settled_by_hand_ref'))
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I = $1)', c.table_name, c.column_name) INTO v USING p_ref;
    IF v THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.money_ref_in_use(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_ref_in_use(text) TO service_role;

-- The page for a won't-fix-itself reason went through: the row is held for review and the
-- wait marked paged, so nothing pays it automatically from here on.
CREATE OR REPLACE FUNCTION public.payout_hold_for_review(p_kind text, p_id uuid, p_category text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := left(p_category || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''), 300);
  v_n integer;
BEGIN
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.payout_payee_waits SET ops_paged_at = now(), paged_category = p_category
   WHERE payout_kind = p_kind AND payout_id = p_id;
  RETURN v_n = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_hold_for_review(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_hold_for_review(text, uuid, text, text) TO service_role;

-- Every held row for the admin money page: who and where it goes, how much, its Stripe group /
-- payment, and the refs OTHER rows of the same payee already recorded (so a sibling's transfer
-- is never reused for this one).
CREATE OR REPLACE FUNCTION public.admin_payouts_held_for_review()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(held.h || jsonb_build_object(
      'payee_account', (SELECT pr.stripe_account_id FROM public.profiles pr WHERE pr.user_id = (held.h ->> 'payee_id')::uuid),
      'sibling_refs', (SELECT COALESCE(jsonb_agg(to_jsonb(sb) ORDER BY sb.ref), '[]'::jsonb) FROM (
          SELECT 'declutter' AS kind, x.id, x.stripe_transfer_id AS ref, x.amount_cents FROM public.declutter_payouts x
           WHERE x.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'helpr_task', x.id, x.stripe_transfer_id, x.amount_cents FROM public.helpr_task_payouts x
           WHERE x.helpr_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'shop', x.id, x.stripe_transfer_id, x.amount_cents FROM public.shop_payouts x JOIN public.shop_orders so ON so.id = x.order_id
           WHERE so.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          LIMIT 20) sb))
    ORDER BY held.h ->> 'held_at'), '[]'::jsonb) FROM (
    SELECT to_jsonb(x) AS h FROM (
      SELECT 'declutter' AS kind, p.id, p.seller_id AS payee_id, p.amount_cents, p.review_reason AS reason, p.review_held_at AS held_at,
             'declutter_order_' || p.order_id::text AS stripe_group
        FROM public.declutter_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- The REAL transfer group a Helpr's delivery payout is sent in: its Declutter order's.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.review_held_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text END
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.review_held_at, 'shop_order_' || p.order_id::text
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id
        FROM public.declutter_refunds r LEFT JOIN public.declutter_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.review_held_at, d.stripe_payment_intent_id
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
    ) x) held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payouts_held_for_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payouts_held_for_review() TO authenticated, service_role;

-- "Release to automatic": back to the queue; its wait starts over. ALWAYS needs the admin's
-- confirmation that Stripe shows no transfer / refund made for this row outside the app.
DROP FUNCTION IF EXISTS public.admin_payout_release(text, uuid, text);
CREATE OR REPLACE FUNCTION public.admin_payout_release(p_kind text, p_id uuid, p_note text, p_confirm_no_transfer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF p_confirm_no_transfer IS NOT TRUE THEN
    RAISE EXCEPTION 'confirm_no_transfer_required' USING ERRCODE = '22023',
      HINT = 'Confirm you checked Stripe and no transfer or refund was made for this row outside the app.';
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_release', p_kind, p_id::text, jsonb_build_object('note', v_note, 'confirmed_no_transfer', true));
  RETURN jsonb_build_object('result', 'released', 'kind', p_kind, 'id', p_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;

-- "Mark settled by hand": terminal at once (the guardrails are in the section header).
DROP FUNCTION IF EXISTS public.admin_payout_settle_by_hand(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_payout_settle_by_hand(p_kind text, p_id uuid, p_ref text, p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_stripe text;
  v_other text;
  v_status text;
  v_pi text;
  v_adopted boolean := false;
  v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop');
  v_succeeded boolean;
  v_refund_cents integer;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount it was settled for.';
  END IF;
  IF v_ref ~* '^other:' THEN
    v_other := left(btrim(regexp_replace(v_ref, '^other:', '', 'i')), 300);
    IF char_length(v_other) < 3 THEN
      RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Say how it was paid outside Stripe, after "other:".';
    END IF;
  ELSIF (v_payout AND v_ref ~ '^(tr|po)_[A-Za-z0-9]+$') OR (NOT v_payout AND v_ref ~ '^(re|pyr)_[A-Za-z0-9]+$') THEN
    v_stripe := v_ref;
  ELSE
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023',
      HINT = 'A Stripe transfer / payout id (tr_..., po_...) for a payout, a refund id (re_...) for a refund, or "other: how it was paid".';
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- A transfer on a payout / a refund (re_ or pyr_) on a refund: 'succeeded' with that id (the
  -- ledgers and the webhooks know it). A Stripe payout id or money paid outside Stripe:
  -- 'settled_by_hand'.
  v_succeeded := v_stripe IS NOT NULL AND (NOT v_payout OR v_stripe ~ '^tr_');
  -- A refund reaches 'succeeded' only for the WHOLE amount owed: a short Stripe refund would
  -- close the row (and count as refunded) while the buyer is still owed the rest.
  IF NOT v_payout AND v_succeeded AND p_amount_cents < COALESCE(v_refund_cents, 0) THEN
    RAISE EXCEPTION 'settle_amount_short' USING ERRCODE = '22023',
      HINT = 'Refund the rest in Stripe first, then record the full amount.';
  END IF;
  IF v_stripe IS NOT NULL THEN
    -- A Dashboard refund the hand-refund ledger recorded with no row, on THIS row's payment, is
    -- the refund that settled it: adopted (linked), not refused.
    IF p_kind = 'declutter_refund' THEN
      SELECT r.stripe_payment_intent_id INTO v_pi FROM public.declutter_refunds r WHERE r.id = p_id;
      UPDATE public.declutter_hand_refunds SET refund_row_id = p_id, hand_outcome = 'settled'
       WHERE stripe_refund_id = v_stripe AND stripe_payment_intent_id = v_pi AND refund_row_id IS NULL AND failed_at IS NULL;
      v_adopted := FOUND;
    END IF;
    IF NOT v_adopted AND public.money_ref_in_use(v_stripe) THEN
      RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
        HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
    END IF;
  END IF;
  INSERT INTO public.payout_settlements (stripe_ref, off_stripe_note, row_kind, row_id, amount_cents)
  VALUES (v_stripe, v_other, p_kind, p_id, p_amount_cents);
  IF p_kind = 'declutter_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
                                               livemode, hand_outcome)
    SELECT v_stripe, r.stripe_payment_intent_id, r.order_id, r.id, p_amount_cents, COALESCE(r.payment_livemode, true), 'settled'
      FROM public.declutter_refunds r WHERE r.id = p_id;
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_settle_by_hand', p_kind, p_id::text,
          jsonb_build_object('note', v_note, 'ref', v_ref, 'amount_cents', p_amount_cents, 'adopted_hand_refund', v_adopted));
  RETURN jsonb_build_object('result', 'settled', 'kind', p_kind, 'id', p_id, 'adopted_hand_refund', v_adopted,
    'status', CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) TO authenticated, service_role;

ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS held_notified_at timestamptz;
ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS held_notified_at timestamptz;
ALTER TABLE public.shop_payouts ADD COLUMN IF NOT EXISTS held_notified_at timestamptz;
ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS held_notified_at timestamptz;
ALTER TABLE public.declutter_delivery_refunds ADD COLUMN IF NOT EXISTS held_notified_at timestamptz;

-- Held rows never go quiet: one ops-ledger row per held payout / refund per UTC day (tags.source
-- 'payout-held-for-review'; trg_error_logs_zz_ledger turns it into a manual ledger item, re-raised
-- daily while it is still held and no longer once it is settled or released), and ONCE the person
-- owed the money is told plainly that it needs a quick review by our team. declutter-money calls
-- it every run. Returns how many rows are held.
CREATE OR REPLACE FUNCTION public.payout_held_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT x.* FROM (
      SELECT 'declutter'::text AS kind, p.id, p.seller_id AS payee, p.amount_cents, p.review_reason, p.held_notified_at,
             COALESCE(o.is_seed, false) AS is_seed
        FROM public.declutter_payouts p LEFT JOIN public.declutter_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.held_notified_at, false
        FROM public.helpr_task_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.held_notified_at, COALESCE(o.is_seed, false)
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
    ) x LIMIT 500
  LOOP
    v_n := v_n + 1;
    -- Nested (not AND): plpgsql plans the inner statements only when the table exists.
    IF to_regclass('public.error_logs') IS NOT NULL THEN
     IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE jsonb_typeof(e.tags) = 'object'
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND e.tags ->> 'source' = 'payout-held-for-review'
         AND e.tags ->> 'row_id' = r.id::text
         AND e.created_at > date_trunc('day', now())
     ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Payout or refund held for review: decide it on the admin money page — %s %s ($%s). %s',
                     r.kind, r.id, to_char(r.amount_cents / 100.0, 'FM999990.00'), coalesce(left(r.review_reason, 200), '')),
              jsonb_strip_nulls(jsonb_build_object('source', 'payout-held-for-review', 'area', 'payouts',
                                                   'row_kind', r.kind, 'row_id', r.id::text,
                                                   'seed', CASE WHEN r.is_seed THEN 'true' END)),
              jsonb_build_object('row_kind', r.kind, 'row_id', r.id, 'amount_cents', r.amount_cents));
     END IF;
    END IF;
    IF r.held_notified_at IS NULL AND r.payee IS NOT NULL THEN
      PERFORM public.declutter_notify(r.payee, 'payment',
        CASE WHEN r.kind LIKE '%refund' THEN 'Your refund needs a quick review' ELSE 'Your payout needs a quick review' END,
        format('Your $%s %s needs a quick review by our team before it can be sent. You do not need to do anything; we will tell you when it is on its way.',
               to_char(r.amount_cents / 100.0, 'FM999990.00'), CASE WHEN r.kind LIKE '%refund' THEN 'refund' ELSE 'payout' END),
        '/profile?tab=earnings');
    END IF;
    IF r.held_notified_at IS NULL THEN
      IF r.kind = 'declutter' THEN UPDATE public.declutter_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'helpr_task' THEN UPDATE public.helpr_task_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'shop' THEN UPDATE public.shop_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'declutter_refund' THEN UPDATE public.declutter_refunds SET held_notified_at = now() WHERE id = r.id;
      ELSE UPDATE public.declutter_delivery_refunds SET held_notified_at = now() WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_held_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_held_check() TO service_role;

-- What Stripe did with a refund row: restated from 20261017055500 (declutter_refund_executed) and
-- 20261017055505 (declutter_delivery_refund_executed) with ONE change each: only a row still in the
-- automatic path ('pending' / 'failed') is written, never one an admin holds for review or
-- settled by hand (a webhook redelivery cannot overwrite the admin's decision).
CREATE OR REPLACE FUNCTION public.declutter_refund_executed(p_refund_id uuid, p_stripe_refund_id text, p_succeeded boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  UPDATE public.declutter_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_ref = COALESCE(p_stripe_refund_id, stripe_refund_ref),
         executed_at = now(),
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_refund_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_status = 'failed' THEN
    PERFORM public.declutter_refund_gave_up_check(p_refund_id);
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_refund_executed(p_id uuid, p_stripe_refund_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_ref = COALESCE(p_stripe_refund_id, stripe_refund_ref),
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund_executed(uuid, text, boolean, text) TO service_role;

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

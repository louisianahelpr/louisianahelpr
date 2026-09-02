-- ============================================================
-- F-GIFT-3 (HIGH): a gift card could be destroyed with nothing given back.
--
-- Nothing anywhere un-does a `pif_credits` redemption. Once
-- `redeem_pif_credit` flipped a gift to 'redeemed' and funded the job
-- from the prepaid platform balance, that row was terminal — and every
-- path that later UNWINDS the job left it exactly where it was:
--
--   • void-cancelled-payments, Part A. A settled Pay-It-Forward job has
--     NO Stripe PaymentIntent (the gift covered the whole cost, so
--     create-payment never opened a checkout). The cron therefore takes
--     its `!paymentIntentId` branch — "no payment was ever made, just
--     update status" — writes payment_status='cancelled', and stops.
--     The credit stays 'redeemed' against a dead job. The recipient has
--     lost the gift outright: no refund exists because no charge exists.
--
--   • execute-dispute-split. It REFUSED a Pay-It-Forward job and told
--     the admin to "resolve it with the full release or full refund
--     action" — advice that cannot work, because a full refund also
--     refunds a PaymentIntent that isn't there. Being told the money is
--     recoverable when it is not is worse than the refusal itself.
--
--   • A gift merely RESERVED against a job (gift < job cost, shortfall
--     collected by Stripe) is un-reserved by checkoutSessionExpired when
--     the SESSION lapses — but nothing un-reserves it when the JOB is
--     cancelled first. That gift is not destroyed, but it is frozen:
--     'reserved' is refused for every other job by redeem_pif_credit.
--
-- ── The fix, and why a replacement rather than an un-redeem ──────────
--
-- Two designs were on the table. Flipping the original row back to
-- 'sent' is simpler and naturally idempotent, but it cannot express
-- three facts this path actually has to express:
--
--   1. PARTIAL value. A dispute split awards the poster a SHARE. An
--      un-redeem is all-or-nothing, so it would hand back the whole
--      gift on a 50/50 split whose helper leg was already paid out of
--      the platform balance — money minted from nothing.
--   2. What happened. An un-redeem clears job_id and redeemed_at, so
--      the trail from gift → job → cancellation → gift disappears at
--      the exact moment support most needs it.
--   3. EXPIRY. A gift that lapsed while it sat redeemed would come back
--      already dead. A replacement gets a fresh 90-day clock, which is
--      the honest outcome when the cancellation was not the recipient's
--      doing.
--
-- A replacement is also NOT a new concept here: `redeem_pif_credit`
-- already mints a child row with `parent_credit_id` for the leftover
-- when a gift is larger than the job. This reuses that exact mechanism
-- and that exact column, so the schema gains one idea, not two.
--
-- The cost is a second row the user did not ask for. It is bounded: the
-- original is 'redeemed', and CreditCard.tsx only offers "Use This Gift"
-- on 'sent'/'available', so the recipient still sees exactly one
-- spendable card.
--
-- A gift that was only RESERVED is the exception and is handled the
-- other way — un-reserved in place — because nothing was consumed, so
-- there is no history to preserve and no partial to express.
--
-- ── Idempotency (these are refund/cancel paths; they WILL run twice) ─
--
-- Restoring a gift twice mints money. Three independent guards:
--   1. `restored_from_job_id` + a partial UNIQUE index: at most one
--      restoration per job, forever. A second INSERT raises 23505.
--   2. The pre-check that returns 'already_restored' before inserting.
--   3. `SELECT ... FOR UPDATE` on the job row first (the same lock order
--      redeem_pif_credit uses: job, then credit), so two concurrent
--      callers serialise instead of racing the pre-check.
-- The un-reserve leg is guarded by `AND status = 'reserved'`, so a
-- second run matches zero rows and reports 'no_credit'.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION and REVOKE are all idempotent, and
-- this runs after 20260705190000 (parent_credit_id, recipient_email,
-- payment_status) and 20260811160000 (occasion, design_id), whose
-- columns the mint below copies.
-- ============================================================

-- ── The restoration marker ──────────────────────────────────────────
-- Which cancelled/refunded job this credit was minted to give back.
-- NULL on every normal gift, including the leftover children
-- redeem_pif_credit mints, which is what keeps the unique index below
-- scoped to restorations only.
--
-- ON DELETE SET NULL matches pif_credits.job_id. If a job is ever hard
-- deleted the marker is cleared and the uniqueness guarantee lapses with
-- it — harmless, because there is then no job left to restore against.
ALTER TABLE public.pif_credits
  ADD COLUMN IF NOT EXISTS restored_from_job_id uuid
    REFERENCES public.jobs(id) ON DELETE SET NULL;

-- THE durable idempotency guard. One restoration per job, enforced by
-- Postgres rather than by the caller remembering to check. Partial, so
-- the millions of ordinary NULL rows cost nothing and are unconstrained.
-- It also serves as the FK index for the column above.
CREATE UNIQUE INDEX IF NOT EXISTS pif_credits_restored_from_job_id_key
  ON public.pif_credits (restored_from_job_id)
  WHERE restored_from_job_id IS NOT NULL;

COMMENT ON COLUMN public.pif_credits.restored_from_job_id IS
  'Set only on a replacement gift minted by restore_pif_credit_for_job() '
  'after the job it points at was cancelled, refunded, or split. Unique '
  'among non-null values: a job''s gift is given back at most once.';

-- ============================================================
-- restore_pif_credit_for_job — give a Pay-It-Forward gift back
--
--   p_job_id     the job being unwound.
--   p_share_bps  how much of the applied gift to give back, in basis
--                points (10000 = all of it). A dispute split passes the
--                poster's share; the cancel path takes the default.
--   p_dry_run    compute and report, write nothing. Lets a caller learn
--                the applied amount for a cap check WITHOUT duplicating
--                this arithmetic on the TypeScript side — the drift
--                between two copies of a money formula is the bug class
--                execute-dispute-split's own comments warn about.
--
-- SECURITY DEFINER, service-role only, for the same reason
-- redeem_pif_credit is: a column-unrestricted client write on
-- pif_credits is theft. Nothing here trusts a caller-supplied amount —
-- p_share_bps is a fraction of a server-computed figure and is clamped
-- to [0, 10000].
--
-- Returns jsonb { outcome, ... }. Outcomes:
--   job_not_found      no such job.
--   no_credit          the job was not gift-funded (the common case, and
--                      why every cancel path can call this blindly).
--   unreserved         a merely-reserved gift was handed back in place.
--   already_restored   a prior run already gave it back. Carries the
--                      credit id and amount so a retry can still report.
--   nothing_to_restore the share rounds to zero.
--   restored           a replacement gift was minted; carries its id.
--   would_restore /    dry-run answers.
--   would_unreserve
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_pif_credit_for_job(
  p_job_id     uuid,
  p_share_bps  integer DEFAULT 10000,
  p_dry_run    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id          uuid;
  v_credit          record;
  v_existing        record;
  v_share_bps       integer;
  v_credit_cents    integer;
  v_leftover_cents  integer;
  v_applied_cents   integer;
  v_restore_cents   integer;
  v_new_id          uuid;
  v_unreserved      integer;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'p_job_id is required' USING errcode = '22023';
  END IF;

  -- Clamp rather than reject: a caller passing 1.0001 as bps is asking
  -- for "all of it", and refusing would strand the gift over a rounding
  -- artefact on the TypeScript side.
  v_share_bps := least(greatest(coalesce(p_share_bps, 10000), 0), 10000);

  -- Lock the job FIRST. Same order as redeem_pif_credit (job, then
  -- credit), so the two can never deadlock against each other, and two
  -- concurrent restorations of the same job serialise here instead of
  -- both passing the already-restored pre-check below.
  SELECT id INTO v_job_id FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'job_not_found');
  END IF;

  -- The gift that funded (or is held against) this job. 'redeemed' is
  -- preferred over 'reserved' if both somehow exist, because a consumed
  -- gift is the one that actually paid for something. Locked too, so a
  -- concurrent redeem_pif_credit cannot move it under us.
  SELECT id, donor_id, recipient_id, recipient_email, amount, status,
         category, message, occasion, design_id, expires_at
    INTO v_credit
    FROM public.pif_credits
   WHERE job_id = p_job_id
     AND status IN ('redeemed', 'reserved')
   ORDER BY (status = 'redeemed') DESC, created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    -- No original. Either this job was never gift-funded, or a prior run
    -- un-reserved the gift (which clears job_id). Distinguish the two by
    -- asking whether a replacement already exists, so a retry still sees
    -- 'already_restored' rather than a bare 'no_credit'.
    SELECT id, amount INTO v_existing
      FROM public.pif_credits
     WHERE restored_from_job_id = p_job_id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome',       'already_restored',
        'credit_id',     v_existing.id,
        'restore_cents', round(v_existing.amount * 100)::int
      );
    END IF;
    RETURN jsonb_build_object('outcome', 'no_credit');
  END IF;

  -- ── Reserved: never consumed, so hand the original straight back ───
  -- No mint, no partial. `checkoutSessionExpired` does exactly this when
  -- the shortfall session lapses; this covers the case where the JOB is
  -- unwound first and that webhook therefore never fires.
  IF v_credit.status = 'reserved' THEN
    IF v_share_bps < 10000 THEN
      -- A reservation cannot be split — nothing was consumed to split.
      -- Say so rather than silently returning the whole gift on a
      -- partial award.
      RETURN jsonb_build_object(
        'outcome',   'partial_unreserve_unsupported',
        'credit_id', v_credit.id
      );
    END IF;
    IF p_dry_run THEN
      RETURN jsonb_build_object(
        'outcome',       'would_unreserve',
        'credit_id',     v_credit.id,
        'applied_cents', 0,
        'restore_cents', 0
      );
    END IF;
    UPDATE public.pif_credits
       SET status = 'sent', job_id = NULL
     WHERE id = v_credit.id
       AND status = 'reserved';
    GET DIAGNOSTICS v_unreserved = ROW_COUNT;
    IF v_unreserved = 0 THEN
      -- Zero rows is NOT success. The row moved under the lock, which
      -- should be impossible — report it rather than telling the caller
      -- a gift was returned when none was.
      RETURN jsonb_build_object('outcome', 'no_credit', 'credit_id', v_credit.id);
    END IF;
    RETURN jsonb_build_object(
      'outcome',      'unreserved',
      'credit_id',    v_credit.id,
      'recipient_id', v_credit.recipient_id,
      -- The whole face value came back, untouched.
      'restore_cents', round(v_credit.amount * 100)::int
    );
  END IF;

  -- ── Redeemed: mint a replacement for what was actually APPLIED ─────
  -- Applied is NOT the gift's face value. When a gift is bigger than the
  -- job, redeem_pif_credit consumes only the cost and mints the
  -- remainder as a separate child gift the recipient already holds.
  -- Restoring the face value would hand back that remainder a second
  -- time — a $75 gift on a $50 job would become $25 + $75 = $100.
  --
  -- So: applied = face value − the leftover children already minted.
  -- Derived from the credit's own children rather than from
  -- jobs.budget + urgent_fee, because those columns can be edited while
  -- a job is unpaid and this must reflect what was really consumed.
  -- Restorations are excluded from the sum by their marker column.
  v_credit_cents := round(v_credit.amount * 100)::int;
  SELECT coalesce(sum(round(amount * 100)::int), 0)
    INTO v_leftover_cents
    FROM public.pif_credits
   WHERE parent_credit_id = v_credit.id
     AND restored_from_job_id IS NULL;
  v_applied_cents := greatest(v_credit_cents - v_leftover_cents, 0);

  -- Already given back? At most one row, by the unique index. Reported
  -- WITH the applied figure, because a caller resuming a half-finished
  -- dispute split needs it for its "never move more than the escrow"
  -- cap even on the run that has nothing left to write.
  SELECT id, amount INTO v_existing
    FROM public.pif_credits
   WHERE restored_from_job_id = p_job_id
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome',       'already_restored',
      'credit_id',     v_existing.id,
      'applied_cents', v_applied_cents,
      'restore_cents', round(v_existing.amount * 100)::int
    );
  END IF;

  v_restore_cents := (v_applied_cents::bigint * v_share_bps / 10000)::int;

  IF v_restore_cents <= 0 THEN
    RETURN jsonb_build_object(
      'outcome',       CASE WHEN p_dry_run THEN 'would_restore' ELSE 'nothing_to_restore' END,
      'credit_id',     v_credit.id,
      'applied_cents', v_applied_cents,
      'restore_cents', 0
    );
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'outcome',       'would_restore',
      'credit_id',     v_credit.id,
      'applied_cents', v_applied_cents,
      'restore_cents', v_restore_cents
    );
  END IF;

  -- The original row is left exactly as it is — 'redeemed', still
  -- pointing at the job it paid for. That is the audit trail: gift →
  -- job → (job cancelled) → replacement gift, readable in one query.
  BEGIN
    INSERT INTO public.pif_credits (
      donor_id, recipient_id, recipient_email, amount,
      status, payment_status, category, message, occasion, design_id,
      parent_credit_id, restored_from_job_id, expires_at
    ) VALUES (
      v_credit.donor_id, v_credit.recipient_id, v_credit.recipient_email,
      v_restore_cents::numeric / 100,
      'sent', 'paid',
      v_credit.category, v_credit.message, v_credit.occasion, v_credit.design_id,
      v_credit.id, p_job_id,
      -- Never shorter than a fresh 90 days: the recipient lost the
      -- original window to a cancellation that was not their doing. A
      -- longer original expiry is preserved.
      greatest(coalesce(v_credit.expires_at, now() + interval '90 days'),
               now() + interval '90 days')
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    -- The partial unique index caught a concurrent restoration that the
    -- row lock somehow did not. Report the winner, never a second gift.
    SELECT id, amount INTO v_existing
      FROM public.pif_credits
     WHERE restored_from_job_id = p_job_id
     LIMIT 1;
    RETURN jsonb_build_object(
      'outcome',       'already_restored',
      'credit_id',     v_existing.id,
      'restore_cents', round(v_existing.amount * 100)::int
    );
  END;

  RETURN jsonb_build_object(
    'outcome',            'restored',
    'credit_id',          v_new_id,
    'parent_credit_id',   v_credit.id,
    'recipient_id',       v_credit.recipient_id,
    'applied_cents',      v_applied_cents,
    'restore_cents',      v_restore_cents
  );
END;
$$;

-- Service-role only — never callable by a client token, exactly like
-- redeem_pif_credit. A client that could call this could mint gifts.
REVOKE ALL ON FUNCTION public.restore_pif_credit_for_job(uuid, integer, boolean)
  FROM public, anon, authenticated;

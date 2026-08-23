-- Close four money holes verified against the LIVE database (2026-08-22).
-- Each was confirmed by reading pg_constraint / pg_indexes / pg_get_functiondef
-- on fncmgoasalhdgfwzhsqa, not inferred from migration files.
--
-- Replay-safe: every statement is guarded, and the two backfill checks confirmed
-- zero conflicting rows in prod before this was written.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. referral_credits could mint $5 on EVERY completed job, not once.
--
-- `check_referral_bonus` gated on:
--     NOT EXISTS (SELECT 1 FROM referral_credits rc
--                 WHERE rc.referred_user_id = NEW.helper_id ...)
--
-- Note what `referred_user_id` holds: on the FIRST-JOB row it stores the
-- REFERRER, and on the REFERRER row it stores the referred user. So that guard
-- only ever matches the *referrer_bonus* row — the dedupe was anchored on the
-- counterparty's row, not on the credited user's own.
--
-- `enforce_referral_cap` (BEFORE INSERT ... RETURN NULL) silently suppresses the
-- referrer_bonus row once the referrer holds 5 credits. With the anchor row
-- suppressed, the guard passes again on the next completed job — and the next.
-- A referred user completing 5 jobs collected $25 for a $5 first-job bonus.
-- Deterministic; no race required.
--
-- The `ON CONFLICT DO NOTHING` already on the referrer insert could never fire:
-- verified live, referral_credits carried ONLY a PK on `id`.
--
-- Key includes referred_user_id deliberately: a referrer legitimately earns one
-- referrer_bonus per DISTINCT referred user under the same code, so
-- (user_id, referral_code_id, reason) alone would block real second referrals.
-- Left NULLS DISTINCT (the default) so pre-existing rows with a NULL
-- referred_user_id do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS referral_credits_one_per_reason
  ON public.referral_credits (user_id, referral_code_id, referred_user_id, reason);

-- Re-anchor the dedupe on the CREDITED user's own row, so a suppressed
-- counterparty row can never re-open the gate.
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_referral RECORD;
BEGIN
  IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
    RETURN NEW;
  END IF;

  -- Helper (worker) referral bonus.
  IF NEW.helper_id IS NOT NULL THEN
    SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
    INTO v_referral
    FROM public.referrals r
    WHERE r.referred_id = NEW.helper_id
      AND NOT EXISTS (
        -- Anchored on the credited user's OWN first_job_bonus row. That row is
        -- always written when this fires, so it cannot be suppressed out from
        -- under the guard the way the referrer's row can.
        SELECT 1 FROM public.referral_credits rc
        WHERE rc.user_id = NEW.helper_id
          AND rc.reason = 'first_job_bonus'
          AND rc.referral_code_id = r.referral_code_id
      );

    IF FOUND THEN
      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
      VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES
        (NEW.helper_id, 'Referral bonus earned!', 'You completed your first job as a helper and earned a $5 referral credit!', 'payment', '/profile'),
        (v_referral.referrer_id, 'Referral bonus!', 'Your referral completed their first job as a helper. You earned a $5 credit!', 'payment', '/profile');
    END IF;
  END IF;

  -- Customer (poster) referral bonus — same shape, same re-anchoring.
  SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
  INTO v_referral
  FROM public.referrals r
  WHERE r.referred_id = NEW.customer_id
    AND NOT EXISTS (
      SELECT 1 FROM public.referral_credits rc
      WHERE rc.user_id = NEW.customer_id
        AND rc.reason = 'first_job_bonus'
        AND rc.referral_code_id = r.referral_code_id
    );

  IF FOUND THEN
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (NEW.customer_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.customer_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES
      (NEW.customer_id, 'Referral bonus earned!', 'Your first posted job was completed — you earned a $5 referral credit!', 'payment', '/profile'),
      (v_referral.referrer_id, 'Referral bonus!', 'Your referral''s first posted job was completed. You earned a $5 credit!', 'payment', '/profile');
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. instant_payouts had no guard against a concurrent second payout.
--
-- instant-payout/index.ts builds its Stripe idempotency key from the id of a row
-- it has just INSERTED, so two concurrent requests produce two rows, two keys and
-- two Stripe calls — the key cannot bind them. Verified live: only a PK on `id`
-- plus two NON-unique indexes. The 3% fee transfer fires first and is
-- best-effort, so a double-tap could charge the fee twice for one payout.
--
-- One pending payout per helper, enforced by the database rather than by client
-- timing. (The edge function's key is being fixed separately; this is the
-- backstop that holds even if the key is wrong again.)
CREATE UNIQUE INDEX IF NOT EXISTS instant_payouts_one_pending_per_helper
  ON public.instant_payouts (helper_id)
  WHERE status = 'pending';

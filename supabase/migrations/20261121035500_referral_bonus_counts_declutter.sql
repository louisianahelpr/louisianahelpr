-- Referral bonus also counts Declutter (owner 2026-11-19: the $5 + $5 is earned
-- once BOTH people have completed a job, posted or worked, OR a Declutter
-- purchase or sale).
--
-- Before (20261027201034): referral_member_has_completed_job looked only at
-- public.jobs, and the settle step ran only from the jobs completion trigger.
-- A member who only buys or sells on Declutter never qualified and never
-- unlocked the bonus for the friend who invited them.
-- Now: a handed-over, paid Declutter order (as buyer or seller) qualifies too,
-- and both parties are settled when a Declutter order is handed over.
-- A free item ($0 items) is not a purchase or a sale and does not count, and
-- neither do seeded demo orders. Same credit rows, reasons, amounts, link and
-- one-per-reason unique index as before, so the cap and eligibility triggers on
-- referral_credits still apply unchanged.

CREATE OR REPLACE FUNCTION public.referral_member_has_completed_job(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status = 'completed' AND (j.helper_id = p_user OR j.customer_id = p_user))
    OR EXISTS (
      SELECT 1 FROM public.declutter_orders o
       WHERE o.status = 'handed_over' AND o.items_cents > 0 AND NOT o.is_seed
         AND o.buyer_id IS DISTINCT FROM o.seller_id
         AND (o.buyer_id = p_user OR o.seller_id = p_user)));
$fn$;
REVOKE ALL ON FUNCTION public.referral_member_has_completed_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_member_has_completed_job(uuid) TO service_role;

-- Same body as 20261027201034; only the two notices' words change, since the
-- qualifying step may now be a Declutter sale or purchase. p_job_id is NULL
-- when a Declutter order is what settled it.
CREATE OR REPLACE FUNCTION public.referral_settle_for(p_user uuid, p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ref RECORD;
  v_new int;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  FOR v_ref IN
    SELECT r.referrer_id, r.referred_id, r.referral_code_id
      FROM public.referrals r
     WHERE (r.referred_id = p_user OR r.referrer_id = p_user)
       AND r.referrer_id IS NOT NULL AND r.referred_id IS NOT NULL
  LOOP
    CONTINUE WHEN NOT (public.referral_member_has_completed_job(v_ref.referrer_id)
                       AND public.referral_member_has_completed_job(v_ref.referred_id));
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_ref.referred_id, 5, 'first_job_bonus', v_ref.referral_code_id, v_ref.referrer_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_ref.referred_id, 'Referral bonus earned!',
              'You and the friend who invited you have both finished a job or a Declutter sale or purchase, so you each earned a $5 credit!', 'payment', '/profile?tab=referral', p_job_id);
    END IF;
    INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
    VALUES (v_ref.referrer_id, 5, 'referrer_bonus', v_ref.referral_code_id, v_ref.referred_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_ref.referrer_id, 'Referral bonus earned!',
              'You and the friend you invited have both finished a job or a Declutter sale or purchase, so you each earned a $5 credit!', 'payment', '/profile?tab=referral', p_job_id);
    END IF;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.referral_settle_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_settle_for(uuid, uuid) TO service_role;

-- A Declutter order handed over: settle the buyer and the seller. The bonus is
-- an extra; a problem in it must never undo the handover, so it is caught and
-- logged as a warning instead.
CREATE OR REPLACE FUNCTION public.check_referral_bonus_declutter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT (NEW.status = 'handed_over' AND OLD.status IS DISTINCT FROM 'handed_over'
          AND NEW.items_cents > 0 AND NOT NEW.is_seed) THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.referral_settle_for(NEW.buyer_id, NULL);
    IF NEW.seller_id IS DISTINCT FROM NEW.buyer_id THEN
      PERFORM public.referral_settle_for(NEW.seller_id, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral settle after Declutter order % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.check_referral_bonus_declutter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_orders_referral_bonus ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_referral_bonus AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.check_referral_bonus_declutter();

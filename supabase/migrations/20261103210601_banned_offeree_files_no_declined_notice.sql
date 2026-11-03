-- A BANNED ACCOUNT'S CLOSED OFFER FILES NO "DECLINED YOUR OFFER" NOTICE (Q2132,
-- finding: lh-money-escrow@25dc6611c#2).
--
-- What was broken: when an account is banned, settle_one_off_jobs_for_banned_account
-- closes each pending direct offer TO that account by setting
-- direct_offer_status = 'declined', and tells the poster "The person you
-- offered ... can no longer use Louisiana Helpr, so the offer is closed".
-- record_backout_notice (AFTER UPDATE OF ... direct_offer_status) read that
-- pending -> declined move on a funded job as 'offer_declined' and also gave
-- the poster the banner and email "<Helpr> declined your offer", which the
-- Helpr never did and which contradicts the notification beside it.
--
-- The fix: a 'declined' move whose offeree is banned ('banned' or
-- 'permanently_banned', the two statuses that run the settlement) files no
-- backout notice and no email. Both callers of the settlement run AFTER that
-- status is written (trg_settle_one_off_jobs_on_permanent_ban is AFTER UPDATE
-- OF ban_status WHEN new.ban_status IN those two; admin_confirm_ban_settlement
-- reads the status first; prod read 2026-11-03). A banned account cannot
-- decline an offer itself, so no real decline is lost. Expiry ('expired'),
-- every other branch and the settlement are unchanged.
--
-- The body is the live definition (prod 2026-11-03, one overload: md5(prosrc)
-- cebd8eb5fe81315721e7877bfc464dc6, md5(pg_get_functiondef)
-- 84ff431a6979f58fbf4c1dc42d6460fa), equal to the newest file definition
-- (20261029162907_poster_own_reopen_files_no_backout_notice.sql), verbatim
-- plus the one IF block in the direct-offer branch.
--
-- Replay-safe: CREATE OR REPLACE of a trigger function that exists since
-- 20261008205118; the trigger itself is untouched. Grants restated as
-- 20261029162907 left them (trigger function: nobody calls it directly).

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
      -- A2-B15: the poster reopened it themself (a no-show report, a block):
      -- nobody backed out on them, so they get no notice about their own act.
      WHEN auth.uid() IS NOT NULL AND auth.uid() = OLD.customer_id THEN NULL
      WHEN OLD.helper_confirmed_at IS NOT NULL THEN 'helper_cancelled'
      WHEN auth.uid() IS NOT DISTINCT FROM OLD.helper_id THEN 'offer_declined'
      ELSE 'offer_expired' END;
    IF v_kind IS NULL THEN
      RETURN NULL;
    END IF;
  ELSIF OLD.direct_offer_status = 'pending' AND NEW.direct_offer_status IN ('declined', 'expired')
     AND OLD.offered_to_helper_id IS NOT NULL
     -- Q2131: "<Helpr> declined your offer ... open to everyone again" only
     -- about a funded job (the notification row says "was declined." alone).
     AND public.job_payment_is_listed(NEW.payment_status) THEN
    -- Q2132: a ban's settlement closes a pending offer TO the banned account
    -- as 'declined'. The Helpr declined nothing; the poster's own notification
    -- ("can no longer use Louisiana Helpr, so the offer is closed") says what
    -- happened, so no "declined your offer" banner or email.
    IF NEW.direct_offer_status = 'declined' AND EXISTS (
         SELECT 1 FROM public.profiles bp
          WHERE bp.user_id = OLD.offered_to_helper_id
            AND bp.ban_status IN ('banned', 'permanently_banned')) THEN
      RETURN NULL;
    END IF;
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

REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;


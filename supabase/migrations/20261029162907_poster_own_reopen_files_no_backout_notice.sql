-- THE POSTER'S OWN REOPEN FILES NO "HELPR CANCELLED" NOTICE (audit 2026-10-29 A2-B15).
--
-- What was broken: after the poster reported a no-show, the poster's own card
-- carried the red banner "Eli cancelled. They won't be coming." (AA9 chunk 1a,
-- aa9-ns-pafter-card-375.png). Eli did not cancel; the poster reported him.
-- record_backout_notice (live body read 2026-10-29 with pg_proc.prosrc, equal
-- to the newest file definition, 20261027185146_card_hold_at_post.sql) files
-- every accepted/in_progress -> open reopen of a confirmed job as
-- 'helper_cancelled' for the poster, whoever made it. report_helper_no_show's
-- reopen runs as the poster (it refuses anyone else: auth.uid() must be the
-- job's customer_id), and so does block_user_and_settle when the poster blocks
-- the Helpr: in both the Helpr backed out of nothing.
--
-- The fix: when the reopen is the poster's own act (auth.uid() is the job's
-- poster), the poster is not told about it: no backout notice, no email. The
-- one exception stays first: the 2-hour unconfirmed repost (app.repost_unconfirmed)
-- is not the poster's choice, so it still files 'helper_unconfirmed' whoever's
-- session ran it. The Helpr-side paths (Helpr cancels, Helpr declines, offer
-- expires on the server, poster cancels -> Helpr told) are unchanged. Nothing
-- else in the body changes; it is the newest definition verbatim plus the one
-- WHEN line and the RETURN that reads it.
--
-- Replay-safe: CREATE OR REPLACE of a trigger function that exists since
-- 20261008205118; the trigger itself is untouched. Grants restated as
-- 20261021131322 left them (trigger function: nobody calls it directly).

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

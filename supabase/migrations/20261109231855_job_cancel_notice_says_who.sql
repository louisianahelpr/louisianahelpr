-- F176 (owner UI audit 11-09, Part 3; lead 11-09: "give the cancel notice its own path"): the trigger's
-- "Job cancelled" notice (push, and email notice-09 through jobs_notice_email_type) always said
-- '"<job>" was cancelled by the person who posted it.', whoever cancelled. It only fires on a cancel that is NOT
-- sanctioned (app.sanctioned_cancel off: poster_cancel_job, the bans, blocks and failed bank payments tell the Helpr
-- themselves), and on prod those were mostly not the poster: of the 14 notices with this text (read-only count,
-- 11-09), 11 were on jobs an ADMIN cancelled (admin removal, admin_refund_general), 1 on a job a dispute decision
-- cancelled (rpc_decide_dispute / create-payment admin_refund_dispute, which can bill a Helpr ruled at fault the
-- card fee), and 2 on jobs the poster cancelled.
-- Each case now says only what is true for it:
--   * the poster cancelled (cancelled_by = the poster, not from a dispute): who did it, and that the Helpr owes
--     nothing and it doesn't count against them (a poster's cancel never bills or strikes the Helpr);
--   * a dispute decision cancelled it: that our team decided the dispute (never "nothing is owed": a Helpr at
--     fault is billed the card fee, and that decision's own notice says so);
--   * an admin cancelled it: that our team cancelled it, nothing about money it cannot see;
--   * anyone or anything else (cancelled_by empty or another member): only that it was cancelled.
-- Who gets it, when, the title, type and link are unchanged (sms_kind_for and jobs_notice_email_type match the
-- title 'Job cancelled'). The completion half is byte-for-byte the LIVE definition (md5(prosrc) on prod 11-09 =
-- d72238842672d48b5eab203affb1627a = 20261023143240's body). PGlite: src/test/pglite/jobCancelNoticeSaysWho.pglite.mjs.

CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- F176: the cancel notice's words, by who cancelled (only read on a cancel).
  v_cancelled_words text;
BEGIN
  -- One Helpr: when the same write scheduled the payout (create-payment's approval, auto-release-payment's
  -- release of an approved job), that writer already told the Helpr the amount and the day; a second
  -- "Job completed!" here was a duplicate that said "Payment is being processed" (owner 2026-10-23).
  -- Any other road to completed (an admin's status change) says the job is complete and nothing about money
  -- it cannot see.
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL
     AND NEW.is_group_job IS NOT TRUE
     AND NOT (NEW.payment_status::text = 'payout_pending' AND NEW.payout_scheduled_at IS NOT NULL) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" is complete.', 'payment', '/jobs?job=' || NEW.id::text);
  END IF;

  -- F176: an unsanctioned cancel says who cancelled, and claims "nothing owed" only when the poster did.
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled'
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    v_cancelled_words := '"' || OLD.title || '" was cancelled'
      || CASE
           WHEN OLD.status = 'disputed' THEN ' after our team decided the dispute.'
           WHEN NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by = OLD.customer_id
             THEN ' by the person who posted it. You don''t owe anything, and it doesn''t count against you.'
           WHEN NEW.cancelled_by IS NOT NULL AND public.has_role(NEW.cancelled_by, 'admin') THEN ' by our team.'
           ELSE '.'
         END;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', v_cancelled_words, 'warning', '/jobs?job=' || OLD.id::text);
  END IF;

  -- A crew (Q407): every member, never one. A crew job completes from any
  -- live status (the roster roll-up), so the edge is "became completed".
  -- poster_cancel_job tells each member their own share itself, so a
  -- sanctioned cancel is skipped here exactly as for a single Helpr.
  IF NEW.is_group_job IS TRUE THEN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job completed!',
             '"' || NEW.title || '" is complete.'
               || CASE WHEN NEW.payment_status::text = 'payout_pending' AND NEW.payout_scheduled_at IS NOT NULL
                       THEN ' Your share will be sent to your account ' || public.payout_day_label(NEW.payout_scheduled_at) || '.'
                       ELSE '' END,
             'payment', '/jobs?job=' || NEW.id::text, NEW.id
        FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled'
       AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job cancelled',
             v_cancelled_words,
             'warning', '/jobs?job=' || OLD.id::text, OLD.id
        FROM public.group_job_helpers g
       WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_on_job_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_job_update() TO service_role;

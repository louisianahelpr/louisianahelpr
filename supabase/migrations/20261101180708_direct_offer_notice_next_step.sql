-- Audit 11-01 JA-58 + owner 11-01 ("end with the next step and its deadline ... and link to the page where that
-- step is done"): the direct-offer notice to a Helpr.
--   before: 'Dana offered you a job: "Move a couch" for $120', link /jobs?job=<id>
--           (the BUDGET, which is not the Helpr's take-home; no answer-by time; the list)
--   after:  'Dana offered you "Move a couch". Next: accept by Sat 9 AM, or the offer expires. The job page shows
--           what you'd take home.', link /jobs/<id>
-- notify_helper_on_direct_offer, newest definition 20261101065105_instant_book_booking.sql, verbatim except the
-- v_by declaration and the INSERT. The title is unchanged ('You got a direct job offer!': sms_kind_for
-- 20261030215251 maps it to the job_offer text). Trigger, owner and grants are unchanged (CREATE OR REPLACE keeps
-- them). REVOKE ... FROM PUBLIC, anon below: a trigger function never needs a caller grant.
-- REPLAY-SAFE: CREATE OR REPLACE only. Proof: src/test/pglite/directOfferNoticeNextStep.pglite.mjs.
-- Guard: src/test/jobNoticesNameAndNextStep.test.ts.

CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
  v_by text;
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
     -- CMP-4: an instant booking is not an offer to answer. rpc_instant_book
     -- tells the Helpr "You're booked" in its own words.
     AND NEW.instant_decline_until IS NULL
     -- A job booked from an agreed quote, offered to its quoter: paying hires
     -- them (quote_job_funded_hires_quoter), which sends the one notice.
     AND NOT public.quote_job_offered_to_quoter(NEW.id, NEW.offered_to_helper_id)
  THEN
    SELECT public.member_display_name(full_name, 'Someone') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    -- Audit 11-01 JA-58: no dollar figure (the budget is not what a Helpr takes home, owner 10-25; the job page
    -- shows the take-home), the answer-by time in Louisiana time, and the job page, not the list. Owner 11-01:
    -- the notice ends with the next step and its deadline. The title stays: sms_kind_for keys the offer text on it.
    IF NEW.direct_offer_expires_at IS NOT NULL AND NEW.direct_offer_expires_at > now() THEN
      v_by := ' by ' || replace(to_char(NEW.direct_offer_expires_at AT TIME ZONE 'America/Chicago', 'Dy FMHH12:MI AM'), ':00 ', ' ');
    END IF;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you "' || NEW.title || '". Next: accept' || COALESCE(v_by, ' soon')
        || ', or the offer expires. The job page shows what you''d take home.',
      'new_offers',
      '/jobs/' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helper_on_direct_offer() FROM PUBLIC, anon;

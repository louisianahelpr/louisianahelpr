-- TS-010: the contact-leak gate (contact_leak_reason) already guards chat,
-- jobs, bios and applications, but not reviews. A review is public on the
-- reviewee's profile, so "call me at 225-555-0199" or "venmo me" posted as
-- review feedback (or as the reviewee's public reply) reached every visitor.
-- Same rule, same check_violation the clients already show as copy.
--
-- Disputes are deliberately NOT gated: a dispute reason is a report to the
-- admins, and a victim must be able to write "he told me to venmo him".
--
-- REPLAY-SAFETY: CREATE OR REPLACE + DROP TRIGGER IF EXISTS, guarded on the
-- helper existing.

CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
    v_reason := public.contact_leak_reason(NEW.feedback);  -- TS-010 feedback scan
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in your review. Reviews are public, so keep contact details and payment out of them. To flag a problem, use Report.';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.response_text IS DISTINCT FROM OLD.response_text THEN
    v_reason := public.contact_leak_reason(NEW.response_text);  -- TS-010 reply scan
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in your reply. Replies are public, so keep contact details and payment out of them.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_contact_leak_in_review() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.contact_leak_reason(text)') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_review ON public.reviews;
    CREATE TRIGGER trg_reject_contact_leak_in_review
      BEFORE INSERT OR UPDATE OF feedback, response_text ON public.reviews
      FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_review();
  END IF;
END $$;

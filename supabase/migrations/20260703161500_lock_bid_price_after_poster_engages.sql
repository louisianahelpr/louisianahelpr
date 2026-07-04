-- Lock a helper's bid price once the poster has engaged the offer.
--
-- A helper may edit their own PENDING application (message, attachments, and —
-- new — the bid price on accept_bids jobs). The "Helpers can update their own
-- pending applications" RLS policy allows any column change while status =
-- 'pending', which is correct for the message/attachment edits: those stay
-- editable even after the poster has looked at the application.
--
-- The BID PRICE, however, must NOT be rewritable once the poster is acting on
-- it — otherwise a helper could change the number the poster is currently
-- viewing or has already countered, silently moving the deal underneath them.
-- The client mirrors this lock in the UI (hides the pencil) and in the update
-- query (.is poster_viewed_at null / .is counter_price null), but neither is
-- enforcement: a direct API call bypasses both. This trigger is the real gate.
--
-- Column-conditional (only proposed_price is gated), so message/attachment
-- edits are unaffected. proposed_price is never legitimately rewritten by any
-- other flow — respond_to_counter_offer() touches only negotiation_status and
-- jobs.budget, and the initial bid is an INSERT — so this only ever blocks the
-- helper's own late edit, never a real negotiation step.

CREATE OR REPLACE FUNCTION public.enforce_bid_price_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.proposed_price IS DISTINCT FROM OLD.proposed_price THEN
    IF OLD.poster_viewed_at IS NOT NULL OR OLD.counter_price IS NOT NULL THEN
      RAISE EXCEPTION 'Bid is locked: the poster has already opened or countered this offer'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bid_price_lock ON public.applications;
CREATE TRIGGER trg_enforce_bid_price_lock
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bid_price_lock();

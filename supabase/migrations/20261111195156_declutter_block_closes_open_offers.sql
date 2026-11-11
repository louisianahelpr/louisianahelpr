-- Whole-app audit 11-10 F359h (owner 11-11 ~2:10 PM): blocking someone closes the OPEN Declutter offers and trade
-- offers between the two members, in either direction. Paid orders are not touched (they finish normally), and an
-- accepted offer or trade is not touched either (it is a checkout or a handover, with its own rules).
--
-- Closed as 'voided' (the existing "this can no longer go ahead" status; no new status, no notice). Same shape as
-- quote_close_pending_across_block (20261021112534): an AFTER INSERT trigger on user_blocks that never makes the
-- block itself fail; a failure is written to error_logs instead.

CREATE OR REPLACE FUNCTION public.declutter_close_offers_across_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    -- voided_by_line cleared: declutter_reopen_voided_offers (20261101032626) reopens a voided offer by that pointer,
    -- so a stale line must never bring an offer between two blocked members back (authz review 11-11).
    UPDATE public.declutter_offers
       SET status = 'voided', closed_at = now(), updated_at = now(), voided_by_line = NULL
     WHERE status = 'open'
       AND ((buyer_id = NEW.blocker_id AND seller_id = NEW.blocked_id)
         OR (buyer_id = NEW.blocked_id AND seller_id = NEW.blocker_id));

    UPDATE public.declutter_swap_offers
       SET status = 'voided', closed_at = now(), updated_at = now()
     WHERE status = 'open'
       AND ((buyer_id = NEW.blocker_id AND seller_id = NEW.blocked_id)
         OR (buyer_id = NEW.blocked_id AND seller_id = NEW.blocker_id));
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error', 'Declutter offers not closed across a block',
              jsonb_build_object('source', 'declutter_close_offers_across_block'),
              jsonb_build_object('blocker_id', NEW.blocker_id, 'blocked_id', NEW.blocked_id,
                                 'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'declutter_close_offers_across_block: % blocked %, offers not closed and the error_logs row failed: %',
        NEW.blocker_id, NEW.blocked_id, SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_close_offers_across_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_declutter_close_offers_across_block ON public.user_blocks;
CREATE TRIGGER trg_declutter_close_offers_across_block
  AFTER INSERT ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.declutter_close_offers_across_block();

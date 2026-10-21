-- DECLUTTER: STRIPE IDENTITY ONCE, AT THE FIRST PURCHASE OR THE FIRST LISTING (owner 2026-10-22, Declutter
-- terms answer #9: "Stripe Identity is needed ONCE across Jobs/Declutter; Declutter asks for it at the first
-- purchase or first listing").
--
-- The ONE rule is unchanged: is_identity_verified(member) (profiles.idv_status = 'verified', Stripe Identity or an
-- admin-approved ID; 20261021081258). A member already verified through Jobs is never asked again, and a member
-- verified here is verified for Jobs. Same carve-outs as the Jobs gates: server writes (sweeps, webhooks,
-- service role), admins, and enrolled test accounts (identity_check_exempt).
--
-- Where, as BEFORE triggers so every path is covered whichever RPC writes the row (the jobs gates' pattern), and
-- judged only when the acting member IS the buyer or seller of the row:
--   * a LISTING: a declutter_items row going up from 'draft' or 'paused' into 'pending_review' or 'live'
--     (publish, relist; an INSERT straight in), when auth.uid() is its seller -> 'identity_required_to_list'. An
--     item put BACK on sale by the system of a sale (a second buyer no-show: sold -> live; a cancelled haul-away:
--     ended -> live) is not a new listing and is not judged (lh-authz-rls review 2026-10-21 #2). An admin approving
--     a pending item, the AI check (service role) and every other status change are untouched.
--   * a PURCHASE: a declutter_offers, declutter_cart_items or declutter_orders row INSERTed for auth.uid() as its
--     buyer (make an offer, buy now, start checkout), and the BUYER's own counter on an offer (a Wanted reply is
--     an offer the SELLER inserts for the poster, so the poster's first commitment is their counter or their
--     accept; review #1) -> 'identity_required_to_buy'. A seller accepting inserts the buyer's cart line as the
--     SELLER, so it is not judged there: the buyer was judged at their offer, counter or accept, and a buyer who
--     never acted cannot be accepted (an offer awaits the buyer after the seller's move).
-- Wanted posts, questions, watching and Helpr delivery (helpr accept already reads the ID rule) are not gated.
-- The client opens the one ID sheet on either code (src/lib/identityCheck.ts identityRefusal).
-- The $2 setup fee is the JOBS lane's (charged once per account, whichever comes first); not here.
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.declutter_identity_gate(p_member uuid, p_code text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- Server writes are not a member acting; a row for someone else is not this member's first buy or listing.
  IF public.is_server_context() OR auth.uid() IS NULL OR p_member IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;
  IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) THEN
    RETURN;
  END IF;
  IF public.is_identity_verified(auth.uid()) THEN
    RETURN;
  END IF;
  IF p_code = 'identity_required_to_list' THEN
    RAISE EXCEPTION 'identity_required_to_list' USING ERRCODE = '42501',
      HINT = 'Verify your ID with Stripe before your first Declutter listing goes live. It takes about 2 minutes, once.';
  END IF;
  RAISE EXCEPTION 'identity_required_to_buy' USING ERRCODE = '42501',
    HINT = 'Verify your ID with Stripe before your first Declutter purchase. It takes about 2 minutes, once.';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_identity_gate(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_identity_before_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN
    PERFORM public.declutter_identity_gate(NEW.seller_id, 'identity_required_to_list');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_identity_before_list() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_identity_before_list ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_identity_before_list
  BEFORE INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_list();

CREATE OR REPLACE FUNCTION public.declutter_identity_before_buy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.declutter_identity_gate(NEW.buyer_id, 'identity_required_to_buy');
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_identity_before_buy() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_offers_identity_before_buy ON public.declutter_offers;
CREATE TRIGGER trg_declutter_offers_identity_before_buy
  BEFORE INSERT ON public.declutter_offers
  FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
-- The buyer's counter (review #1): an offer's amount changed in the buyer's own session. Withdraw and decline
-- change no amount; the gate judges only when auth.uid() is the buyer, so the seller's counter is not judged.
DROP TRIGGER IF EXISTS trg_declutter_offers_identity_before_counter ON public.declutter_offers;
CREATE TRIGGER trg_declutter_offers_identity_before_counter
  BEFORE UPDATE OF amount_cents ON public.declutter_offers
  FOR EACH ROW WHEN (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents)
  EXECUTE FUNCTION public.declutter_identity_before_buy();
DROP TRIGGER IF EXISTS trg_declutter_cart_identity_before_buy ON public.declutter_cart_items;
CREATE TRIGGER trg_declutter_cart_identity_before_buy
  BEFORE INSERT ON public.declutter_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();
DROP TRIGGER IF EXISTS trg_declutter_orders_identity_before_buy ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_identity_before_buy
  BEFORE INSERT ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_identity_before_buy();

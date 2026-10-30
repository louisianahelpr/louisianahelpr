-- Declutter DC-4 (Selling audit 2026-10-30; owner 2026-10-29): buyers can ALWAYS choose Helpr delivery for an
-- item they buy. The sell form's "Helpr delivery" tick goes away, so what a seller ticked (declutter_items.handovers)
-- no longer decides whether Helpr delivery is offered.
--
-- WHY
--   Measured on prod 2026-10-30 (a rolled-back transaction on a test seller's live item): with handovers NULL (every
--   item listed before the ticks, so every live item today) declutter_handover_refused(line, 'delivery') = false;
--   with handovers {porch} it = true. So a seller who did not tick "Helpr delivery" silently took it away from
--   buyers, against the owner's decision. That is why the audit saw Helpr delivery offered on the older listings.
--
-- WHAT THIS DOES
--   declutter_handover_refused, restated from its EFFECTIVE prod definition (pg_get_functiondef 2026-10-30): Helpr
--   delivery is never refused for a checkout of paid lines. Every other way keeps the "every line allows it" rule.
--   A free line keeps today's rule (a free item is claimed through declutter_checkout_free, porch pickup only).
--   Callers unchanged: declutter_start_checkout and declutter_checkout_free. Its mirrors move in the same change:
--   handoverRefusedFor (supabase/functions/declutter-checkout/index.ts) and wayAllowed (src/lib/declutter/handovers.ts).
--
-- Internal helper: EXECUTE stays with service_role only (REVOKE FROM PUBLIC, anon, authenticated), as on prod.

CREATE OR REPLACE FUNCTION public.declutter_handover_refused(p_lines uuid[], p_handover text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lines AS (
    -- Each line's ways: its ticks; an older line (NULL) every way, but not porch when its porch_ok is off
    -- (re-review should-fix 2: an older porch-off item narrows porch out of the shared ways).
    SELECT CASE WHEN i.handovers IS NOT NULL THEN i.handovers
                WHEN NOT i.porch_ok THEN ARRAY['pickup_home', 'seller_delivery', 'meetup', 'delivery']
           END AS ways,
           i.handovers IS NOT NULL AS ticked,
           (c.price_cents > 0 AND i.price_cents > 0) AS paid
      FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
     WHERE c.id = ANY (p_lines)
  ), shared AS (
    -- The ways every line allows (a line with no limit narrows nothing).
    SELECT ARRAY(SELECT w FROM unnest(ARRAY['porch', 'pickup_home', 'seller_delivery', 'meetup', 'delivery']) AS w
                  WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.ways IS NOT NULL AND NOT (w = ANY (l.ways)))) AS ways,
           EXISTS (SELECT 1 FROM lines l WHERE l.ticked) AS any_ticked,
           (EXISTS (SELECT 1 FROM lines) AND NOT EXISTS (SELECT 1 FROM lines l WHERE NOT l.paid)) AS all_paid
  )
  -- Owner 2026-10-29 (DC-4): buyers can always choose Helpr delivery for what they buy, whatever the seller ticked.
  -- Owner 2026-10-28 (Q2462, #3730): no fallback to pickup at the seller's door, and lines that share no way do
  -- not check out "as before": any other way must be one every line allows. When none works, the buyer and seller
  -- talk it through (declutter_open_handover_talk) and the missed-checkout strike waits (20261028235249).
  SELECT s.any_ticked
     AND NOT (p_handover = 'delivery' AND s.all_paid)
     AND NOT (p_handover = ANY (s.ways))
    FROM shared s;
$function$;
REVOKE ALL ON FUNCTION public.declutter_handover_refused(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_refused(uuid[], text) TO service_role;

-- Declutter notices link in one format: ?tab=selling / ?tab=buying (Declutter audit DC-17, 2026-10-30).
--
-- BROKEN: the seller's and buyer's Declutter notices linked in five formats: ?view=selling, ?view=sales, ?view=mine,
-- ?view=bought, ?view=buying, besides the current ?tab=selling / ?tab=buying (prod pg_proc, 2026-10-30: about 35
-- definer functions). The app still opens each (src/lib/declutter/tabs.ts oldDeclutterView and DeclutterHomeView),
-- but every new notice should carry the one current address.
--
-- FIX: every Declutter notice is written by declutter_notify_strict (declutter_notify wraps it), so the link is
-- rewritten there, once, by a new IMMUTABLE helper declutter_notice_link, instead of restating ~35 money functions:
--   ?view=sales | ?view=selling | ?view=mine  ->  ?tab=selling   (the app's oldDeclutterView sends these to Selling)
--   ?view=bought | ?view=buying               ->  ?tab=buying    (and these to Buying)
-- The rest of the query string is kept (&talk=, &paid=1, ...). NOT rewritten, on purpose:
--   ?view=cart and ?view=offers: sent to BOTH sides; the app picks the side from what is waiting, and the writer
--     does not know the side. Each sender has to be restated with the recipient's side (ratchet in
--     src/test/declutterNoticeLinksOneFormat.test.ts, which fails on any NEW ?view= link);
--   ?view=deliver, ?view=wanted: sub-views, not a buying/selling tab.
-- Notices already sent are left as they are (the app still opens them).
--
-- RESTATED FROM: declutter_notify_strict from 20261028191646_declutter_notices_name_the_item.sql, which is what prod
-- runs (pg_get_functiondef md5 2cb36348b9fb2100f72cca0f0a6b760a, 2026-10-30, body identical). The one change is the
-- link, marked "DC-17". Grants restated to prod's proacl (service_role only). The helper is IMMUTABLE, touches no
-- table, and is executable by service_role only.
-- MONEY: none.
-- REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/declutterNoticeLinksOneFormat.pglite.mjs (3x).

CREATE OR REPLACE FUNCTION public.declutter_notice_link(p_link text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_link ~ '^/declutter\?view=(sales|selling|mine)(&|#|$)'
      THEN regexp_replace(p_link, '^/declutter\?view=(sales|selling|mine)', '/declutter?tab=selling')
    WHEN p_link ~ '^/declutter\?view=(bought|buying)(&|#|$)'
      THEN regexp_replace(p_link, '^/declutter\?view=(bought|buying)', '/declutter?tab=buying')
    ELSE p_link
  END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_notice_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_link(text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  -- DC-17: one link format for the seller's and buyer's notices (?tab=selling / ?tab=buying).
  v_link text := public.declutter_notice_link(p_link);
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Q137: a seed (test) counterpart never notifies a real member.
  IF p_other IS NOT NULL
     AND COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = p_other), false)
     AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = p_user), false) THEN
    RETURN;
  END IF;
  -- Prices read the way the app shows them (src/lib/declutter/distance.ts
  -- formatPrice): whole dollars drop ".00", so "$30.00" is "$30" and "$30.50"
  -- stays. Every Declutter notice passes here, so callers that still format
  -- with to_char(..., 'FM999990.00') read right without being restated.
  -- The item is named first (20261028191646), so two orders' notices differ.
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, public.declutter_notice_type(p_type, p_title, v_link), p_title,
          public.declutter_price_words(public.declutter_notice_names_item(p_user, p_other, v_link, p_message)), v_link);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) TO service_role;

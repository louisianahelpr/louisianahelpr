-- Q2489 (Declutter audit DC-17 part 3, 2026-10-30): a notice linking ?view=cart opened the tab the app guessed. The app
-- opens Selling for ?view=cart when the member has seller work waiting and no buyer work (src/lib/declutter/tabs.ts
-- oldDeclutterView), so a buyer's "Refund on its way" could open Selling.
--
-- MEASURED on prod, pg_proc.prosrc, 2026-10-30: 34 ?view=cart links in 24 functions, every one sent to the buyer. The
-- writer can therefore rewrite them, the way 20261030133115 rewrites the other old addresses, with no money function
-- restated. src/test/declutterCartLinksGoToTheBuyer.test.ts holds that list exactly, both ways, and fails if a
-- ?view=cart link is ever written to anyone else.
--
-- CHANGED: declutter_notice_link gains one case, ?view=cart -> ?tab=buying, keeping the rest of the link.
--          declutter_pickup_remind's email passes through the same helper (its bell row already did).
-- RESTATED FROM: declutter_notice_link in 20261030133115 (queued, the commit below this one);
--                declutter_pickup_remind in 20261028162048 (= prod md5(prosrc) d5b3c72fce3ad420ad21ad9485cc4d99).
-- Notices already sent keep their old link, and the app still opens it. Grants: service_role only, as before.
-- MONEY: none. REPLAY-SAFE: CREATE OR REPLACE only. Proof: src/test/pglite/declutterCartLinksOpenBuying.pglite.mjs (3x).

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
    WHEN p_link ~ '^/declutter\?view=cart(&|#|$)'
      THEN regexp_replace(p_link, '^/declutter\?view=cart', '/declutter?tab=buying')
    ELSE p_link
  END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_notice_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_link(text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_pickup_remind(p_user uuid, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Strict: the reminder is this step; a failure rolls the booking's claim back
  -- in declutter_pickup_reminder_sweep and the next run retries it.
  PERFORM public.declutter_notify_strict(p_user, 'declutter_pickups', p_title, p_message, p_link, p_other);
  IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.user_id = p_other AND o.is_seed)
     AND NOT EXISTS (SELECT 1 FROM public.profiles r WHERE r.user_id = p_user AND r.is_seed) THEN
    RETURN;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', 'declutter_pickups', 'link', public.declutter_notice_link(p_link))
    );
  EXCEPTION WHEN OTHERS THEN
    -- The bell row above already landed; an email that could not be queued is
    -- recorded where the alerting reads (error_logs), not only the Postgres log.
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'declutter pickup reminder email could not be queued',
            jsonb_build_object('source', 'declutter_pickup_remind'),
            jsonb_build_object('user_id', p_user::text, 'error', SQLERRM));
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_pickup_remind(uuid, text, text, text, uuid) TO service_role;

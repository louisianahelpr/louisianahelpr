-- Q?analytics-test-traffic: robot traffic is TAGGED in analytics_events, and
-- the owner's funnel reads analytics_events_real, which leaves it out.
--
-- MEASURED 2026-10-15 (prod, last 30 days): signup_started 4573 rows, 4556
-- anonymous; payment_made 2284; first_payment_collected 929; against ~35
-- non-seed profiles. The nightly journeys, press-every-control, loading-states
-- and the local agent harnesses all run the real app against this database.
--
-- Three parts:
--  1. tag_automated_analytics_event (BEFORE INSERT): a row is tagged
--     properties.automated = true with properties.automation = <reason> when
--       - its user_id is a test profile (profiles.is_seed)        'seed_user'
--       - the browser's Origin is http://localhost / 127.0.0.1 /
--         [::1] (a dev or preview build on the prod backend; the
--         apps are capacitor://localhost and https://localhost)  'local_origin'
--       - the User-Agent names a headless or automation browser  'headless_ua'
--     A row the client already tagged (src/lib/automatedBrowser.ts:
--     webdriver, the lh_automation flag, a seed session) keeps its reason.
--     Tagging never drops a row: journeys still prove events fire.
--  2. analytics_events_real: the funnel view, rows that are neither tagged nor
--     from a test profile (is_seed read live, so a profile flagged later drops
--     out). Service role only, like the reads the funnel uses today.
--  3. A one-time backfill MARKS past rows it can prove were robots (a test
--     profile's rows; rows whose referrer is a local preview) with automation
--     'backfill_seed_user' / 'backfill_local_referrer'. Nothing is deleted.
--     Anonymous past rows carry no origin or user agent, so they cannot be
--     proven either way and are left as they are.
--
-- Replay-safe: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the backfill
-- skips rows that already carry the tag.

CREATE OR REPLACE FUNCTION public.tag_automated_analytics_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_raw text;
  v_headers jsonb;
  v_origin text;
  v_ua text;
  v_reason text;
BEGIN
  IF NEW.properties IS NULL THEN
    NEW.properties := '{}'::jsonb;
  END IF;
  -- The client tagged it (src/lib/automatedBrowser.ts): keep its reason.
  IF NEW.properties -> 'automated' = 'true'::jsonb THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = NEW.user_id
          AND p.is_seed
     ) THEN
    v_reason := 'seed_user';
  ELSE
    -- PostgREST sets request.headers per request; a direct SQL insert has none.
    -- Validated, not cast in an EXCEPTION block: a subtransaction per insert
    -- would overflow the subxact cache on a large batch (lh-authz-rls review).
    v_raw := nullif(current_setting('request.headers', true), '');
    IF v_raw IS NOT NULL AND pg_input_is_valid(v_raw, 'jsonb') THEN
      v_headers := v_raw::jsonb;
    END IF;
    v_origin := lower(coalesce(v_headers ->> 'origin', ''));
    v_ua := coalesce(v_headers ->> 'user-agent', '');
    IF v_origin ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$' THEN
      v_reason := 'local_origin';
    ELSIF v_ua ~* '(HeadlessChrome|Playwright|Puppeteer|Selenium|PhantomJS)' THEN
      v_reason := 'headless_ua';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    NEW.properties := NEW.properties
      || jsonb_build_object('automated', true, 'automation', v_reason);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tag_automated_analytics_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tag_automated_analytics_event ON public.analytics_events;
CREATE TRIGGER trg_tag_automated_analytics_event
  BEFORE INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.tag_automated_analytics_event();

-- The funnel view. security_invoker: it reads with the caller's rights, and
-- only the service role (and postgres) may select it at all.
CREATE OR REPLACE VIEW public.analytics_events_real
WITH (security_invoker = true) AS
SELECT e.*
  FROM public.analytics_events e
 WHERE NOT (coalesce(e.properties, '{}'::jsonb) -> 'automated' IS NOT DISTINCT FROM 'true'::jsonb)
   AND NOT EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.user_id = e.user_id
            AND p.is_seed
       );

-- Read-only for the service role: the view is auto-updatable, and the default
-- ACL would otherwise hand service_role write rights through it.
REVOKE ALL ON public.analytics_events_real FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.analytics_events_real TO service_role;

COMMENT ON VIEW public.analytics_events_real IS
  'Q?analytics-test-traffic: analytics_events without robot traffic (rows tagged properties.automated, or from an is_seed profile), for reading the sign-up funnel. Selects e.*: a DROP COLUMN on analytics_events must recreate this view.';

-- One-time backfill: mark (never delete) the past rows that are provably robots.
UPDATE public.analytics_events e
   SET properties = coalesce(e.properties, '{}'::jsonb)
         || jsonb_build_object('automated', true, 'automation', 'backfill_seed_user')
 WHERE e.user_id IS NOT NULL
   AND NOT (coalesce(e.properties, '{}'::jsonb) ? 'automated')
   AND EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.user_id = e.user_id
            AND p.is_seed
       );

UPDATE public.analytics_events e
   SET properties = coalesce(e.properties, '{}'::jsonb)
         || jsonb_build_object('automated', true, 'automation', 'backfill_local_referrer')
 WHERE e.referrer ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)'
   AND NOT (coalesce(e.properties, '{}'::jsonb) ? 'automated');

-- Q1352: nobody saw Content-Security-Policy violations. csp-report stores one
-- public.error_logs row per browser report (tags.source = 'csp'), but
-- prod-errors-check ignores that source and the daily digest shows a source
-- only as one "latest message" line while it is in the top 15. Measured
-- 2026-10-12: 115 rows since 2026-10-05, all script-src-elem blocking
-- https://vercel.live/_next-live/feedback/feedback.js on www.louisianahelpr.com,
-- and none of them was ever read.
--
-- send_ops_daily_digest() now leads with one line counting the last 24 hours'
-- CSP reports by directive and blocked host (top 5). Everything else is the
-- 20260914183932 body verbatim (live md5(prosrc) d785da84… matched it,
-- 2026-10-12). Replay-safe: CREATE OR REPLACE; grants restated.
-- Guard: src/test/opsDigestCountsCsp.test.ts and
-- src/test/pglite/opsDigestCountsCsp.pglite.mjs.

CREATE OR REPLACE FUNCTION public.send_ops_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total   int;
  v_groups  int;
  v_lines   text;
  v_message text;
  v_request bigint;
  v_csp     int;
  v_csp_by  text;
  v_csp_groups int;
  v_csp_line text := '';
BEGIN
  WITH src AS (
    SELECT COALESCE(
             CASE WHEN jsonb_typeof(e.tags) = 'object'
                  THEN COALESCE(e.tags ->> 'source', e.tags ->> 'area') END,
             CASE WHEN jsonb_typeof(e.context) = 'string' THEN e.context #>> '{}' END,
             'app') AS source,
           e.severity,
           e.message,
           e.created_at
      FROM public.error_logs e
     WHERE e.created_at > now() - interval '24 hours'
       AND NOT (jsonb_typeof(e.tags) = 'object' AND e.tags ->> 'source' = 'ops-digest')
  ),
  grouped AS (
    SELECT s.source,
           count(*) AS n,
           string_agg(DISTINCT s.severity, '/') AS severities,
           (array_agg(s.message ORDER BY s.created_at DESC))[1] AS latest
      FROM src s
     GROUP BY s.source
  )
  SELECT (SELECT count(*) FROM src),
         (SELECT count(*) FROM grouped),
         string_agg(format('• *%s* ×%s (%s): %s', g.source, g.n, g.severities,
                           replace(left(g.latest, 110), E'\n', ' ')),
                    E'\n' ORDER BY g.n DESC)
           FILTER (WHERE g.rn <= 15)
    INTO v_total, v_groups, v_lines
    FROM (SELECT grouped.*, row_number() OVER (ORDER BY n DESC) AS rn FROM grouped) g;

  -- Q1352: Content-Security-Policy violations (csp-report writes one
  -- error_logs row per report, tags.source = 'csp'). The by-source lines
  -- above show at most the latest message, and only while 'csp' is in the
  -- top 15 sources, so a blocked script was stored and never read. This line
  -- always shows them, grouped by directive and blocked host. The directive
  -- and URL come from the browser (anon can INSERT error_logs directly), so
  -- control characters become spaces (no forged digest lines) and
  -- slack-ops-alert escapes & < >.
  SELECT COALESCE(sum(c.n), 0)::int,
         string_agg(format('%s ← %s ×%s', c.directive, c.host, c.n), '; ' ORDER BY c.n DESC, c.directive, c.host)
           FILTER (WHERE c.rn <= 5),
         count(*)::int
    INTO v_csp, v_csp_by, v_csp_groups
    FROM (SELECT g.*, row_number() OVER (ORDER BY g.n DESC, g.directive, g.host) AS rn
            FROM (SELECT left(regexp_replace(COALESCE(NULLIF(e.tags ->> 'directive', ''), '(unknown)'),
                                         '[[:cntrl:]]', ' ', 'g'), 40) AS directive,
                         left(regexp_replace(COALESCE(NULLIF(split_part(split_part(e.tags ->> 'blocked', '://', 2), '/', 1), ''),
                                                      NULLIF(e.tags ->> 'blocked', ''), '(none)'),
                                             '[[:cntrl:]]', ' ', 'g'), 60) AS host,
                         count(*) AS n
                    FROM public.error_logs e
                   WHERE e.created_at > now() - interval '24 hours'
                     AND jsonb_typeof(e.tags) = 'object'
                     AND e.tags ->> 'source' = 'csp'
                   GROUP BY 1, 2) g) c;

  IF v_csp > 0 THEN
    v_csp_line := format(E'CSP violations (24h): %s report(s): %s', v_csp, v_csp_by)
                  || CASE WHEN v_csp_groups > 5 THEN format(' (+%s more)', v_csp_groups - 5) ELSE '' END
                  || E'\n';
  END IF;

  v_message := CASE
    WHEN COALESCE(v_total, 0) = 0 THEN 'Nothing logged in the last 24 hours. (This message is the daily proof that alerting works.)'
    ELSE v_csp_line || left(v_lines, 2700 - length(v_csp_line))
         || CASE WHEN v_groups > 15 THEN format(E'\n…and %s more sources.', v_groups - 15) ELSE '' END
         || E'\nNone of these paged. Critical items (prod down, money at risk, deploy failed, security) post on their own.'
  END;

  BEGIN
    v_request := net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'digest',
        'severity', 'info',
        'title', format('Daily ops digest: %s event(s) in 24h', COALESCE(v_total, 0)),
        'message', v_message,
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    v_request := NULL;
  END;

  -- The delivery record check_ops_digest_delivery() reads. Written even when
  -- the enqueue failed (request_id null), so a failure is seen, not inferred.
  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES ('info',
          format('Daily ops digest enqueued (%s events)', COALESCE(v_total, 0)),
          jsonb_build_object('source', 'ops-digest', 'area', 'alerting'),
          jsonb_build_object('request_id', v_request));

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'sources', COALESCE(v_groups, 0),
                            'csp', COALESCE(v_csp, 0),
                            'request_id', v_request, 'posted', v_request IS NOT NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.send_ops_daily_digest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_ops_daily_digest() TO service_role;

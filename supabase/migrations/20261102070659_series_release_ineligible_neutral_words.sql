-- Q2246 (lh-authz-rls@c5aea62b4c#3): the poster's notice from series_release_dates said "A Helpr gave up ..." for
-- every release, including charge-recurring-visits' release of an under-18 or not-ready holder's dates
-- (p_reason 'holder_ineligible'), which nobody gave up. That reason now reads "<dates> on "<series>" is/are open
-- again. ..." and names nothing about the Helpr; every other reason keeps its words byte for byte.
--
-- Restated from prod (md5(prosrc) f77ecc23b132e302d50bf3fd0f12df9d on 2026-11-02 = 20260927012806's body with
-- 20261025203540's fee-words rewrite) with only the poster's format string chosen by reason. Arguments, logic,
-- the Helprs' notice and grants unchanged (REVOKE/GRANT restated as live: postgres + service_role only).
-- The owner half of Q2246 (may a Helpr re-claim a date the cron released?) is NOT decided here.
-- Proof: src/test/pglite/seriesReleaseNeutralWords.pglite.mjs.

CREATE OR REPLACE FUNCTION public.series_release_dates(
  p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
RETURNS date[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_released date[];
  v_list text;
  v_flag text := current_setting('app.series_end_rpc', true);
BEGIN
  IF p_parent IS NULL OR p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RETURN ARRAY[]::date[];
  END IF;

  PERFORM set_config('app.series_end_rpc', '1', true);

  -- A date with a booked visit is not released here (it is cancelled from its
  -- own card, helper_cancel_booking, which vacates the visit first). A
  -- VACATED visit (open, no Helpr, still funded) is released like an
  -- uncreated date: the next Helpr takes over that visit row.
  WITH gone AS (
    DELETE FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id = p_helper
       AND h.visit_date = ANY (p_dates)
       AND NOT EXISTS (SELECT 1 FROM public.jobs c
                        WHERE c.parent_job_id = p_parent AND c.date_needed = h.visit_date
                          AND NOT (c.status::text = 'open' AND c.helper_id IS NULL)
                        FOR SHARE)
    RETURNING h.visit_date
  )
  SELECT COALESCE(array_agg(visit_date ORDER BY visit_date), ARRAY[]::date[]) INTO v_released FROM gone;

  IF cardinality(v_released) > 0 THEN
    INSERT INTO public.recurring_visit_releases (parent_job_id, helper_id, visit_date, reason)
    SELECT p_parent, p_helper, d, p_reason FROM unnest(v_released) AS d
    ON CONFLICT (parent_job_id, visit_date)
      DO UPDATE SET helper_id = EXCLUDED.helper_id, reason = EXCLUDED.reason, created_at = now();

    SELECT string_agg(to_char(d, 'FMDy FMMon FMDD'), ', ' ORDER BY d) INTO v_list FROM unnest(v_released) AS d;

    IF p_customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        p_customer, p_parent,
        CASE WHEN cardinality(v_released) = 1 THEN 'A visit date is open again' ELSE 'Visit dates are open again' END,
        -- Q2246: charge-recurring-visits releases an ineligible holder's dates ('holder_ineligible'); nobody gave
        -- them up, so the poster reads a neutral line that names nothing about the Helpr.
        format(CASE WHEN p_reason = 'holder_ineligible'
                    THEN '%s on "%s" %s open again. Another Helpr on the series can pick %s up, or you can offer %s to someone new. A date nobody takes isn''t charged, or most of it comes back to your card if you already paid for it.'
                    ELSE 'A Helpr gave up %s on "%s"%s. Another Helpr on the series can pick %s up, or you can offer %s to someone new. A date nobody takes isn''t charged, or most of it comes back to your card if you already paid for it.'
               END,
               v_list, COALESCE(p_title, 'your series'),
               CASE WHEN p_reason = 'holder_ineligible' THEN CASE WHEN cardinality(v_released) = 1 THEN 'is' ELSE 'are' END ELSE '' END,
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
               CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END),
        'job_updates', '/posts?job=' || p_parent::text);
    END IF;

    -- Every other Helpr on the series (holding a date from today on), not the
    -- one who gave it up.
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    SELECT DISTINCT h.helper_id, p_parent,
           'A date opened up — pick it up',
           format('%s on "%s" %s open. First to pick %s up gets %s.',
                  v_list, COALESCE(p_title, 'your series'),
                  CASE WHEN cardinality(v_released) = 1 THEN 'is' ELSE 'are' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END,
                  CASE WHEN cardinality(v_released) = 1 THEN 'it' ELSE 'them' END),
           'job_updates', '/jobs?job=' || p_parent::text
      FROM public.series_visit_holds h
     WHERE h.parent_job_id = p_parent
       AND h.helper_id <> p_helper
       AND h.visit_date >= (now() AT TIME ZONE 'America/Chicago')::date;
  END IF;

  PERFORM set_config('app.series_end_rpc', COALESCE(v_flag, '0'), true);
  RETURN v_released;
END;
$fn$;

REVOKE ALL ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.series_release_dates(uuid, uuid, date[], text, text, uuid) TO service_role;

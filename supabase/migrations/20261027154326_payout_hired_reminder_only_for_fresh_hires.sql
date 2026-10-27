-- "You're hired. Set up payouts to get paid." went to a Helpr hired 18 days
-- earlier, for a job already COMPLETED (owner report, 2026-10-26).
--
-- Measured on prod 2026-10-27 (read-only): payout-setup-reminders sent the
-- 'hired' notice and email to helper 7f65ef12 at 2026-10-26 20:09Z for job
-- 9c6ff2de "Assemble an IKEA dresser": accepted_at 2026-10-08 23:38Z,
-- status completed (2026-10-25 20:29Z), payment_status payout_pending. The
-- 'money' reminder for that job (pay held for lack of a payout account) went
-- 2026-10-25 23:54Z, which is right. The 'hired' one fired the next day
-- because claim_payout_setup_reminders treated ANY job holding money for the
-- Helpr as "a hire", with no hire time and no status check: once
-- payout_after_hire and payout_setup went to everyone (2026-10-25 23:40:59Z)
-- every Helpr with an old funded or completed-unpaid job qualified. It is the
-- only 'hired' reminder ever sent (payout_setup_reminders: 2 rows in all), and
-- day1 for the same Helpr would have followed on 2026-10-27 20:09Z.
--
-- Now (narrowed by a /code-review of the first cut, which used one 'hired'
-- per Helpr and a 24 h window that money reminders or a paused switch could
-- crowd out for good):
--   - 'money' (one per job whose payout waits on this Helpr) is unchanged and
--     still comes first.
--   - 'hired' is PER HIRE (key hired:<job>): a live hire (job not completed,
--     cancelled or disputed; a crew seat while its crew job is still 'open'
--     counts) made after payout_after_hire went to everyone
--     (2026-10-25 23:40:59Z, a constant: feature_switches.updated_at moves on
--     every later audience change) and in the last 72 hours, not already
--     reminded. The hire time is jobs.accepted_at (a crew seat:
--     group_job_helpers.joined_at); no hire time, no reminder.
--   - day1 / day3 / day7 are per hire too (key day1:<job> ...), counted from
--     that hire's own 'hired' reminder, and only while the hire is live. A
--     second hire gets its own "You're hired", never a stray day7.
--   - The rows already on prod (money:9c6ff2de..., and 'hired' with job
--     9c6ff2de, completed) produce nothing more.
--
-- claim_payout_setup_reminders is restated from its effective definition
-- (20261025162003; live prosrc md5 58035927fcb6fd5ad587b76539caed44, equal,
-- measured 2026-10-27). Replay-safe: CREATE OR REPLACE. Grants: service_role
-- only, as before; its COMMENT is restated to the new rule.
-- Proof: src/test/pglite/payoutHiredReminderFreshHires.pglite.mjs. Guard:
-- src/test/payoutHiredReminderFreshHires.test.ts.

CREATE OR REPLACE FUNCTION public.claim_payout_setup_reminders(p_limit integer DEFAULT 100)
 RETURNS TABLE(helper_id uuid, reminder_key text, stage text, job_id uuid, job_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- When payout_after_hire went to everyone (feature_switches.updated_at,
  -- measured 2026-10-27). A constant on purpose: updated_at moves on every
  -- later audience change, and a hire before go-live was never told to set up
  -- at the hire, so it is not told now.
  v_since constant timestamptz := '2026-10-25 23:40:59+00';
BEGIN
  RETURN QUERY
  WITH hires AS (
    SELECT j.helper_id AS uid, j.id AS jid, j.title AS jtitle, j.payment_status::text AS pay,
           j.accepted_at AS hired_on,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed')) AS live
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL
       AND j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
    UNION ALL
    -- A crew seat: hired when it joined; the crew job may still be 'open'
    -- while other seats fill.
    SELECT g.helper_id, j.id, j.title, j.payment_status::text,
           g.joined_at,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed'))
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
     WHERE j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
  ),
  helprs AS (
    SELECT DISTINCT h.uid
      FROM hires h
      JOIN public.profiles p ON p.user_id = h.uid
     WHERE (p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE)
       AND NOT (p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id))
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.claimed_at > now() - interval '20 hours')
       AND public.feature_enabled_for_user('payout_after_hire', h.uid)
       AND public.feature_enabled_for_user('payout_setup', h.uid)
  ),
  -- One 'hired' per hire: a live hire made after go-live and in the last 72 h
  -- that has not had its own. Not a COMPLETED or disputed job (owner report
  -- 2026-10-26), not a hire from before go-live, not one with no hire time.
  hired_due AS (
    SELECT DISTINCT ON (h.uid) h.uid, h.jid
      FROM hires h
     WHERE h.uid IN (SELECT x.uid FROM helprs x)
       AND h.live
       AND h.hired_on >= v_since
       AND h.hired_on > now() - interval '72 hours'
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired' AND r.job_id = h.jid)
     ORDER BY h.uid, h.hired_on DESC, h.jid
  ),
  -- day1 / day3 / day7 per hire, counted from THAT hire's 'hired' reminder,
  -- and only while the hire is live.
  nudge_due AS (
    SELECT DISTINCT ON (n.uid) n.uid, n.jid, n.step
      FROM (
        SELECT h.uid, h.jid,
               CASE
                 WHEN hr.claimed_at <= now() - interval '7 days' AND COALESCE(ls.last_step, 0) < 3 THEN 'day7'
                 WHEN hr.claimed_at <= now() - interval '3 days' AND COALESCE(ls.last_step, 0) < 2 THEN 'day3'
                 WHEN hr.claimed_at <= now() - interval '1 day'  AND COALESCE(ls.last_step, 0) < 1 THEN 'day1'
               END AS step
          FROM hires h
          JOIN public.payout_setup_reminders hr
            ON hr.helper_id = h.uid AND hr.reminder_stage = 'hired' AND hr.job_id = h.jid
          LEFT JOIN LATERAL (
            SELECT max(CASE r.reminder_stage WHEN 'day1' THEN 1 WHEN 'day3' THEN 2 WHEN 'day7' THEN 3 ELSE 0 END) AS last_step
              FROM public.payout_setup_reminders r
             WHERE r.helper_id = h.uid AND r.job_id = h.jid AND r.reminder_stage IN ('day1', 'day3', 'day7')
          ) ls ON true
         WHERE h.live AND h.uid IN (SELECT x.uid FROM helprs x)
      ) n
     WHERE n.step IS NOT NULL
     ORDER BY n.uid, n.jid
  ),
  due AS (
    SELECT x.uid,
           -- money first: one per job whose payout waits on this Helpr
           (SELECT 'money:' || h.jid::text FROM hires h
             WHERE h.uid = x.uid AND h.pay = 'payout_pending'
               AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                                WHERE r.helper_id = x.uid AND r.reminder_key = 'money:' || h.jid::text)
             ORDER BY h.jid LIMIT 1) AS money_key,
           (SELECT hd.jid FROM hired_due hd WHERE hd.uid = x.uid) AS hired_jid,
           (SELECT nd.jid FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_jid,
           (SELECT nd.step FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_step
      FROM helprs x
  ),
  chosen AS (
    SELECT d.uid,
           CASE WHEN d.money_key IS NOT NULL THEN d.money_key
                WHEN d.hired_jid IS NOT NULL THEN 'hired:' || d.hired_jid::text
                ELSE d.nudge_step || ':' || d.nudge_jid::text END AS rkey,
           CASE WHEN d.money_key IS NOT NULL THEN 'money'
                WHEN d.hired_jid IS NOT NULL THEN 'hired'
                ELSE d.nudge_step END AS rstage,
           CASE WHEN d.money_key IS NOT NULL THEN substr(d.money_key, 7)::uuid
                WHEN d.hired_jid IS NOT NULL THEN d.hired_jid
                ELSE d.nudge_jid END AS rjob
      FROM due d
     WHERE d.money_key IS NOT NULL OR d.hired_jid IS NOT NULL OR d.nudge_step IS NOT NULL
     ORDER BY d.uid
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ),
  ins AS (
    INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, reminder_stage, job_id)
    SELECT c.uid, c.rkey, c.rstage, c.rjob FROM chosen c
    ON CONFLICT DO NOTHING
    RETURNING public.payout_setup_reminders.helper_id, public.payout_setup_reminders.reminder_key,
              public.payout_setup_reminders.reminder_stage, public.payout_setup_reminders.job_id
  )
  SELECT i.helper_id, i.reminder_key, i.reminder_stage, i.job_id, j.title
    FROM ins i
    LEFT JOIN public.jobs j ON j.id = i.job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_payout_setup_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_setup_reminders(integer) TO service_role;
COMMENT ON FUNCTION public.claim_payout_setup_reminders(integer) IS
  'Payout setup reminders (owner 2026-10-25; narrowed 2026-10-27 after the owner report of 2026-10-26): claims at most one due reminder per not-yet-payout-ready Helpr, at most one a day: one per job whose payout waits (money:<job>), first; one hired:<job> per live hire made after payout_after_hire went live (2026-10-25 23:40:59Z) and in the last 72 h; then day1/day3/day7:<job> counted from that hire''s own hired reminder while the hire is live (not completed, cancelled or disputed). Only while payout_after_hire and payout_setup are on for them; returns only the rows it inserted. service_role only.';

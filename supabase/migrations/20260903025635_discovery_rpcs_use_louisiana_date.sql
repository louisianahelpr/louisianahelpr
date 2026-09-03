-- CURRENT_DATE is UTC. Louisiana is not.
--
-- MEASURED IN PROD at 21:36 CDT on 2026-09-02:
--     current_date                             -> 2026-09-03
--     (now() at time zone 'America/Chicago')   -> 2026-09-02
--     open jobs visible under current_date     -> 9
--     open jobs visible under the local date   -> 14
--
-- Five of fourteen open jobs — 36% of the board — were hidden from the public
-- job page, the browse map and the landing feed while still visible on the
-- signed-in dashboard. The same job, present on one surface and absent from
-- another, at the same instant.
--
-- It runs EVERY EVENING from 19:00 CDT until midnight UTC, which is the peak
-- window for same-day work in a same-day-labour marketplace. And it self-heals
-- at midnight UTC, which is exactly why a thirty-nine-lane audit running in
-- daylight never saw it. It was found by the coverage audit, not by any lane.
--
-- The client already knows better: useDashboardFilters.ts:196-201 builds
-- `todayLocalDate` from local parts, with a comment warning against this
-- precise mistake. The three server RPCs never got the same treatment, so the
-- dashboard and the public surfaces disagree for five hours a night.
--
-- THE FIX IS THE FUNCTION'S TIMEZONE, NOT ITS BODY.
--
-- `CURRENT_DATE` is `now()` rendered in the session's TimeZone setting, so it
-- is not the predicate that is wrong — it is the timezone the predicate is
-- evaluated in. `ALTER FUNCTION … SET timezone` pins that per function, for the
-- duration of the call only.
--
-- The alternative was rewriting three function bodies totalling ~11KB to swap
-- one token. Those bodies carry the ownership filter, the escrow gate, the
-- seed switch, the early-access perk, the direct-offer rule and the ranking
-- maths, every one of them load-bearing and several added within the last
-- week. Replacing them by hand to change `CURRENT_DATE` would put all of that
-- at risk of a transcription slip for no benefit — the same shape of risk that
-- made a 51-pin security function worth diffing rather than reading, two
-- migrations ago. This touches none of it.
--
-- NOT set on the database. `ALTER DATABASE … SET timezone` would fix these
-- three and also silently change how every timestamptz is rendered and how
-- every `::date` cast behaves everywhere else in the schema. Three functions
-- have the bug; three functions get the fix.
--
-- Replay-safe: ALTER FUNCTION … SET is idempotent and carries no body.

ALTER FUNCTION public.get_ranked_open_jobs(integer, integer, boolean)
  SET timezone TO 'America/Chicago';

ALTER FUNCTION public.get_open_jobs_for_map()
  SET timezone TO 'America/Chicago';

ALTER FUNCTION public.get_public_open_jobs(integer)
  SET timezone TO 'America/Chicago';

-- The same class, lower stakes, fixed for consistency rather than urgency: a
-- credential expiring "today" should expire at Louisiana midnight, not five
-- hours early. Both landed earlier today (20260903012612) and both compare a
-- date column against CURRENT_DATE.
ALTER FUNCTION public.get_user_credential_tier(uuid)
  SET timezone TO 'America/Chicago';

ALTER FUNCTION public.review_credential(uuid, text, text, text, date)
  SET timezone TO 'America/Chicago';

COMMENT ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean) IS
  'Ranked browse feed. Runs with timezone=America/Chicago so CURRENT_DATE is the '
  'Louisiana date — without it, jobs needed TODAY disappear from browse every '
  'evening between 19:00 CDT and midnight UTC while remaining on the dashboard.';

-- Q2292 follow-up (lead, 2026-10-21): 9 stored notifications from 2026-10-08 still name another member
-- in full ("Lexi Lombas accepted your offer"). The 20261021061341 backfill skipped any row whose
-- RECIPIENT has the same full name as the member named in it, to protect a member's own name. That
-- compared name TEXT. The owner has several test accounts all named "Lexi Lombas", so a notice FROM one
-- of them TO another was read as the recipient's own name and left in full. Measured on prod
-- 2026-10-21 (read-only, Q2292's done-when sql): exactly those 9 rows. Every one carries a job_id,
-- and the member it names is that job's other party.
--
-- The rule now compares USER IDS. A member's name in a notification is shortened to member_display_name
-- (e.g. "Lexi L.") when that member is not the recipient AND either:
--   (a) the recipient's own full name differs (the 061341 rule, unchanged), or
--   (b) the notification's job names that member, by id, as a party: the poster (customer_id), the
--       hired Helpr (helper_id), an applicant (applications.helper_id) or a crew member
--       (group_job_helpers.helper_id). The actor is then known by id, so a shared name is not the
--       recipient's.
-- A row with no job_id and a recipient of the same name is still left alone: nothing identifies
-- the member by id there.
-- Staff rows (an admin recipient with an /admin link) keep full names, as in 061341.
--
-- One time and idempotent: a renamed row no longer contains the full name, so a second run finds
-- nothing. A name whose display form contains the full name ("Bo K") is skipped, as in 061341.
-- Proof: node src/test/pglite/memberNamesSameNameBackfill.pglite.mjs (red on 061341's rule, 3x).
DO $backfill$
DECLARE
  v_pass int := 0;
  v_rows int;
BEGIN
  LOOP
    v_pass := v_pass + 1;
    WITH names AS (
      SELECT p.user_id,
             '\m' || regexp_replace(btrim(p.full_name), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M' AS rx,
             replace(public.member_display_name(p.full_name, NULL), '\', '\\') AS dn,
             length(btrim(p.full_name)) AS len,
             btrim(p.full_name) AS full
        FROM public.profiles p
       WHERE btrim(p.full_name) ~ '\s'
         AND position(btrim(p.full_name) IN public.member_display_name(p.full_name, NULL)) = 0
    ), hit AS (
      SELECT DISTINCT ON (n.id) n.id, nm.rx, nm.dn
        FROM public.notifications n
        JOIN names nm
          ON nm.user_id IS DISTINCT FROM n.user_id
         AND (coalesce(n.title, '') ~ nm.rx OR coalesce(n.message, '') ~ nm.rx)
         AND (
               -- (a) the recipient's own name is different (061341's rule).
               NOT EXISTS (SELECT 1 FROM public.profiles rp
                            WHERE rp.user_id = n.user_id AND btrim(rp.full_name) = nm.full)
               -- (b) the job names this member, by id, as a party.
            OR (n.job_id IS NOT NULL AND (
                  EXISTS (SELECT 1 FROM public.jobs j
                           WHERE j.id = n.job_id AND nm.user_id IN (j.customer_id, j.helper_id))
               OR EXISTS (SELECT 1 FROM public.applications a
                           WHERE a.job_id = n.job_id AND a.helper_id = nm.user_id)
               OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                           WHERE g.job_id = n.job_id AND g.helper_id = nm.user_id)))
             )
       WHERE NOT (coalesce(n.link, '') LIKE '/admin%'
                  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'))
       ORDER BY n.id, nm.len DESC
    )
    UPDATE public.notifications n
       SET title = regexp_replace(n.title, h.rx, h.dn, 'g'),
           message = regexp_replace(n.message, h.rx, h.dn, 'g')
      FROM hit h
     WHERE n.id = h.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'Q2292 same-name backfill pass %: % notification(s) renamed', v_pass, v_rows;
    EXIT WHEN v_rows = 0 OR v_pass >= 10;
  END LOOP;
END
$backfill$;

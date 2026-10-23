-- An admin sees a member's FIRST AND LAST name in every notification; nobody else does (owner,
-- 2026-10-23: "admin should always see their first and last name on every notification. no one else").
--
-- WHAT IT WAS. Since Q2292 / Q2327 every producer writes a member as "First L." (member_display_name,
-- 20261021131322) into the row's title and message, whoever the recipient is. The owner's own bell,
-- as an admin who posts jobs, read 'Taylor M. applied to "GIVE AWAY!!"' (screenshot 2026-10-23).
-- Measured on prod 2026-10-23: 21 public functions call member_display_name, 16 of them insert
-- notifications; the rows carry no actor column, so the name is baked into the text where it is written.
--
-- THE RULE, ONE PLACE. Restating the 16 producers one by one would leave the next producer to forget
-- it. Instead a BEFORE INSERT trigger on public.notifications rewrites the text of a row whose
-- RECIPIENT is an admin (user_roles role 'admin'), and only that row:
--   1. candidates = the members the row can be about: the job's poster, Helpr and offered Helpr, every
--      applicant on the job (crews are applications), and a member named in the link (user= / userId= /
--      offerTo=). The job is NEW.job_id or, when the producer left it empty, the job its link names
--      (notification_job_id_from_link, the same reader trg_notifications_fill_job_id uses);
--   2. each candidate's short form is member_display_name(full_name, NULL), the exact text a producer
--      wrote; a short form that more than one candidate shares is skipped (no guessing between two
--      "Taylor M."s), and so is one that is already the whole name ("Cher") or sits inside it ("Ann B."
--      in "Ann B. Bell", which a re-run would grow again), or is absurdly long (over 200 characters);
--   3. every whole-word occurrence of that short form in title and message becomes the full name,
--      whitespace-collapsed, longest short form first. The recipient's own name is never a candidate.
--   The trigger is named notifications_admin_full_names so it fires FIRST among the BEFORE INSERT row
--   triggers (same-kind triggers fire in name order; "n" < "suppress_exact_duplicate_notification" <
--   "trg_notifications_*"): the duplicate check then compares the rewritten text with the stored,
--   rewritten rows, as it did before for everyone (lh-authz-rls review, 2026-10-23).
--   It never fails an insert: any error keeps the row as the producer wrote it, with a WARNING (the
--   same pattern as notifications_seed_boundary); full_name is member-supplied and unconstrained.
--   A row whose rewrite failed is not retried: that admin row keeps "First L." (the safe direction).
-- A non-admin recipient's row is returned untouched, so no member ever receives a last name through
-- this path (the guard plants that defect and goes red).
--
-- WHAT IT DOES NOT COVER (stated, not hidden):
--   - the email a producer sends in the same breath (net.http_post with its own v_message) still
--     carries "First L.": it is built before the row exists. Bell and push (fan_out_push_on_notification
--     reads the stored row, AFTER INSERT) carry the full name.
--   - a line that names someone by first name only (nudge_confirm) or not at all ("A user needs manual
--     review") is left as written.
--
-- BACKFILL, one time: the same rewrite over every admin recipient's stored rows (833 rows on
-- 2026-10-23, all types; most name nobody and do not change). Runs as the migration owner, which the
-- read-only-update trigger (notifications_member_updates_read_only) lets through. Idempotent: a full
-- name never contains its own short form (those candidates are skipped), so a re-run finds nothing.
--
-- REPLAY-SAFETY: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; every object read exists before this file.

CREATE OR REPLACE FUNCTION public.notification_admin_full_names(
  p_recipient uuid, p_job_id uuid, p_link text, p_title text, p_message text,
  OUT title text, OUT message text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid;
  v_job uuid;
  r record;
  v_pat text;
BEGIN
  title := p_title;
  message := p_message;
  IF p_recipient IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_recipient AND ur.role = 'admin') THEN
    RETURN;
  END IF;

  BEGIN
  v_job := COALESCE(p_job_id, public.notification_job_id_from_link(p_link));
  v_user := substring(p_link FROM '[?&](?:user|userId|offerTo)=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid;

  FOR r IN
    WITH cand AS (
      SELECT j.customer_id AS uid FROM public.jobs j WHERE j.id = v_job
      UNION SELECT j.helper_id FROM public.jobs j WHERE j.id = v_job
      UNION SELECT j.offered_to_helper_id FROM public.jobs j WHERE j.id = v_job
      UNION SELECT a.helper_id FROM public.applications a WHERE a.job_id = v_job
      UNION SELECT v_user
    ), named AS (
      SELECT public.member_display_name(p.full_name, NULL) AS short_name,
             btrim(regexp_replace(p.full_name, '[\t\n\v\f\r    -     　﻿]+', ' ', 'g')) AS full_name
        FROM cand c
        JOIN public.profiles p ON p.user_id = c.uid
       WHERE c.uid IS NOT NULL AND c.uid <> p_recipient
    )
    SELECT short_name, min(full_name) AS full_name
      FROM named
     WHERE short_name IS NOT NULL AND strpos(full_name, short_name) = 0 AND length(short_name) <= 200
     GROUP BY short_name
    HAVING count(DISTINCT full_name) = 1
     ORDER BY length(short_name) DESC
  LOOP
    -- The short form as a literal (every non-alphanumeric character escaped; in an ARE a backslash before
    -- a non-alphanumeric is that character), as a whole word.
    v_pat := '(^|[^[:alnum:]])' || regexp_replace(r.short_name, '([^[:alnum:][:space:]])', '\\\1', 'g') || '(?![[:alnum:]])';
    title := regexp_replace(title, v_pat, '\1' || replace(r.full_name, '\', '\\'), 'g');
    message := regexp_replace(message, v_pat, '\1' || replace(r.full_name, '\', '\\'), 'g');
  END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Never fail a notification (or the backfill) over a name: the text stays as the producer wrote it.
    title := p_title;
    message := p_message;
    RAISE WARNING 'notification_admin_full_names: % (recipient=%)', SQLERRM, p_recipient;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.notification_admin_full_names(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notifications_admin_full_names()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v record;
BEGIN
  BEGIN
    SELECT * INTO v FROM public.notification_admin_full_names(NEW.user_id, NEW.job_id, NEW.link, NEW.title, NEW.message);
    NEW.title := v.title;
    NEW.message := v.message;
  EXCEPTION WHEN OTHERS THEN
    -- Never fail a notification over a name: the row goes out as the producer wrote it.
    RAISE WARNING 'notifications_admin_full_names: % (user=%)', SQLERRM, NEW.user_id;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notifications_admin_full_names() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notifications_admin_full_names ON public.notifications;
CREATE TRIGGER notifications_admin_full_names
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_admin_full_names();

-- Backfill: every admin recipient's stored rows, rewritten by the same rule.
DO $backfill$
DECLARE
  v_rows int;
BEGIN
  WITH fixed AS (
    SELECT n.id, f.title, f.message
      FROM public.notifications n
      CROSS JOIN LATERAL public.notification_admin_full_names(n.user_id, n.job_id, n.link, n.title, n.message) f
     WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin')
       AND (f.title IS DISTINCT FROM n.title OR f.message IS DISTINCT FROM n.message)
  )
  UPDATE public.notifications n SET title = fixed.title, message = fixed.message
    FROM fixed WHERE n.id = fixed.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'admin full names: % stored row(s) rewritten', v_rows;
END
$backfill$;

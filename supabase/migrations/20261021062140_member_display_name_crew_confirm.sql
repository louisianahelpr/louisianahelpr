-- Q2292 (part 2 of 2; part 1 is 20261021061341_member_display_name.sql, which defines
-- public.member_display_name and backfills stored rows): the crew-confirm notice ("<Name> confirmed their
-- spot") named the Helpr in full. Restated verbatim from its effective definition (md5 of prosrc matched
-- prod 2026-10-21); only the name line changes. A file of its own because its body shares lines with
-- complete_pending_accepts_on_setup, and a guard's @mutate find string must be unique in its file.
--
-- REPLAY-SAFETY: CREATE OR REPLACE keeps the trigger and grants; member_display_name exists (part 1).

-- complete_pending_crew_confirms_on_setup: restated verbatim from its effective definition (md5 of prosrc matched prod 2026-10-21); only the name line changes.
CREATE OR REPLACE FUNCTION public.complete_pending_crew_confirms_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crew_confirm_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  -- Payout setup AND the identity rule, the one helper every accept reads.
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force completes nothing (complete_pending_accepts_on_setup's
  -- predicate); the recorded Confirm waits.
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT p.slot_id, p.job_id, j.title, j.customer_id, g.helper_id = NEW.user_id AS still_theirs,
           j.status::text IN ('open', 'accepted', 'in_progress') AS live,
           g.helper_confirmed_at
      FROM public.crew_confirm_pending p
      JOIN public.group_job_helpers g ON g.id = p.slot_id
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
     ORDER BY p.requested_at
       FOR UPDATE OF g
  LOOP
    BEGIN
      IF r.still_theirs AND r.live AND r.helper_confirmed_at IS NULL THEN
        UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = r.slot_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your setup is done, so your spot on "' || COALESCE(r.title, 'the job') || '" is confirmed.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
        -- The poster hears it as from any member's Confirm-after-setup, as a
        -- single job's completed accept tells them (complete_job_accept).
        IF r.customer_id IS NOT NULL THEN
          SELECT public.member_display_name(pp.full_name, 'Someone') INTO v_name
            FROM public.profiles pp WHERE pp.user_id = NEW.user_id;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            r.customer_id,
            COALESCE(v_name, 'Someone') || ' confirmed their spot',
            COALESCE(v_name, 'Someone') || ' confirmed their spot on "' || COALESCE(r.title, 'your job') || '".',
            'job_updates',
            '/posts?job=' || r.job_id::text,
            r.job_id
          );
        END IF;
      END IF;
      DELETE FROM public.crew_confirm_pending WHERE slot_id = r.slot_id;
    EXCEPTION WHEN OTHERS THEN
      -- seed-policy: no seed branch needed: a seed Helpr is never setup-blocked
      -- (helper_accept_missing's fixture carve-out), so a seed account never
      -- has a pending crew Confirm and never reaches this log.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        'pending crew confirm completion failed',
        jsonb_build_object('source', 'complete_pending_crew_confirms_on_setup', 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'slot_id', r.slot_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

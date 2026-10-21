-- JOB PHOTOS ON SOCIAL MEDIA, WITH AN OPT-OUT (owner, 2026-10-20).
--
-- Terms "Photos from jobs": Louisiana Helpr may use a job's before/after photos
-- to show what Helprs do, unless a member turns off "Let Helpr share my job
-- photos" (You › Settings). A job's photos are used only when BOTH the poster
-- (whose home they show) and every Helpr booked on it (who took them) allow it.
--
-- 1. profiles.share_job_photos: the member's own switch, default ON. Granted for
--    UPDATE by name (prod's column list), limited to the own row by the existing
--    policy; prevent_self_escalation does not pin it; a banned member may still
--    turn it OFF (ban lock exemption below); export_my_data exports the whole
--    profile row (to_jsonb), so it is in the export.
-- 2. public.job_photos_shareable(p_job_id): for admins (marketing), true only
--    when the poster AND every booked Helpr allow it, and the job has a Helpr.
--    Anyone else is refused (admin_only, 42501); anon has no EXECUTE.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_job_photos boolean NOT NULL DEFAULT true;

-- Prod grants `authenticated` UPDATE on a NAMED column list (not the table), so a
-- new column is not writable until it is named (same as age_attested_at,
-- 20261014205016). The own-row UPDATE policy then limits it to the member's row.
GRANT UPDATE (share_job_photos) ON public.profiles TO authenticated;

-- A banned or suspended member may still WITHDRAW consent (as with
-- marketing_consent): enforce_banned_profile_text_lock, the newest definition
-- (20260923185224), verbatim except the share_job_photos -> false exemption.
CREATE OR REPLACE FUNCTION public.enforce_banned_profile_text_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed text[];
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Q281: the banned owner's own writes. Everything they can still legitimately
  -- change: accepting terms (a legal record), withdrawing marketing consent,
  -- the Senior Mode accessibility switch, clearing Available now, and (20261021001940)
  -- turning OFF "Let Helpr share my job photos". Anything
  -- else is refused outright rather than silently pinned, so the caller sees
  -- account_restricted instead of a 200 that changed nothing.
  IF auth.uid() = OLD.user_id AND public.is_caller_banned()
     AND current_setting('app.ban_started_in_txn', true) IS DISTINCT FROM auth.uid()::text THEN
    SELECT array_agg(n.key ORDER BY n.key)
      INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value
       AND n.key NOT IN ('updated_at', 'terms_version_accepted', 'terms_accepted_at',
                         'accepted_terms_at', 'marketing_consent', 'senior_mode')
       AND NOT (n.key = 'available_until' AND n.value = 'null'::jsonb)
       -- 20261021001940: withdrawing job-photo consent, like marketing_consent; turning it back ON is not.
       AND NOT (n.key = 'share_job_photos' AND n.value = 'false'::jsonb);
    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'account_restricted'
        USING ERRCODE = '42501',
              DETAIL = 'A suspended or banned account cannot change: ' || array_to_string(v_changed, ', '),
              HINT = 'This account is suspended or banned. See /account-banned for details.';
    END IF;
  END IF;

  -- OLD, not NEW: the question is whether they are banned RIGHT NOW, and
  -- prevent_self_escalation already pins ban_status so NEW cannot differ for a
  -- member anyway. Reading OLD makes that independent of trigger order.
  IF OLD.ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    NEW.full_name := OLD.full_name;
    NEW.bio       := OLD.bio;
  END IF;

  RETURN NEW;
END;
$function$;


COMMENT ON COLUMN public.profiles.share_job_photos IS
  'Terms "Photos from jobs": false = never use this member''s job photos in Helpr marketing. Default true. Read by job_photos_shareable.';

CREATE OR REPLACE FUNCTION public.job_photos_shareable(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_poster uuid;
  v_helprs uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT j.customer_id INTO v_poster FROM public.jobs j WHERE j.id = p_job_id;
  -- No job, or a job whose poster deleted their account: nobody can say yes.
  IF v_poster IS NULL THEN
    RETURN false;
  END IF;

  v_helprs := public.job_booked_helpr_ids(p_job_id);
  -- No Helpr booked: there are no before/after photos to share.
  IF v_helprs IS NULL OR cardinality(v_helprs) = 0 THEN
    RETURN false;
  END IF;

  -- Every party must have a profile row that says yes (a missing row is a no).
  RETURN (SELECT count(*) FROM public.profiles p
           WHERE p.user_id = ANY (v_helprs || v_poster) AND p.share_job_photos)
         = cardinality(ARRAY(SELECT DISTINCT u FROM unnest(v_helprs || v_poster) u));
END;
$fn$;

REVOKE ALL ON FUNCTION public.job_photos_shareable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_photos_shareable(uuid) TO authenticated, service_role;

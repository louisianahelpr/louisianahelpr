-- READ 2026-10-04 from LIVE prod (fncmgoasalhdgfwzhsqa), read-only:
--   information_schema.columns (public.applications, every column, types as
--   live), pg_constraint (UNIQUE (job_id, helper_id)), pg_class.relacl
--   (anon=arwdxm, authenticated=arwdxm; MAINTAIN is not modelled), pg_policy
--   (all seven applications policies, verbatim), pg_get_functiondef.
-- Consumed by the applications PGlite proofs in src/test/pglite/
-- (applicationsInsertRpcOnly, applicationColumnOwnership,
-- applicationFlagWithheld). Function bodies are verbatim except that the
-- comments inside apply_to_job and enforce_application_limit are elided;
-- md5(prosrc) live:
--   application_cap                  adf99bc9f20b5b29bf0fd1c52af2cbee
--   apply_to_job                     e565935c397a63140aca7959aa20673f
--   are_users_blocked                a0731c1a984038d3fab1f3b770188e36
--   enforce_application_limit        03eaad4cb54f0e4846a1ac77a44c19ed
--   get_job_customer_id              227b1b59cdc9a0f44c1439432a387601
--   has_role                         dae5cfc5a8d92461a428f6702e4e65af
--   is_server_context                ebc78d554c09d9ebf387992e83d584c8
--   job_is_funded                    4747745432475180fdb2fcb54581b5ff
--   job_payment_is_funded            bb3115be10e06f0b65e5bdaa21c37422
--   lock_applications_owner_columns  8c8815c0f1666143f1ecdf64233f7bf9
--   scan_application_contact_info    ab63320ad4b2dd4cdf236da2392ab47a
-- Stubs (not verbatim): auth.uid() reads request.uid and auth.role() reads
-- request.jwt.claim.role; contact_leak_reason flags a run of 10 digits (live
-- is a fuller detector; only "flags or not" matters here); jobs, user_roles,
-- user_blocks, fraud_flags and platform_settings carry only the columns these
-- functions read. Triggers not modelled: the ban gate, the email gate, the
-- shadowban and credential gates, enforce_application_job_state, the
-- notification triggers and the job-point snapshot (none is under test).

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TYPE public.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  helper_id uuid,
  status text NOT NULL DEFAULT 'open',
  payment_status text
);
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.fraud_flags (user_id uuid, flag_type text, details text, resolved boolean NOT NULL DEFAULT false);
CREATE TABLE public.platform_settings (
  application_cap_per_minute integer,
  application_cap_per_hour integer,
  daily_application_cap integer,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO public.platform_settings (application_cap_per_minute, application_cap_per_hour, daily_application_cap)
VALUES (NULL, NULL, 100);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated, service_role;
GRANT ALL ON public.user_roles, public.user_blocks, public.fraud_flags, public.platform_settings TO service_role;

CREATE TABLE public.applications (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  helper_id uuid NOT NULL,
  message text,
  status public.application_status DEFAULT 'pending'::public.application_status NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  attachment_urls text[] DEFAULT '{}'::text[],
  offer_message text,
  stake_amount numeric,
  stake_status text DEFAULT 'none'::text,
  poster_viewed_at timestamp with time zone,
  decline_reason text,
  flagged_hidden boolean DEFAULT false NOT NULL,
  flag_reason text,
  job_latitude numeric,
  job_longitude numeric,
  closed_reason text,
  CONSTRAINT applications_job_id_helper_id_key UNIQUE (job_id, helper_id)
);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.applications TO anon, authenticated;
GRANT ALL ON public.applications TO service_role;

CREATE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false)
      OR public.is_server_context()
      OR pg_trigger_depth() > 0
    THEN EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    )
  END;
$function$;

CREATE FUNCTION public.get_job_customer_id(_job_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT customer_id FROM public.jobs WHERE id = _job_id;
$function$;

CREATE FUNCTION public.job_payment_is_funded(p_payment_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_payment_status, '') = ANY (
    ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]
  );
$function$;

CREATE FUNCTION public.job_is_funded(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT public.job_payment_is_funded(j.payment_status)
      FROM public.jobs j
     WHERE j.id = p_job_id
  ), false);
$function$;

CREATE FUNCTION public.application_cap(p_kind text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT nullif(greatest(coalesce(
           CASE p_kind
             WHEN 'minute' THEN s.application_cap_per_minute
             WHEN 'hour'   THEN s.application_cap_per_hour
             WHEN 'day'    THEN s.daily_application_cap
           END, 0), 0), 0)
    FROM public.platform_settings s
   ORDER BY s.updated_at DESC NULLS LAST
   LIMIT 1
$function$;

CREATE FUNCTION public.apply_to_job(p_job_id uuid, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_app_id uuid;
  v_existing int;
  v_status text;
  v_payment_status text;
  v_count int;
  v_cap_minute int := public.application_cap('minute');
  v_cap_hour   int := public.application_cap('hour');
  v_cap_day    int := public.application_cap('day');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_rate:' || auth.uid()::text, 0));

  IF v_cap_minute IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 minute';
    IF v_count >= v_cap_minute THEN
      RAISE EXCEPTION 'rate_limit_minute' USING HINT = 'Too many applications — try again in a minute';
    END IF;
  END IF;

  IF v_cap_hour IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 hour';
    IF v_count >= v_cap_hour THEN
      RAISE EXCEPTION 'rate_limit_hour' USING HINT = 'Hourly application limit reached — try again later';
    END IF;
  END IF;

  IF v_cap_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM applications
      WHERE helper_id = auth.uid() AND created_at > now() - INTERVAL '1 day';
    IF v_count >= v_cap_day THEN
      RAISE EXCEPTION 'rate_limit_day' USING HINT = 'Daily application limit reached — try again tomorrow';
    END IF;
  END IF;

  SELECT status, payment_status INTO v_status, v_payment_status
  FROM jobs WHERE id = p_job_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF v_status != 'open' THEN
    RAISE EXCEPTION 'Job is no longer accepting applications';
  END IF;

  IF NOT public.job_payment_is_funded(v_payment_status) THEN
    RAISE EXCEPTION 'This job is not accepting applications yet'
      USING HINT = 'The poster has not completed checkout, so there is no payment held for this job.';
  END IF;

  IF EXISTS (SELECT 1 FROM jobs WHERE id = p_job_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Cannot apply to your own job';
  END IF;
  SELECT COUNT(*) INTO v_existing
  FROM applications WHERE job_id = p_job_id AND helper_id = auth.uid();
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Already applied to this job';
  END IF;

  INSERT INTO applications (job_id, helper_id, message, status)
  VALUES (p_job_id, auth.uid(), p_message, 'pending')
  RETURNING id INTO v_app_id;

  RETURN v_app_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.apply_to_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.enforce_application_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  daily_count integer;
  v_cap       integer := public.application_cap('day');
BEGIN
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO daily_count
  FROM public.applications
  WHERE helper_id = NEW.helper_id
    AND created_at > now() - interval '24 hours';

  IF daily_count >= v_cap THEN
    RAISE EXCEPTION 'You have reached the daily application limit (%). Please try again tomorrow.', v_cap;
  END IF;

  IF daily_count + 1 >= v_cap THEN
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT NEW.helper_id, 'application_spam',
             format('Helper reached the daily application cap of %s in 24h.', v_cap)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
        WHERE f.user_id = NEW.helper_id
          AND f.flag_type = 'application_spam'
          AND f.resolved = false
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_application_limit: fraud flag failed for %: %',
        NEW.helper_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE TRIGGER enforce_application_limit BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enforce_application_limit();

CREATE FUNCTION public.lock_applications_owner_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'applications.helper_id is immutable (attempted change on id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'applications.job_id is immutable (attempted change on id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER lock_applications_owner_columns_tg BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.lock_applications_owner_columns();

-- Stub: live is a fuller detector (phones, emails, handles).
CREATE FUNCTION public.contact_leak_reason(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '\d{10}' THEN 'phone number' END
$$;

CREATE FUNCTION public.scan_application_contact_info()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  v_reason := public.contact_leak_reason(NEW.message);
  IF v_reason IS NULL THEN
    v_reason := public.contact_leak_reason(NEW.offer_message);
  END IF;

  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  ELSE
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE TRIGGER applications_scan_contact_info BEFORE INSERT OR UPDATE OF message, offer_message ON public.applications FOR EACH ROW EXECUTE FUNCTION public.scan_application_contact_info();

-- The seven live policies, verbatim.
CREATE POLICY "Admins can view all applications" ON public.applications FOR SELECT TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Helpers can create applications" ON public.applications FOR INSERT TO authenticated
  WITH CHECK (((( SELECT auth.uid() AS uid) = helper_id) AND (status = 'pending'::application_status) AND (NOT are_users_blocked(helper_id, get_job_customer_id(job_id))) AND job_is_funded(job_id)));
CREATE POLICY "Helpers can delete their own pending applications" ON public.applications FOR DELETE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = helper_id) AND (status = 'pending'::application_status)));
CREATE POLICY "Helpers can update their own pending applications" ON public.applications FOR UPDATE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = helper_id) AND (status = 'pending'::application_status)))
  WITH CHECK (((( SELECT auth.uid() AS uid) = helper_id) AND (status = 'pending'::application_status)));
CREATE POLICY "Helpers can view their own applications" ON public.applications FOR SELECT TO authenticated
  USING ((( SELECT auth.uid() AS uid) = helper_id));
CREATE POLICY "Job owners can update application status" ON public.applications FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM jobs j WHERE ((j.id = applications.job_id) AND (j.customer_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM jobs j WHERE ((j.id = applications.job_id) AND (j.customer_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "Job owners can view applications for their jobs" ON public.applications FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) IN ( SELECT jobs.customer_id FROM jobs WHERE (jobs.id = applications.job_id))) AND (NOT are_users_blocked(helper_id, ( SELECT auth.uid() AS uid)))));

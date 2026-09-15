-- GENERATED 2026-09-14 from LIVE prod (fncmgoasalhdgfwzhsqa), read-only:
--   information_schema.columns (jobs + dependents, every column, types as live;
--   job_category mapped to text), pg_enum, pg_policies (jobs SELECT/UPDATE/INSERT,
--   verbatim), role_table_grants, pg_get_functiondef and pg_get_triggerdef.
-- Consumed by scripts/probes/dispute-table-door.probe.mjs. Function bodies are
-- verbatim; md5(prosrc) at read time:
--   are_users_blocked                      0c29ad3c4b72b9835807f05aa8a646ab
--   check_dispute_velocity                 bfce4741df80acc39929fac5fabe1d2f
--   enforce_cancellation_requires_rpc      c0a942f29691ec99c875710a5f2008f4
--   enforce_helper_jobs_column_whitelist   75de6087f63b61837a3f134bd5adc11b
--   enforce_job_status_transition          cc3678a6d920dc3550f353124d4f518b
--   enforce_jobs_insert_column_lock        2a08f7b27410b54d5b5fc392e60708f8
--   enforce_poster_jobs_money_lock         3727688fcc4e055f35cb105e52f1ee08
--   has_role                               dae5cfc5a8d92461a428f6702e4e65af
--   helper_abort_job                       6b1aa1fc132f4307330df71137d542ed
--   open_dispute_as                        c7950efe453c6366b3bdd91c90f34834
--   prevent_job_field_escalation           9fd5ee0db90596b49981399b5a59fbf8
--   rpc_decide_dispute                     41888a5e3d631c42f078a455ae77c7dc
--   rpc_escalate_dispute                   f01b287e156b4cb9f5e24d298d165073
--   rpc_open_dispute                       bea1fdc0e7c56b3ebed8c439dac50970
--   rpc_withdraw_dispute                   aaea12439cd67121e741ed40ddb47910
--   set_dispute_deadline                   d936b77940e17aab2c50b1535500f899
--   sync_has_active_dispute                b384f5e12a68e869a342f774b8e67af1
-- Stubs (not verbatim): auth.uid() reads request.uid; notify_ops_dispute_filed
-- records to ops_pages (live posts to pg_net); apply_job_denial_consequence
-- returns '{}' (the strike ladder is not under test); user_may_see_job_address
-- returns false (the own-job SELECT policy already covers both parties).

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY,
  customer_id uuid,
  title text,
  description text,
  category text,
  location text,
  date_needed date,
  start_time time,
  estimated_hours numeric,
  budget numeric,
  photos text[],
  special_requirements text,
  status public.job_status,
  helper_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  stripe_session_id text,
  stripe_payment_intent_id text,
  payment_status text,
  platform_fee_percent numeric,
  platform_fee_amount numeric,
  revision_note text,
  revision_requested_at timestamptz,
  poster_completed_at timestamptz,
  helper_completed_at timestamptz,
  boosted_at timestamptz,
  boost_expires_at timestamptz,
  is_recurring boolean,
  recurrence_interval text,
  recurrence_end_date date,
  parent_job_id uuid,
  proof_before_urls text[],
  proof_after_urls text[],
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  late_cancellation boolean,
  poster_confirmed_at timestamptz,
  helper_confirmed_at timestamptz,
  helpers_needed integer,
  is_group_job boolean,
  response_deadline timestamptz,
  expires_at timestamptz,
  review_reminder_sent boolean,
  removal_reason text,
  removed_at timestamptz,
  removed_by uuid,
  flag_reasons text[],
  dispute_reason text,
  dispute_evidence_urls text[],
  disputed_at timestamptz,
  disputed_by uuid,
  payout_scheduled_at timestamptz,
  latitude numeric,
  longitude numeric,
  is_urgent boolean,
  urgent_fee numeric,
  cancellation_fee numeric,
  cancellation_fee_status text,
  is_flexible_schedule boolean,
  helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz,
  dispute_deadline timestamptz,
  dispute_status text,
  dispute_helper_response text,
  dispute_resolved_at timestamptz,
  revision_deadline timestamptz,
  revision_completed_at timestamptz,
  revision_acceptance_deadline timestamptz,
  sales_tax_rate numeric,
  sales_tax_amount numeric,
  customer_fee_amount numeric,
  helper_fee_percent numeric,
  commission_tax_amount numeric,
  poster_confirmed_arrival_at timestamptz,
  poster_confirmed_working_at timestamptz,
  parish text,
  zip_code text,
  revision_count integer,
  offered_to_helper_id uuid,
  direct_offer_status text,
  direct_offer_expires_at timestamptz,
  business_id uuid,
  boost_auto_extended boolean,
  start_reminder_sent_at timestamptz,
  no_show_alert_sent_at timestamptz,
  department text,
  requires_w9 boolean,
  credential_tier integer,
  pricing_mode text,
  has_active_dispute boolean,
  protection_fee numeric,
  is_auto_created boolean,
  scope_video_url text,
  expiring_notif_sent boolean,
  payment_confirm_notif_sent boolean,
  recurrence_days smallint[],
  recurrence_weeks smallint,
  recurring_helper_id uuid,
  accepted_at timestamptz,
  helper_dayof_confirmed_at timestamptz,
  dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz,
  release_last_chance_notif_sent_at timestamptz,
  is_seed boolean,
  helper_arrival_verified_at timestamptz,
  require_photo_proof boolean,
  completed_at timestamptz
);
CREATE TABLE public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  opener_id uuid,
  reason text,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_text text,
  payout_split jsonb,
  execution_status text,
  execution_started_at timestamptz,
  executed_at timestamptz,
  execution_transfer_id text,
  execution_refund_id text,
  execution_helper_cents integer,
  execution_refund_cents integer,
  execution_error text
);
CREATE UNIQUE INDEX disputes_one_open_per_job_idx ON public.disputes USING btree (job_id) WHERE (status = 'open'::text);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text,
  message text,
  type text,
  read boolean NOT NULL DEFAULT false,
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role public.app_role
);
CREATE TABLE public.fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  job_id uuid,
  flag_type text,
  details text,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid,
  action text,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.ops_pages (job_id uuid, refiled boolean);
-- Stubs for the INSERT policy / insert column lock: only the columns they read.
CREATE TABLE public.profiles (user_id uuid primary key, idv_status text, is_seed boolean);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
GRANT SELECT ON public.profiles, public.user_blocks TO authenticated;

-- Live table grants on jobs.
GRANT UPDATE, INSERT, REFERENCES, DELETE ON public.jobs TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, UPDATE ON public.jobs TO authenticated;
GRANT TRIGGER, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.jobs TO service_role;
GRANT ALL ON public.disputes, public.notifications, public.user_roles, public.fraud_flags, public.admin_audit_log TO service_role;

CREATE FUNCTION public.user_may_see_job_address(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.notify_ops_dispute_filed(_job_id uuid, _job_title text, _reason text, _opener_id uuid, _refiled boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN INSERT INTO public.ops_pages VALUES (_job_id, _refiled); END; $function$;
CREATE FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _user_a AND blocked_id = _user_b)
       OR (blocker_id = _user_b AND blocked_id = _user_a)
  );
$function$
;
REVOKE ALL ON FUNCTION public.are_users_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_dispute_velocity(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*) < 3
  FROM public.jobs
  WHERE disputed_by = p_user_id
    AND disputed_at > now() - interval '30 days';
$function$
;
REVOKE ALL ON FUNCTION public.check_dispute_velocity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_dispute_velocity(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_cancellation_requires_rpc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  guarded CONSTANT text[] := ARRAY[
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status'
  ];
BEGIN
  -- Service role (edge functions / cron) and admins keep their existing reach;
  -- their access is governed by RLS and the admin audit trail as before.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Inside a sanctioned SECURITY DEFINER exit. The GUC is transaction-local
  -- and each entry point clears it again immediately after its own statement.
  IF COALESCE(current_setting('app.sanctioned_cancel', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION
      'Jobs may only be cancelled through a cancellation RPC (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Posters call poster_cancel_job(); Helprs call helper_cancel_booking() or helper_abort_job(). Those apply the reliability ladder in the same transaction.';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (guarded) THEN
      RAISE EXCEPTION 'jobs.% is set by the cancellation RPC, not by the client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.enforce_cancellation_requires_rpc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_cancellation_requires_rpc() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_cancellation_requires_rpc() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_cancellation_requires_rpc() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (service role: uid NULL; poster; admin) passes through — their
  -- access is governed by RLS as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      -- The verified-arrival stamp is deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side and sets this transaction-local flag. A direct
      -- PATCH from the client still hits the RAISE below.
      IF changed_col = 'helper_arrival_verified_at'
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.enforce_helper_jobs_column_whitelist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_helper_jobs_column_whitelist() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_helper_jobs_column_whitelist() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_helper_jobs_column_whitelist() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_job_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('open',                'accepted'),
      ('open',                'cancelled'),
      ('pending_approval',    'cancelled'),
      ('accepted',            'open'),
      ('accepted',            'in_progress'),
      ('accepted',            'completed'),
      ('accepted',            'cancelled'),
      ('accepted',            'disputed'),
      ('in_progress',         'completed'),
      ('in_progress',         'revision_requested'),
      ('in_progress',         'cancelled'),
      ('in_progress',         'disputed'),
      ('in_progress',         'open'),
      ('revision_requested',  'in_progress'),
      ('revision_requested',  'completed'),
      ('revision_requested',  'cancelled'),
      ('revision_requested',  'disputed'),
      ('disputed',            'completed'),
      ('disputed',            'cancelled'),
      ('disputed',            'in_progress'),
      ('completed',           'disputed')
    ) AS allowed(from_status, to_status)
    WHERE allowed.from_status = OLD.status::text
      AND allowed.to_status   = NEW.status::text
  ) THEN
    RAISE EXCEPTION
      'Invalid job status transition: % -> % (job_id=%)',
      OLD.status, NEW.status, OLD.id
      USING
        ERRCODE = 'check_violation',
        HINT = 'See enforce_job_status_transition() in the migrations for the allowed transition matrix. Admins bypass this check.';
  END IF;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.enforce_job_status_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_job_status_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_job_status_transition() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role (uid NULL) and anyone not inserting their own job pass
  -- through untouched. Same gate as the UPDATE money lock.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_jobs_insert_column_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_jobs_insert_column_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_jobs_insert_column_lock() TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_poster_jobs_money_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_poster_jobs_money_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_poster_jobs_money_lock() TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.helper_abort_job(p_job_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_uid uuid := auth.uid();
  v_reason text;
  v_work_started boolean;
  v_dispute_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required'
      USING HINT = 'Tell the poster why you can''t finish.';
  END IF;
  -- Keep it a sentence, not an essay dumped into a notification body.
  v_reason := left(v_reason, 1000);

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.helper_arrived_at, j.helper_completed_at,
         j.proof_before_urls, j.proof_after_urls
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Server owns the decision: only the ASSIGNED helper, only from a state
  -- this exit is actually for. A poster (or any third party) hitting this
  -- gets not_authorized, not a partial write.
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_abortable'
      USING HINT = 'Only a job that is underway can be abandoned this way.';
  END IF;

  v_work_started :=
        v_job.helper_arrived_at IS NOT NULL
     OR v_job.helper_completed_at IS NOT NULL
     OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
     OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0;

  -- The strike lands first and identically in both branches — the ladder does
  -- not care which settlement path the money takes.
  v_result := public.apply_job_denial_consequence(
    v_uid, v_job.id,
    'Abandoned a job in progress: "' || COALESCE(v_job.title, 'Unknown')
      || '" — ' || v_reason);

  IF v_work_started THEN
    -- ── Branch B: partial work exists → a human decides who gets what. ──
    v_dispute_id := public.rpc_open_dispute(
      v_job.id,
      'Helpr could not finish the job: ' || v_reason,
      '{}'::text[]);

    -- Admin-only from here (see header): never auto-release to the abandoner.
    UPDATE public.jobs
       SET dispute_status = 'escalated'
     WHERE id = v_job.id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Your Helpr couldn''t finish',
      'Your Helpr had to stop work on "' || COALESCE(v_job.title, 'your job')
        || '": ' || v_reason
        || ' Because work had already started, we''re reviewing it — your payment stays in escrow until a decision is made, and you don''t need to do anything.',
      'warning',
      '/my-posts?job=' || v_job.id::text
    );

    RETURN v_result || jsonb_build_object(
      'outcome', 'disputed',
      'dispute_id', v_dispute_id);
  END IF;

  -- ── Branch A: nothing was done → reopen, no money moves. ──
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = v_uid AND status = 'accepted';

  -- Same clean slate helper_cancel_booking leaves, so the day-of machinery
  -- runs fresh for the next helper rather than inheriting this one's stamps.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         helper_on_the_way_at = NULL,
         helper_arrived_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL,
         revision_requested_at = NULL,
         revision_note = NULL,
         revision_deadline = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr couldn''t finish',
    'Your Helpr had to drop "' || COALESCE(v_job.title, 'your job')
      || '": ' || v_reason
      || ' They never started, so nothing was charged — the job is open to everyone again and your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/my-posts?job=' || v_job.id::text
  );

  RETURN v_result || jsonb_build_object('outcome', 'reopened');
END;
$function$
;
REVOKE ALL ON FUNCTION public.helper_abort_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.helper_abort_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.helper_abort_job(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text
    INTO _customer, _helper, _title, _status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    UPDATE public.disputes
    SET evidence_urls = evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls =
             COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls =
           COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
   WHERE id = _job_id;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed — dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and an admin will decide it — add your side.',
        'warning',
        '/my-posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/my-jobs?job=' || _job_id::text
      );
    END IF;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/my-posts?job=' || _job_id::text
           ELSE '/my-jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes'
    );
  END LOOP;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$
;
REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_job_field_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- Tier 1 — no authenticated client writes these through ANY path. The only
  -- writers are rpc_decide_dispute (admin-only, exempt above) and the
  -- escrow/payout edge functions, which run as service_role and return at the
  -- auth.uid() IS NULL gate.
  locked_everyone CONSTANT text[] := ARRAY[
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'sales_tax_rate',
    'protection_fee',
    'urgent_fee',
    'payout_scheduled_at',
    'has_active_dispute'
  ];
  poster_locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'stripe_session_id',
    'boosted_at',
    'boost_expires_at',
    -- ADDED 2026-09-04. Without it, a pending-direct-offer helper could clear
    -- or set the once-only auto-extension latch: clearing it re-arms a free
    -- +12h featured placement every hour off a single $3 boost; setting it
    -- denies a paying subscriber the extension they bought.
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    'customer_id'
  ];
  poster_locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  v_is_target boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_everyone) THEN
      RAISE EXCEPTION 'jobs.% is set by the platform, not by a client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- The poster and the assigned helper have a column-lock trigger each
  -- (enforce_poster_jobs_money_lock / enforce_helper_jobs_column_whitelist).
  -- Leave them to those, so there is exactly one place to read per role.
  IF auth.uid() = OLD.customer_id OR auth.uid() = OLD.helper_id THEN
    RETURN NEW;
  END IF;

  -- The business-member branch used to sit here. Business accounts are gone,
  -- so the targeted helper is the only remaining third party with any UPDATE
  -- grant on a job row.
  v_is_target := OLD.offered_to_helper_id IS NOT NULL
                 AND auth.uid() = OLD.offered_to_helper_id;

  IF NOT v_is_target THEN
    -- No policy grants anyone else UPDATE on this row; RLS decides, as before.
    RETURN NEW;
  END IF;

  -- A deny-list rather than an allow-list, on purpose: the sibling BEFORE
  -- triggers (stamp_job_accepted_at, set_revision_deadline,
  -- track_revision_scope_creep) sort ahead of this one and legitimately mutate
  -- NEW, and their writes are indistinguishable from the client's here.
  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (poster_locked_always) THEN
      RAISE EXCEPTION 'jobs.% is not writable from this seat', changed_col
        USING ERRCODE = '42501';
    END IF;
    IF OLD.payment_status IS DISTINCT FROM 'unpaid'
       AND changed_col = ANY (poster_locked_when_funded) THEN
      -- The one sanctioned write to helper_id: the targeted helper taking a
      -- still-open funded job (respond_to_direct_offer). Identical carve-out
      -- to the poster trigger's.
      IF changed_col = 'helper_id'
         AND OLD.helper_id IS NULL
         AND NEW.helper_id IS NOT NULL
         AND OLD.status = 'open' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'jobs.% is not writable from this seat after escrow is funded', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A targeted helper may TAKE the offer; they may not hand the job to
  -- somebody else.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id
     AND NEW.helper_id IS NOT NULL
     AND NEW.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'An offered Helpr may only assign the job to themselves'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.prevent_job_field_escalation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_job_field_escalation() TO anon;
GRANT EXECUTE ON FUNCTION public.prevent_job_field_escalation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_job_field_escalation() TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(_dispute_id uuid, _decision_text text, _payout_split jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _customer_id uuid;
  _helper_id uuid;
  _job_title text;
  _existing_status text;
  _poster_share numeric;
  _helper_share numeric;
  _new_job_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _decision_text IS NULL OR length(trim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  SELECT job_id, status INTO _job_id, _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
  END IF;

  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id;

  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  IF _poster_share >= 1 AND _helper_share <= 0 THEN
    _new_job_status := 'cancelled';
  ELSE
    _new_job_status := 'completed';
  END IF;

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         payout_split = jsonb_build_object(
           'poster', _poster_share,
           'helper', _helper_share
         ),
         -- The decision is on record; the money is not. Until
         -- execute-dispute-split flips this to 'executed', this dispute is
         -- UNSETTLED and stays in the admin's open work.
         execution_status = COALESCE(disputes.execution_status, 'pending')
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now(),
         dispute_status = 'resolved'
   WHERE id = _job_id;

  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/my-posts?job=' || _job_id::text,
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text,
      '/my-jobs?job=' || _job_id::text,
      false
    );
  END IF;

  -- Audit-log entry so this admin action shows up alongside every other
  -- admin mutation in AdminAuditLog. Non-fatal — the decision itself has
  -- already committed; a failed audit write shouldn't roll it back.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'decide_dispute',
      _dispute_id,
      'dispute',
      jsonb_build_object(
        'job_id', _job_id,
        'poster_share', _poster_share,
        'helper_share', _helper_share,
        'new_job_status', _new_job_status,
        'decision_preview', left(_decision_text, 200)
      )
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$function$
;
REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_escalate_dispute(_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _dispute_status text;
  _other uuid;
  _admin uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE for the same reason rpc_open_dispute takes it: two parties can
  -- escalate the same dispute at the same instant, and the second one must
  -- read the first one's write rather than both fanning out to every admin.
  SELECT customer_id, helper_id, title, status::text, dispute_status
    INTO _customer, _helper, _title, _status, _dispute_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  IF _status <> 'disputed' THEN
    RAISE EXCEPTION 'job is not disputed';
  END IF;

  -- Already escalated is a NO-OP, not an error. Both parties can now escalate
  -- and the control stays on screen; making the second tap fail would show an
  -- error for an action whose desired end state already holds. Returning early
  -- also means the admin fan-out happens exactly once per escalation.
  IF _dispute_status = 'escalated' THEN
    RETURN _job_id;
  END IF;

  -- The two pre-decision values of the mirror column. Anything else
  -- ('auto_resolved', 'resolved') means the dispute is over and there is
  -- nothing left to hand an admin.
  IF _dispute_status IS NOT NULL AND _dispute_status NOT IN ('open', 'helper_responded') THEN
    RAISE EXCEPTION 'dispute is no longer open';
  END IF;

  UPDATE public.jobs
     SET dispute_status = 'escalated'
   WHERE id = _job_id;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- The counterparty: the decision just moved to a human and the deadline they
  -- were watching will no longer fire.
  IF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'Dispute escalated to an admin',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. An admin will decide it — the payment stays on hold until they do.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/my-posts?job=' || _job_id::text
           ELSE '/my-jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- The admins, who are the ones who actually decide it. This is the half that
  -- could not be done from the client at all. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Dispute escalated',
      '"' || COALESCE(_title, 'a job') || '" dispute has been escalated and needs an admin decision. Payment is on hold.',
      -- `admin_alert`, not `warning`: this is addressed to admins only, and
      -- typing it as a severity puts it in the same preference bucket as
      -- party-facing warnings (N-011).
      'admin_alert',
      '/admin?view=disputes&job=' || _job_id::text
    );
  END LOOP;

  RETURN _job_id;
END;
$function$
;
REVOKE ALL ON FUNCTION public.rpc_escalate_dispute(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_escalate_dispute(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_escalate_dispute(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- One creation path. Everything this function used to do inline — the
  -- description guard, the FOR UPDATE, the party check, the existing-dispute
  -- re-freeze, the velocity flag, the notifications and the Slack page — now
  -- lives in open_dispute_as, so the platform's own filings cannot drift from
  -- the ones people make.
  RETURN public.open_dispute_as(_job_id, _uid, _reason, _evidence_urls);
END;
$function$
;
REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_withdraw_dispute(_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _opener uuid;
  _dispute_id uuid;
  _restored text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id, opener_id INTO _dispute_id, _opener
    FROM public.disputes
   WHERE job_id = _job_id AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1
     FOR UPDATE;

  IF _dispute_id IS NULL THEN
    RAISE EXCEPTION 'no open dispute for this job';
  END IF;

  -- Only whoever raised it may withdraw it. The other party's route out is
  -- the admin decision path, not a unilateral close.
  IF _opener IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'only the party who opened this dispute may withdraw it';
  END IF;

  -- The status this job held before the dispute froze it. See the header for
  -- why it is derived rather than read, and why only two values are reachable.
  -- Read under the same FOR UPDATE lock the dispute row is holding, so a
  -- concurrent approval cannot land between this read and the write below.
  SELECT CASE
           WHEN j.poster_completed_at IS NOT NULL
             OR j.payout_scheduled_at IS NOT NULL
             OR COALESCE(j.payment_status, '') IN ('payout_pending', 'released')
           THEN 'completed'
           ELSE 'in_progress'
         END
    INTO _restored
    FROM public.jobs j
   WHERE j.id = _job_id
     FOR UPDATE;

  UPDATE public.disputes
     SET status = 'withdrawn',
         decided_at = now()
   WHERE id = _dispute_id;

  -- Transaction-local, and set only here — after the opener check above.
  -- enforce_helper_jobs_column_whitelist reads it to let THIS statement stamp
  -- jobs.dispute_resolved_at when the opener is the assigned helper.
  PERFORM set_config('app.dispute_withdraw_rpc', '1', true);

  UPDATE public.jobs
     SET status = _restored::job_status,
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;

  -- Closed immediately rather than left to the end of the transaction: the
  -- flag must not still be open for whatever the caller does next in the same
  -- statement batch.
  PERFORM set_config('app.dispute_withdraw_rpc', '0', true);
END;
$function$
;
REVOKE ALL ON FUNCTION public.rpc_withdraw_dispute(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_dispute(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_dispute(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_dispute_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'disputed' AND (OLD.status IS NULL OR OLD.status != 'disputed') THEN
    NEW.dispute_deadline := NEW.disputed_at + interval '72 hours';
  END IF;
  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.set_dispute_deadline() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_dispute_deadline() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_dispute_deadline() TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_has_active_dispute()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Terminal dispute states, from every resolution path that exists today:
  --   rpc_decide_dispute        → 'resolved'
  --   rpc_withdraw_dispute      → 'resolved'
  --   auto-resolve-disputes     → 'auto_resolved'
  --   chargeDisputeClosed       → 'resolved' / 'auto_resolved'
  -- Anything else that is set at all ('open' from rpc_open_dispute,
  -- 'escalated' from helper_abort_job, 'stripe_chargeback' from
  -- chargeDisputeCreated, 'reversal_hold' from transferReversed) is live and
  -- freezes escrow, so it counts as active. status='disputed' with a NULL
  -- dispute_status counts too, so a half-written row still reads as frozen.
  NEW.has_active_dispute :=
        COALESCE(NEW.dispute_status IS DISTINCT FROM 'resolved'
                 AND NEW.dispute_status IS DISTINCT FROM 'auto_resolved', true)
    AND (NEW.status = 'disputed' OR NEW.dispute_status IS NOT NULL);
  RETURN NEW;
END;
$function$
;
REVOKE ALL ON FUNCTION public.sync_has_active_dispute() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_has_active_dispute() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_has_active_dispute() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_has_active_dispute() TO service_role;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can update all jobs" ON public.jobs AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Admins can view all jobs" ON public.jobs AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Customers can create jobs" ON public.jobs AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = customer_id) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.idv_status = 'verified'::text)))) AND (business_id IS NULL) AND ((offered_to_helper_id IS NULL) OR (NOT are_users_blocked(customer_id, offered_to_helper_id)))));
CREATE POLICY "Customers can update their own jobs" ON public.jobs AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = customer_id));
CREATE POLICY "Helpers can update their assigned jobs" ON public.jobs AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = helper_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = helper_id));
CREATE POLICY "Selected helpers can view their job" ON public.jobs AS PERMISSIVE FOR SELECT TO authenticated USING (user_may_see_job_address(id, ( SELECT auth.uid() AS uid)));
CREATE POLICY "Targeted helper can respond to direct offer" ON public.jobs AS PERMISSIVE FOR UPDATE TO authenticated USING (((offered_to_helper_id = ( SELECT auth.uid() AS uid)) AND (direct_offer_status = 'pending'::text)));
CREATE POLICY "Targeted helper can view direct offer" ON public.jobs AS PERMISSIVE FOR SELECT TO authenticated USING (((offered_to_helper_id IS NOT NULL) AND (offered_to_helper_id = ( SELECT auth.uid() AS uid)) AND (direct_offer_status = 'pending'::text)));
CREATE POLICY "Users can view their own jobs" ON public.jobs AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = customer_id) OR (( SELECT auth.uid() AS uid) = helper_id)));

CREATE TRIGGER trg_cancellation_requires_rpc BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_cancellation_requires_rpc();
CREATE TRIGGER trg_enforce_job_status_transition BEFORE UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_job_status_transition();
CREATE TRIGGER trg_helper_jobs_column_whitelist BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_helper_jobs_column_whitelist();
CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_jobs_insert_column_lock();
CREATE TRIGGER trg_poster_jobs_money_lock BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION enforce_poster_jobs_money_lock();
CREATE TRIGGER trg_prevent_job_field_escalation BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION prevent_job_field_escalation();
CREATE TRIGGER trg_set_dispute_deadline BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION set_dispute_deadline();
CREATE TRIGGER trg_sync_has_active_dispute BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION sync_has_active_dispute();

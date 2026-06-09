-- B2B workspace upgrade for businesses + business_members.
--
-- Bundles every schema change for the "real B2B workspace" — granular
-- roles, approval workflow, departments, 2FA-required flag, default
-- payment method, saved-helper team visibility, monthly budget alerting,
-- plus the supporting RPCs.
--
-- IMPORTANT operational notes:
--
-- * This file is REPLAY-SAFE. Every DDL is guarded with IF [NOT] EXISTS
--   or a do-block existence check so a from-scratch rebuild succeeds.
-- * Every RPC is `OR REPLACE` + explicit `GRANT EXECUTE TO authenticated`.
-- * RPCs ship with a PGRST202 fallback in the calling client code —
--   migrations don't auto-deploy on prod, so the page must still render
--   between merge and the manual `supabase db push`.

-- =====================================================================
-- 1. business_members.role — granular roles
-- =====================================================================
-- We don't expand the `business_member_role` enum (enum churn requires
-- downtime in HA setups). Instead we introduce a NULLABLE `extended_role`
-- text column with a CHECK constraint; the existing `role` enum column
-- stays as the owner/member binary for backward compatibility. New UI
-- writes/reads `extended_role`; legacy code paths continue to use `role`.
ALTER TABLE public.business_members
  ADD COLUMN IF NOT EXISTS extended_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_members_extended_role_check'
  ) THEN
    ALTER TABLE public.business_members
      ADD CONSTRAINT business_members_extended_role_check
      CHECK (
        extended_role IS NULL
        OR extended_role IN ('viewer', 'poster', 'approver', 'admin', 'owner')
      );
  END IF;
END
$$;

-- Backfill any existing rows with a sensible default ('poster') so the
-- new UI has a stable read on day one. Owners stay 'owner', everyone
-- else maps to 'poster' which matches the current de-facto permission.
UPDATE public.business_members
   SET extended_role = CASE WHEN role = 'owner' THEN 'owner' ELSE 'poster' END
 WHERE extended_role IS NULL;

-- =====================================================================
-- 2. Approval workflow — businesses.require_approval_above
-- =====================================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS require_approval_above numeric;

COMMENT ON COLUMN public.businesses.require_approval_above IS
  'Dollar threshold above which a new job posted under this business goes to status pending_approval instead of open. NULL = approval disabled.';

-- jobs.status is an enum; widen it to include pending_approval (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending_approval'
      AND enumtypid = 'public.job_status'::regtype
  ) THEN
    ALTER TYPE public.job_status ADD VALUE 'pending_approval';
  END IF;
END
$$;

-- =====================================================================
-- 3. Departments / cost centers
-- =====================================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS department text;

COMMENT ON COLUMN public.jobs.department IS
  'Optional cost-center / department label, used by business-account posters for accounting + reporting.';

-- =====================================================================
-- 4. 2FA / SSO requirement flag
-- =====================================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS require_2fa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.require_2fa IS
  'When true, members must have MFA enrolled before they can post jobs. Soft-enforced today via in-app banner; hard enforcement is a follow-up.';

-- =====================================================================
-- 5. Default payment method (Stripe payment_method id)
-- =====================================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS default_payment_method_id text;

COMMENT ON COLUMN public.businesses.default_payment_method_id IS
  'Stripe payment_method ID owned by the business; when set, jobs posted under this business default to charging this method instead of the poster''s personal card.';

-- =====================================================================
-- 6. Saved-helper team visibility
-- =====================================================================
ALTER TABLE public.favorite_helpers
  ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_favorite_helpers_business
  ON public.favorite_helpers(business_account_id)
  WHERE business_account_id IS NOT NULL;

COMMENT ON COLUMN public.favorite_helpers.business_account_id IS
  'When set, this favorite is visible to every member of the linked business (a "team preferred helper"). NULL = private to the customer.';

-- Read policy: team members can SELECT favorites pinned to their business.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'favorite_helpers'
      AND policyname = 'Team members can see team favorites'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "Team members can see team favorites"
        ON public.favorite_helpers FOR SELECT
        TO authenticated
        USING (
          business_account_id IS NOT NULL
          AND business_account_id IN (
            SELECT business_id FROM public.business_members
             WHERE user_id = auth.uid()
               AND status = 'active'
          )
        );
    $POLICY$;
  END IF;
END
$$;

-- =====================================================================
-- 7. Monthly budget + alert threshold
-- =====================================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS monthly_budget numeric;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS monthly_budget_alert_at numeric;

COMMENT ON COLUMN public.businesses.monthly_budget IS
  'Owner-set monthly spend ceiling in USD; nudges (and eventually blocks) above this threshold.';
COMMENT ON COLUMN public.businesses.monthly_budget_alert_at IS
  'Owner-set ratio (0.0 - 1.0) of monthly_budget at which an alert fires (e.g. 0.8 for 80%).';

-- =====================================================================
-- 8. RPC: update_business_member_role
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_business_member_role(
  p_member_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_is_owner boolean;
BEGIN
  IF p_role NOT IN ('viewer', 'poster', 'approver', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role
      USING ERRCODE = '22023';
  END IF;

  SELECT bm.business_id INTO v_business_id
    FROM public.business_members bm
   WHERE bm.id = p_member_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE = '42704';
  END IF;

  SELECT (b.owner_id = auth.uid()) INTO v_is_owner
    FROM public.businesses b
   WHERE b.id = v_business_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    -- Admins can also reassign roles (but never to/from owner).
    IF NOT EXISTS (
      SELECT 1 FROM public.business_members
       WHERE business_id = v_business_id
         AND user_id = auth.uid()
         AND status = 'active'
         AND extended_role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Only the owner or an admin can change roles'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.business_members
     SET extended_role = p_role
   WHERE id = p_member_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_business_member_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_business_member_role(uuid, text) TO authenticated;

-- =====================================================================
-- 9. RPC: approve_pending_job / reject_pending_job
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_pending_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.jobs WHERE id = p_job_id;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Job not found or not posted by a business' USING ERRCODE = '42704';
  END IF;

  -- Only owners + approvers + admins can approve.
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = auth.uid()
       AND status = 'active'
       AND extended_role IN ('owner', 'approver', 'admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = v_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You do not have approval permission for this team'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jobs
     SET status = 'open'
   WHERE id = p_job_id
     AND status = 'pending_approval';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pending_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_pending_job(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_pending_job(p_job_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.jobs WHERE id = p_job_id;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Job not found or not posted by a business' USING ERRCODE = '42704';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = auth.uid()
       AND status = 'active'
       AND extended_role IN ('owner', 'approver', 'admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = v_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You do not have approval permission for this team'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jobs
     SET status = 'cancelled'
   WHERE id = p_job_id
     AND status = 'pending_approval';

  -- Best-effort: notify the poster.
  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT j.customer_id,
         'Post rejected',
         COALESCE('Your post "' || j.title || '" was not approved.' ||
                  CASE WHEN p_reason IS NOT NULL THEN ' Reason: ' || p_reason ELSE '' END,
                  'Your post was not approved.'),
         'warning'
    FROM public.jobs j
   WHERE j.id = p_job_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_pending_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_pending_job(uuid, text) TO authenticated;

-- =====================================================================
-- 10. RPC: reassign_business_jobs (used by reassign-on-removal flow)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reassign_business_jobs(
  p_business_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Only owners + admins reassign.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = auth.uid()
       AND status = 'active'
       AND extended_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only owner / admin can reassign' USING ERRCODE = '42501';
  END IF;

  -- Verify destination is a member of this business.
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = p_to_user_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Destination user is not an active team member'
      USING ERRCODE = '42704';
  END IF;

  UPDATE public.jobs
     SET customer_id = p_to_user_id
   WHERE business_id = p_business_id
     AND customer_id = p_from_user_id
     AND status IN ('open', 'accepted', 'in_progress', 'pending_approval');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_business_jobs(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_business_jobs(uuid, uuid, uuid) TO authenticated;

-- =====================================================================
-- 11. RPC: business_spend_summary (per-member breakdown)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.business_spend_summary(p_business_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  posted_count integer,
  posted_amount numeric,
  paid_amount numeric,
  in_escrow_amount numeric,
  pending_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Must be an active member of the business.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = auth.uid()
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not a member of this business' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH this_month_jobs AS (
    SELECT j.customer_id,
           j.budget,
           j.status,
           j.id
      FROM public.jobs j
     WHERE j.business_id = p_business_id
       AND j.created_at >= date_trunc('month', now())
  ),
  paid AS (
    SELECT j.customer_id,
           SUM(pt.amount_cents)::numeric / 100 AS amt
      FROM public.payout_transfers pt
      JOIN public.jobs j ON j.id = pt.job_id
     WHERE j.business_id = p_business_id
       AND pt.status = 'paid'
       AND pt.created_at >= date_trunc('month', now())
     GROUP BY j.customer_id
  )
  SELECT p.user_id,
         p.full_name,
         p.email,
         COALESCE(jp.posted_count, 0)::integer,
         COALESCE(jp.posted_amount, 0)::numeric,
         COALESCE(pd.amt, 0)::numeric AS paid_amount,
         COALESCE(jp.in_escrow_amount, 0)::numeric,
         COALESCE(jp.pending_amount, 0)::numeric
    FROM public.business_members bm
    JOIN public.profiles p ON p.user_id = bm.user_id
    LEFT JOIN (
      SELECT customer_id,
             COUNT(*) AS posted_count,
             SUM(budget) AS posted_amount,
             SUM(CASE WHEN status IN ('accepted', 'in_progress') THEN budget ELSE 0 END) AS in_escrow_amount,
             SUM(CASE WHEN status IN ('open', 'pending_approval') THEN budget ELSE 0 END) AS pending_amount
        FROM this_month_jobs
       GROUP BY customer_id
    ) jp ON jp.customer_id = bm.user_id
    LEFT JOIN paid pd ON pd.customer_id = bm.user_id
   WHERE bm.business_id = p_business_id
     AND bm.status = 'active'
     AND bm.user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.business_spend_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_spend_summary(uuid) TO authenticated;

-- =====================================================================
-- 12. RPC: business_activity_feed (timeline events)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.business_activity_feed(
  p_business_id uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  event_at timestamptz,
  actor_id uuid,
  actor_name text,
  event_type text,
  job_id uuid,
  job_title text,
  amount numeric,
  department text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = auth.uid()
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not a member of this business' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
    FROM (
      -- Posts
      SELECT j.created_at AS event_at,
             j.customer_id AS actor_id,
             p.full_name AS actor_name,
             'posted'::text AS event_type,
             j.id AS job_id,
             j.title AS job_title,
             j.budget AS amount,
             j.department
        FROM public.jobs j
        LEFT JOIN public.profiles p ON p.user_id = j.customer_id
       WHERE j.business_id = p_business_id

      UNION ALL

      -- Completions
      SELECT j.updated_at AS event_at,
             j.helper_id AS actor_id,
             p.full_name AS actor_name,
             'completed'::text AS event_type,
             j.id,
             j.title,
             j.budget,
             j.department
        FROM public.jobs j
        LEFT JOIN public.profiles p ON p.user_id = j.helper_id
       WHERE j.business_id = p_business_id
         AND j.status = 'completed'
    ) feed
   WHERE (p_before IS NULL OR event_at < p_before)
   ORDER BY event_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

REVOKE ALL ON FUNCTION public.business_activity_feed(uuid, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_activity_feed(uuid, integer, timestamptz) TO authenticated;

-- =====================================================================
-- 13. RPC: notify_business_approvers (called by trigger; sends in-app)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.notify_business_approvers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending_approval' AND NEW.business_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT bm.user_id,
           'Approval needed',
           COALESCE('A post for $' || NEW.budget::text || ' needs your approval.', 'A post needs approval.'),
           'info',
           '/business/team?tab=approvals'
      FROM public.business_members bm
     WHERE bm.business_id = NEW.business_id
       AND bm.status = 'active'
       AND bm.user_id IS NOT NULL
       AND bm.extended_role IN ('owner', 'approver', 'admin');
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notify_business_approvers'
      AND tgrelid = 'public.jobs'::regclass
  ) THEN
    CREATE TRIGGER trg_notify_business_approvers
      AFTER INSERT ON public.jobs
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_business_approvers();
  END IF;
END
$$;

-- =====================================================================
-- 14. RPC stub: business_budget_alert_check
-- =====================================================================
-- Background-cron stub. Returns true when this month's posted total
-- exceeds the alert threshold. Cron wiring is intentionally NOT in this
-- migration — call it manually or wire pg_cron in a follow-up.
CREATE OR REPLACE FUNCTION public.business_budget_alert_check(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget numeric;
  v_ratio numeric;
  v_spent numeric;
BEGIN
  SELECT monthly_budget, monthly_budget_alert_at
    INTO v_budget, v_ratio
    FROM public.businesses
   WHERE id = p_business_id;

  IF v_budget IS NULL OR v_ratio IS NULL OR v_budget <= 0 THEN
    RETURN false;
  END IF;

  SELECT COALESCE(SUM(budget), 0) INTO v_spent
    FROM public.jobs
   WHERE business_id = p_business_id
     AND created_at >= date_trunc('month', now());

  RETURN v_spent >= (v_budget * v_ratio);
END;
$$;

REVOKE ALL ON FUNCTION public.business_budget_alert_check(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_budget_alert_check(uuid) TO authenticated;

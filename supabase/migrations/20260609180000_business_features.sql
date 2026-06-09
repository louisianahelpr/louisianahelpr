-- ============================================================
-- Business Features Wave — billing mode, API keys, webhooks,
-- recurring job templates, report prefs, and W-9 records.
--
-- All DDL is guarded (`IF NOT EXISTS` / `to_regprocedure` checks)
-- so the migration is replay-safe and a from-scratch rebuild
-- stays green even if newer migrations rerun on top of it.
-- ============================================================

-- pgcrypto powers `digest()` (sha256 hashing of API keys) and
-- `gen_random_bytes()`. Supabase stages it in `extensions`.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- 1. Add billing-mode, report prefs to existing `businesses` table.
--    (Spec referred to a `business_accounts` table but the actual
--    table is named `businesses` — see 20260425233224.)
-- ============================================================
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'card'
    CHECK (billing_mode IN ('card', 'invoice'));

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS report_recipients text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS report_cadence text NOT NULL DEFAULT 'monthly'
    CHECK (report_cadence IN ('monthly', 'weekly', 'off'));

-- ============================================================
-- 2. API keys — read-only API access per business.
--    Stored as a sha256 hash; the plaintext value is only ever
--    returned to the caller once at creation time.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.business_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- sha256 hex digest of the plaintext key (lowercase, 64 chars).
  key_hash text NOT NULL,
  -- Last 4 chars of the plaintext to help owners identify which key is which.
  key_last4 text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_business_api_keys_business
  ON public.business_api_keys(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_business_api_keys_hash
  ON public.business_api_keys(key_hash);

ALTER TABLE public.business_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view API keys"
  ON public.business_api_keys;
CREATE POLICY "Business members can view API keys"
ON public.business_api_keys FOR SELECT
USING (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Business owner can create API keys"
  ON public.business_api_keys;
CREATE POLICY "Business owner can create API keys"
ON public.business_api_keys FOR INSERT
WITH CHECK (
  public.is_business_owner(business_id, auth.uid())
);

DROP POLICY IF EXISTS "Business owner can revoke API keys"
  ON public.business_api_keys;
CREATE POLICY "Business owner can revoke API keys"
ON public.business_api_keys FOR UPDATE
USING (public.is_business_owner(business_id, auth.uid()))
WITH CHECK (public.is_business_owner(business_id, auth.uid()));

-- ============================================================
-- 3. Webhooks — per-business outbound event delivery config.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.business_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}'::text[],
  active boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  last_delivery_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_webhooks_business
  ON public.business_webhooks(business_id);

ALTER TABLE public.business_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view webhooks"
  ON public.business_webhooks;
CREATE POLICY "Business members can view webhooks"
ON public.business_webhooks FOR SELECT
USING (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Business owner can manage webhooks (insert)"
  ON public.business_webhooks;
CREATE POLICY "Business owner can manage webhooks (insert)"
ON public.business_webhooks FOR INSERT
WITH CHECK (public.is_business_owner(business_id, auth.uid()));

DROP POLICY IF EXISTS "Business owner can manage webhooks (update)"
  ON public.business_webhooks;
CREATE POLICY "Business owner can manage webhooks (update)"
ON public.business_webhooks FOR UPDATE
USING (public.is_business_owner(business_id, auth.uid()))
WITH CHECK (public.is_business_owner(business_id, auth.uid()));

DROP POLICY IF EXISTS "Business owner can manage webhooks (delete)"
  ON public.business_webhooks;
CREATE POLICY "Business owner can manage webhooks (delete)"
ON public.business_webhooks FOR DELETE
USING (public.is_business_owner(business_id, auth.uid()));

-- ============================================================
-- 4. Recurring job templates — schedule-driven job creation.
--    A cron worker (TODO) reads `next_run_at` <= now() and
--    materializes jobs from `template_payload`.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.business_job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  schedule_cron text NOT NULL,
  schedule_label text,             -- human-readable "Every Monday at 9am"
  template_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_job_templates_business
  ON public.business_job_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_business_job_templates_next_run
  ON public.business_job_templates(next_run_at) WHERE active = true;

DROP TRIGGER IF EXISTS trg_business_job_templates_updated_at
  ON public.business_job_templates;
CREATE TRIGGER trg_business_job_templates_updated_at
BEFORE UPDATE ON public.business_job_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.business_job_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view templates"
  ON public.business_job_templates;
CREATE POLICY "Business members can view templates"
ON public.business_job_templates FOR SELECT
USING (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Business members can create templates"
  ON public.business_job_templates;
CREATE POLICY "Business members can create templates"
ON public.business_job_templates FOR INSERT
WITH CHECK (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
);

DROP POLICY IF EXISTS "Business members can update templates"
  ON public.business_job_templates;
CREATE POLICY "Business members can update templates"
ON public.business_job_templates FOR UPDATE
USING (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
)
WITH CHECK (
  public.is_business_member(business_id, auth.uid())
  OR public.is_business_owner(business_id, auth.uid())
);

DROP POLICY IF EXISTS "Business owner can delete templates"
  ON public.business_job_templates;
CREATE POLICY "Business owner can delete templates"
ON public.business_job_templates FOR DELETE
USING (public.is_business_owner(business_id, auth.uid()));

-- ============================================================
-- 5. Jobs: requires_w9 flag (set at post time) + W-9 records.
-- ============================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS requires_w9 boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.helper_w9_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  -- Typed e-signature (full legal name typed by the helper). Full PDF
  -- generation is a follow-up; the typed signature + IP record is the
  -- audit trail until then.
  typed_signature text NOT NULL,
  ip text,
  signed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helper_w9_records_helper
  ON public.helper_w9_records(helper_id);
CREATE INDEX IF NOT EXISTS idx_helper_w9_records_job
  ON public.helper_w9_records(job_id);
CREATE INDEX IF NOT EXISTS idx_helper_w9_records_business
  ON public.helper_w9_records(business_id);

ALTER TABLE public.helper_w9_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Helper can view own W-9 records"
  ON public.helper_w9_records;
CREATE POLICY "Helper can view own W-9 records"
ON public.helper_w9_records FOR SELECT
USING (
  helper_id = auth.uid()
  OR (
    business_id IS NOT NULL
    AND (
      public.is_business_owner(business_id, auth.uid())
      OR public.is_business_member(business_id, auth.uid())
    )
  )
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Helper can record own W-9 signature"
  ON public.helper_w9_records;
CREATE POLICY "Helper can record own W-9 signature"
ON public.helper_w9_records FOR INSERT
WITH CHECK (helper_id = auth.uid());

-- ============================================================
-- 6. RPC: generate a Helpr-prefixed random API key, hash it,
--    insert the row, and return the plaintext to the caller.
--    Only callable by the business owner.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_business_api_key(
  _business_id uuid,
  _name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plain text;
  v_hash text;
  v_last4 text;
  v_id uuid;
BEGIN
  IF NOT public.is_business_owner(_business_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only the business owner can create API keys';
  END IF;

  -- 32 random bytes → 64-char hex string, prefixed for human recognition.
  v_plain := 'helpr_live_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_plain, 'sha256'), 'hex');
  v_last4 := right(v_plain, 4);

  INSERT INTO public.business_api_keys (business_id, name, key_hash, key_last4, created_by)
  VALUES (_business_id, _name, v_hash, v_last4, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'plaintext', v_plain,
    'last4', v_last4
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_business_api_key(uuid, text) TO authenticated;

-- ============================================================
-- 7. Admin RPC: list business accounts with team rosters + GMV.
--    Used by the new AdminBusinessAccounts view.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_business_accounts()
RETURNS TABLE (
  business_id uuid,
  business_name text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  seat_tier text,
  billing_mode text,
  verification_status text,
  member_count integer,
  total_gmv_cents bigint,
  last_activity_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.owner_id,
    p.full_name,
    u.email,
    b.seat_tier,
    b.billing_mode,
    b.verification_status,
    (
      SELECT count(*)::int FROM public.business_members bm
      WHERE bm.business_id = b.id AND bm.status IN ('active', 'pending')
    ),
    COALESCE((
      SELECT sum(j.budget)::bigint FROM public.jobs j
      WHERE j.business_id = b.id
        AND j.payment_status IN ('escrow', 'payout_pending', 'released')
        AND j.status <> 'cancelled'
    ), 0),
    (
      SELECT max(j.updated_at) FROM public.jobs j
      WHERE j.business_id = b.id
    ),
    b.created_at
  FROM public.businesses b
  LEFT JOIN public.profiles p ON p.user_id = b.owner_id
  LEFT JOIN auth.users u ON u.id = b.owner_id
  ORDER BY b.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_business_accounts() TO authenticated;

-- Admin RPC: list active + pending members for a single business.
CREATE OR REPLACE FUNCTION public.admin_list_business_members(_business_id uuid)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  joined_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  RETURN QUERY
  SELECT
    bm.id,
    bm.user_id,
    p.full_name,
    COALESCE(u.email, bm.invited_email),
    bm.role::text,
    bm.status::text,
    bm.joined_at
  FROM public.business_members bm
  LEFT JOIN public.profiles p ON p.user_id = bm.user_id
  LEFT JOIN auth.users u ON u.id = bm.user_id
  WHERE bm.business_id = _business_id
    AND bm.status IN ('active', 'pending')
  ORDER BY bm.invited_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_business_members(uuid) TO authenticated;

-- Fix: admin_list_business_accounts() raised Postgres 42804
-- ("structure of query does not match function result type") and the
-- Admin ▸ Business Accounts view failed to load.
--
-- Cause: the function declares `owner_email text` but selected `u.email`
-- raw. `auth.users.email` is `varchar(255)`, which does not match the
-- declared `text` column, so the RETURN QUERY aborts. (The sibling
-- admin_list_business_members dodged this via COALESCE(u.email, ...).)
--
-- Fix: CREATE OR REPLACE with `u.email::text`. We do NOT edit the deployed
-- 20260609180000_business_features.sql (replay-safety + auto-deploy). This
-- migration is idempotent — CREATE OR REPLACE with an identical body except
-- the cast — and guarded so a from-scratch rebuild (which runs the original
-- definition first) simply swaps in the corrected one.
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
    u.email::text,
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

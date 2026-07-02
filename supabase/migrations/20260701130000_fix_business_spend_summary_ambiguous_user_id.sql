-- Fix: business_spend_summary raised `42702 column reference "user_id" is
-- ambiguous` for EVERY call, blanking the /business/team Spend tab in
-- production. The function's RETURNS TABLE declares an OUT column `user_id`,
-- which becomes an in-scope PL/pgSQL variable for the whole body. The
-- membership-check EXISTS subquery referenced a BARE `user_id`
-- (`... AND user_id = auth.uid() ...`), which Postgres could not resolve to
-- either the OUT variable or the business_members column — and because that
-- ambiguity is caught at plan time, the function failed even for the owner
-- (whose branch would short-circuit at runtime).
--
-- Fix: qualify the reference as `business_members.user_id`. Recreated in full
-- so the repo definition is authoritative and matches prod (resolving prior
-- drift). Replay-safe via CREATE OR REPLACE.

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
  -- Must be the owner or an active member of the business.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND business_members.user_id = auth.uid()
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not a member of this business' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH this_month_jobs AS (
    SELECT j.customer_id,
           j.budget,
           j.status::text AS status,
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

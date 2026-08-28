-- Remove the last of the business-seats backend.
--
-- Commits 31008e1d8 / 71ca213c7 removed most of it (4 deployed edge functions,
-- 15 functions, 3 tables). What was left could not go with them because it is
-- entangled with core job permissions: `businesses` / `business_members`, the
-- five `is_business_*` / seat-limit helpers, a trigger on `jobs`, and — the
-- risky part — live RLS policies on `jobs` and `helper_w9_records` plus the
-- `prevent_job_field_escalation` trigger, all of which call those helpers.
--
-- WHY THE NARROWING IS SAFE (measured against prod before writing this):
--
--   jobs.business_id IS NOT NULL           -> 0 rows
--   helper_w9_records.business_id NOT NULL -> 0 rows
--   businesses                             -> 4 rows, ALL test/seed
--     (2 mailinator audit testers, business@helpr.test, and one seed-id row
--      owned by the app owner). None carries a seat subscription.
--   business_members                       -> 6 rows: the four owner rows
--     above plus demo1@helpr.test and a crew-lead@mailinator.com invite.
--
-- Every business branch on a `jobs` / `helper_w9_records` policy is an OR arm
-- gated on `business_id IS NOT NULL`. With zero such rows platform-wide those
-- arms grant exactly zero rows to anybody, so dropping them removes no access
-- that exists. Verified per-user (the owner, a seed business member, and an
-- unrelated helper): identical visible/updatable row sets before and after.
--
-- Two steps below move in a direction that needs stating out loud, and each
-- says so at its own site: step 2 rewrites rather than drops, because dropping
-- an AND arm widens; step 4 is the single genuine loss of access.
--
-- REPLAY-SAFETY: every drop is IF EXISTS, the two CREATEs replace objects whose
-- tables are created by earlier migrations, and the data touch-up in step 7 is
-- guarded on the column existing.

-- ---------------------------------------------------------------------------
-- 1. jobs — drop the two business-only policies.
--
-- Both are pure OR arms: a user's own jobs stay reachable through "Users can
-- view their own jobs" (SELECT) and "Customers can update their own jobs" /
-- "Helpers can update their assigned jobs" (UPDATE), none of which is touched.
-- NARROWING, by exactly the zero rows these matched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Business members can view team jobs"   ON public.jobs;
DROP POLICY IF EXISTS "Business members can update team jobs" ON public.jobs;

-- ---------------------------------------------------------------------------
-- 2. jobs INSERT — rewrite, do NOT drop.
--
-- The old WITH CHECK ANDed in:
--     (business_id IS NULL OR EXISTS (verified business + active member))
-- Removing an AND arm WIDENS, which is the direction that must never happen by
-- accident: with `businesses` gone, `jobs.business_id` becomes an unbacked
-- column and an unguarded policy would let any client stamp an arbitrary uuid
-- into it. So the arm is replaced by `business_id IS NULL` — exactly what the
-- old expression evaluates to once no business row can exist, and strictly no
-- wider than today. The identity and customer_id arms are carried over
-- unchanged.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;
CREATE POLICY "Customers can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = customer_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.idv_status = 'verified'
    )
    AND business_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- 3. helper_w9_records SELECT — drop the business OR arm.
--
-- Was: helper_id = uid
--      OR (business_id IS NOT NULL AND (is_business_owner OR is_business_member))
--      OR admin
-- The middle arm matched 0 rows (no W-9 record carries a business_id). The
-- helper's own records and the admin arm are preserved verbatim.
-- NARROWING by zero.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Helper can view own W-9 records" ON public.helper_w9_records;
CREATE POLICY "Helper can view own W-9 records"
  ON public.helper_w9_records FOR SELECT
  USING (
    helper_id = (SELECT auth.uid())
    OR has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 4. favorite_helpers — drop the team-favorites policy.
--
-- THE ONE REAL NARROWING IN THIS MIGRATION, stated plainly: this OR arm today
-- grants SELECT on 1 row (a seed favorite on the owner's seed business) to
-- that business's other active member. The row's own customer keeps it via
-- "Users can manage their favorites"; the favorited helper keeps it via
-- "Helpers can see who favorited them". Only a co-member's view of someone
-- else's favorite goes away — the correct semantics once shared business
-- accounts no longer exist, and it cannot be preserved anyway: the policy
-- subqueries `business_members`, which this migration drops.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Team members can see team favorites" ON public.favorite_helpers;

-- ---------------------------------------------------------------------------
-- 5. prevent_job_field_escalation — rewrite before its helper can be dropped.
--
-- Only the `is_business_member` lookup changes: with no business_members
-- table, `v_is_member` is unconditionally false, so it and its branch are
-- gone. Everything else — the service_role / trusted-ladder / admin bypasses,
-- the Tier-1 locked_everyone list, the poster+helper hand-off to the sibling
-- column-lock triggers, the deny-lists and the assign-only-to-self rule — is
-- carried over unchanged.
--
-- This trigger only ever ADDS restrictions, so losing the member branch cannot
-- widen anyone's write surface: a would-be member now falls into the early
-- return where RLS decides, and after step 1 no policy grants them UPDATE on
-- the row at all.
-- ---------------------------------------------------------------------------
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
$function$;

-- ---------------------------------------------------------------------------
-- 6. The trigger on `jobs`, and the two approval RPCs.
--
-- notify_business_approvers fires on every jobs write but does nothing unless
-- `status = 'pending_approval' AND business_id IS NOT NULL`. Its only side
-- effect is INSERTing a notification pointing at /business/team, a route that
-- no longer exists; nothing reads what it wrote. With business_id always NULL
-- it is dead code sitting on the hot path of every job write.
--
-- approve_pending_job / reject_pending_job moved a job out of
-- 'pending_approval'. Both begin by requiring a non-null jobs.business_id and
-- raise 'Job not found' otherwise, so they are already unreachable. No src/
-- call site exists (only a stale comment in useApplyFlow.ts names one).
--
-- The `pending_approval` job_status enum value is deliberately KEPT: two seed
-- jobs still sit in that state and its labels live in files owned by another
-- in-flight change. It is inert, not load-bearing.
-- ---------------------------------------------------------------------------
DROP TRIGGER  IF EXISTS trg_notify_business_approvers ON public.jobs;
DROP FUNCTION IF EXISTS public.notify_business_approvers();
DROP FUNCTION IF EXISTS public.approve_pending_job(uuid);
DROP FUNCTION IF EXISTS public.reject_pending_job(uuid, text);

-- ---------------------------------------------------------------------------
-- 7. Detach the foreign keys, then drop the tables.
--
-- The four `business_id` / `business_account_id` columns are KEPT. They are
-- 100% NULL (bar the one favorite noted in step 4, cleared here) and they are
-- read by code outside this change's scope — AdminExport's job export,
-- charge-recurring-visits, the post-job helpers, the activity lane. Turning
-- them into plain unbacked uuid columns is the smallest safe move; dropping
-- them is a separate change with its own blast radius.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'favorite_helpers'
       AND column_name  = 'business_account_id'
  ) THEN
    UPDATE public.favorite_helpers
       SET business_account_id = NULL
     WHERE business_account_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.jobs              DROP CONSTRAINT IF EXISTS jobs_business_id_fkey;
ALTER TABLE public.helper_w9_records DROP CONSTRAINT IF EXISTS helper_w9_records_business_id_fkey;
ALTER TABLE public.favorite_helpers  DROP CONSTRAINT IF EXISTS favorite_helpers_business_account_id_fkey;

-- CASCADE carries the tables' own policies and triggers with them
-- (trg_add_owner_as_member, trg_enforce_business_seat_limit,
-- trg_enforce_business_member_limit, trg_enforce_business_seat_billing_immutable,
-- trg_enforce_business_verification_safety, trg_businesses_updated_at).
DROP TABLE IF EXISTS public.business_members CASCADE;
DROP TABLE IF EXISTS public.businesses       CASCADE;

-- ---------------------------------------------------------------------------
-- 8. The helper functions — last, now that nothing references them.
--
-- Ordered dependents-first: the seat-limit triggers call
-- get_business_seat_limit, which calls business_seat_limit_for_tier.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enforce_business_seat_limit();
DROP FUNCTION IF EXISTS public.enforce_business_member_limit();
DROP FUNCTION IF EXISTS public.enforce_business_seat_billing_immutable();
DROP FUNCTION IF EXISTS public.enforce_business_verification_safety();
DROP FUNCTION IF EXISTS public.add_owner_as_member();
DROP FUNCTION IF EXISTS public.get_business_seat_limit(uuid);
DROP FUNCTION IF EXISTS public.business_seat_limit_for_tier(text);
DROP FUNCTION IF EXISTS public.is_business_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_business_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_business_owner(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 9. Enum types — used by no column outside business_members (verified against
-- pg_attribute before writing this).
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS public.business_member_role;
DROP TYPE IF EXISTS public.business_member_status;

-- ---------------------------------------------------------------------------
-- 10. Storage policies on the `business-documents` bucket. They subquery
-- `businesses`, so leaving them would point every access at a missing relation
-- and raise rather than simply deny. Dropping them leaves the bucket with no
-- policy — closed to every client, the intended end state for a product that
-- no longer exists.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Business owners read own business documents"   ON storage.objects;
DROP POLICY IF EXISTS "Business owners upload own business documents" ON storage.objects;
DROP POLICY IF EXISTS "Business owners update own business documents" ON storage.objects;
DROP POLICY IF EXISTS "Business owners delete own business documents" ON storage.objects;

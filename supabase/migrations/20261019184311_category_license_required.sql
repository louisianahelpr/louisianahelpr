-- License-required job categories (owner decision 2026-10-19 ~18:50Z, relayed
-- by the lead): on locksmith, mobile_vet, hair_stylist, massage and
-- mobile_bartending a Helpr must hold a VERIFIED license that covers THAT
-- category before they can apply, quote, or be offered / hired. A poster can
-- always post in any category. Enforced here, server-side; the UI only
-- explains it. The enum values come from 20261019184157 (its own transaction:
-- a value added in a transaction cannot be used in it), and everything below
-- compares categories as ::text so a replay on an older schema stays valid.
--
-- SAME MECHANISM as the Licensed & Insured badge (Jobs settings), extended,
-- not a second system:
--   * the Helpr's one license document stays profiles.license_url, reviewed by
--     an admin through get_pending_credentials() / review_credential() exactly
--     as today;
--   * NEW profiles.license_categories: the licensed categories the Helpr says
--     that document covers. It is part of the reviewed claim, like
--     business_name: changing it while the license is verified sends the
--     license back to 'pending' (auto_pending_credentials, below), so a
--     verified plumber cannot add "massage" without an admin looking again;
--   * a category license = profiles license verified + unexpired + the
--     category in license_categories, OR a vendor-verified helper_credentials
--     trade_license row whose trade_category is the category.
--
-- Gates (each refuses with 42501 'category_license_required'; the service role
-- and cron pass, as in every gate here):
--   1. applications BEFORE INSERT  (enforce_application_credential_tier,
--      restated from 20260915101102 with the category check added): apply_to_job
--      and every other path that writes an application.
--   2. job_quotes BEFORE INSERT    (new): submit_job_quote on a quote request in
--      a license-required category.
--   3. jobs BEFORE INSERT/UPDATE of helper_id, offered_to_helper_id, category
--      (new): a direct offer, a booked quote, a hire, or a category switch can
--      never put an unlicensed Helpr on a license-required job.
--
-- Also: get_pending_credentials() gains license_categories so the admin sees
-- which categories the document must cover (return type changes, so it is
-- dropped and re-created with its grants restated).
--
-- Sales tax for the new categories (same release): tire_service and
-- dent_windshield are repairs of a vehicle (tangible personal property), the
-- rule auto_repair is already taxed under, so they are taxed like it. Every
-- other new category stays untaxed until the owner rules (docs/OPEN.md,
-- categories tax owner question): the rule does not settle them.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS
-- before CREATE, grants restated.

-- ---------------------------------------------------------------------------
-- 0. The claim column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS license_categories public.job_category[] NOT NULL DEFAULT '{}';

-- The Helpr writes their own claim (Jobs settings, Licensed & Insured).
-- sync_profiles_update_grants() would grant it within 10 minutes anyway (every
-- column not in profiles_locked_update_columns()); granted here so it works
-- the moment this deploys.
GRANT UPDATE (license_categories) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.license_categories IS
  'License-required job categories the Helpr says their license document (license_url) covers. Part of the reviewed claim: changing it re-enters admin review (auto_pending_credentials). Read by helper_holds_category_license().';

-- ---------------------------------------------------------------------------
-- 1. The set, and who holds a license for it
CREATE OR REPLACE FUNCTION public.category_requires_license(p_category public.job_category)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(p_category::text = ANY (ARRAY['locksmith', 'mobile_vet', 'hair_stylist', 'massage', 'mobile_bartending']), false);
$fn$;

COMMENT ON FUNCTION public.category_requires_license(public.job_category) IS
'True for the job categories where a Helpr needs a verified license covering the category to apply, quote or be hired (owner 2026-10-19). Mirrors src/lib/jobCategories.ts LICENSE_REQUIRED_CATEGORIES (categoryLicenseParity.test.ts).';

REVOKE ALL ON FUNCTION public.category_requires_license(public.job_category) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.category_requires_license(public.job_category) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helper_holds_category_license(p_user uuid, p_category public.job_category)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
  SELECT p_user IS NOT NULL AND p_category IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = p_user
         AND p.license_status = 'verified'
         -- A NULL expiry earns nothing (as get_user_credential_tier).
         AND p.license_expires_at IS NOT NULL
         AND p.license_expires_at > current_date
         AND p_category = ANY (p.license_categories)
    )
    OR EXISTS (
      SELECT 1 FROM public.helper_credentials hc
       WHERE hc.user_id = p_user
         AND hc.credential_type = 'trade_license'
         AND hc.status = 'verified'
         AND hc.trade_category = p_category::text
         AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
    )
  );
$fn$;

-- Only the gates below call it (no client needs another member's answer; a
-- member reads their own license_* columns from their own profile row).
REVOKE ALL ON FUNCTION public.helper_holds_category_license(uuid, public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_holds_category_license(uuid, public.job_category) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Gate 1: applications (restated from 20260915101102; the tier check is
--    unchanged, the category check is new and runs first)
CREATE OR REPLACE FUNCTION public.enforce_application_credential_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_required int;
  v_actual int;
  v_category public.job_category;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;  -- service-role writers (recurring visits, admin tooling); never anon
  END IF;

  SELECT COALESCE(j.credential_tier, 0), j.category INTO v_required, v_category
    FROM public.jobs j WHERE j.id = NEW.job_id;

  -- License-required category (owner 2026-10-19): a license that covers it.
  IF public.category_requires_license(v_category)
     AND NOT public.helper_holds_category_license(NEW.helper_id, v_category) THEN
    RAISE EXCEPTION 'category_license_required'
      USING ERRCODE = '42501',
            HINT = 'This job needs a verified license for this category. Add it in Jobs settings, under Licensed & Insured.';
  END IF;

  IF v_required > 0 THEN
    v_actual := COALESCE(public.get_user_credential_tier(NEW.helper_id), 0);
    IF v_actual < v_required THEN
      RAISE EXCEPTION 'credential_tier_required'
        USING ERRCODE = '42501',
              HINT = CASE WHEN v_required >= 2
                          THEN 'This job requires a verified license and insurance.'
                          ELSE 'This job requires a verified license.' END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_application_credential_tier() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. Gate 2: quotes
CREATE OR REPLACE FUNCTION public.enforce_quote_category_license()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_category public.job_category;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  SELECT r.category INTO v_category FROM public.job_quote_requests r WHERE r.id = NEW.request_id;
  IF public.category_requires_license(v_category)
     AND NOT public.helper_holds_category_license(NEW.quoter_id, v_category) THEN
    RAISE EXCEPTION 'category_license_required'
      USING ERRCODE = '42501',
            HINT = 'This job needs a verified license for this category. Add it in Jobs settings, under Licensed & Insured.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_quote_category_license() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.job_quotes') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_quote_category_license ON public.job_quotes;
    CREATE TRIGGER trg_quote_category_license
      BEFORE INSERT ON public.job_quotes
      FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_category_license();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4. Gate 3: offers, hires and category switches on the job itself
CREATE OR REPLACE FUNCTION public.enforce_job_category_license()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cat_changed boolean;
BEGIN
  IF public.is_server_context() OR NOT public.category_requires_license(NEW.category) THEN
    RETURN NEW;
  END IF;
  v_cat_changed := TG_OP = 'INSERT' OR NEW.category IS DISTINCT FROM OLD.category;

  IF NEW.helper_id IS NOT NULL
     AND (v_cat_changed OR NEW.helper_id IS DISTINCT FROM OLD.helper_id)
     AND NOT public.helper_holds_category_license(NEW.helper_id, NEW.category) THEN
    RAISE EXCEPTION 'category_license_required'
      USING ERRCODE = '42501',
            HINT = 'This job needs a Helpr with a verified license for this category.';
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND (v_cat_changed OR NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id)
     AND NOT public.helper_holds_category_license(NEW.offered_to_helper_id, NEW.category) THEN
    RAISE EXCEPTION 'category_license_required'
      USING ERRCODE = '42501',
            HINT = 'This job needs a Helpr with a verified license for this category.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_job_category_license() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_category_license ON public.jobs;
CREATE TRIGGER trg_job_category_license
  BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id, category ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_category_license();

-- ---------------------------------------------------------------------------
-- 5. The claim is reviewed: auto_pending_credentials restated from
--    20260923110759 with one addition (license_categories, after business_name)
CREATE OR REPLACE FUNCTION public.auto_pending_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin_writer boolean := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'));
BEGIN
  -- License document changed (and user is not admin doing the change)
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    -- Q120: blank / whitespace-only is absent.
    IF coalesce(NEW.license_url, '') !~ '[^[:space:]]' THEN
      NEW.license_url := NULL;
    END IF;
    IF NEW.license_url IS NOT DISTINCT FROM OLD.license_url THEN
      NULL;
    ELSIF NEW.license_url IS NOT NULL THEN
      -- Q127: only the member's own uploaded document.
      IF NOT public.credential_document_path_ok(NEW.user_id, 'license', NEW.license_url) THEN
        RAISE EXCEPTION 'license_url must be a document you uploaded (<your id>/credentials/license-<time>.pdf|png|jpg|jpeg|webp|heic)'
          USING ERRCODE = '22023';
      END IF;
      NEW.is_licensed := true;
      IF NOT is_admin_writer THEN
        NEW.license_status := 'pending';
        NEW.license_reviewed_at := NULL;
        NEW.license_reviewed_by := NULL;
        NEW.license_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.license_status := 'none';
      NEW.is_licensed := false;
    END IF;
  END IF;

  -- Insurance document changed
  IF NEW.insurance_url IS DISTINCT FROM OLD.insurance_url THEN
    -- Q120: blank / whitespace-only is absent.
    IF coalesce(NEW.insurance_url, '') !~ '[^[:space:]]' THEN
      NEW.insurance_url := NULL;
    END IF;
    IF NEW.insurance_url IS NOT DISTINCT FROM OLD.insurance_url THEN
      NULL;
    ELSIF NEW.insurance_url IS NOT NULL THEN
      -- Q127: only the member's own uploaded document.
      IF NOT public.credential_document_path_ok(NEW.user_id, 'insurance', NEW.insurance_url) THEN
        RAISE EXCEPTION 'insurance_url must be a document you uploaded (<your id>/credentials/insurance-<time>.pdf|png|jpg|jpeg|webp|heic)'
          USING ERRCODE = '22023';
      END IF;
      NEW.is_insured := true;
      IF NOT is_admin_writer THEN
        NEW.insurance_status := 'pending';
        NEW.insurance_reviewed_at := NULL;
        NEW.insurance_reviewed_by := NULL;
        NEW.insurance_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.insurance_status := 'none';
      NEW.is_insured := false;
    END IF;
  END IF;

  -- The business name is part of the verified claim: the admin approved a
  -- document issued to THAT name. Renaming a live badge therefore re-enters
  -- review, the same way swapping the document does. Only 'verified' is
  -- affected — editing the name while 'none'/'pending'/'rejected' costs
  -- nothing, so there is nothing to protect and no reason to nag.
  IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN
    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
    IF OLD.insurance_status = 'verified' AND NEW.insurance_status = 'verified' THEN
      NEW.insurance_status := 'pending';
      NEW.insurance_reviewed_at := NULL;
      NEW.insurance_reviewed_by := NULL;
      NEW.insurance_rejection_reason := NULL;
    END IF;
  END IF;

  -- The licensed categories are part of the verified claim too (2026-10-19):
  -- the admin approved the document for THOSE categories. Changing them on a
  -- verified license re-enters review, so no category is ever licensed without
  -- an admin having looked at it.
  IF NEW.license_categories IS DISTINCT FROM OLD.license_categories AND NOT is_admin_writer THEN
    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.auto_pending_credentials() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The admin queue shows the claimed categories (restated from
--    20260923101130 with license_categories added; return type changes, so
--    drop and re-create, grants restated)
DROP FUNCTION IF EXISTS public.get_pending_credentials();
CREATE FUNCTION public.get_pending_credentials()
RETURNS TABLE(
  user_id uuid, full_name text, email text, avatar_url text,
  license_url text, insurance_url text, license_status text, insurance_status text,
  is_licensed boolean, is_insured boolean, business_name text, submitted_at timestamptz,
  license_categories text[]
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH hc AS (
    -- Only the two types this queue can decide, only while awaiting a human,
    -- and only with a document to decide on (Q102).
    SELECT
      c.user_id,
      MAX(c.document_url) FILTER (WHERE c.credential_type = 'trade_license') AS license_url,
      MAX(c.document_url) FILTER (WHERE c.credential_type = 'insurance')     AS insurance_url,
      MIN(c.created_at)                                                      AS submitted_at
    FROM public.helper_credentials c
    WHERE c.credential_type IN ('trade_license', 'insurance')
      AND c.status IN ('unverified', 'submitted')
      AND nullif(btrim(c.document_url), '') IS NOT NULL
    GROUP BY c.user_id
  ), q AS (
    SELECT
      p.*,
      hc.submitted_at AS hc_submitted_at,
      -- The document the admin sees is the pending store's own.
      CASE WHEN hc.license_url IS NOT NULL THEN hc.license_url
           WHEN p.license_status = 'pending' THEN nullif(btrim(p.license_url), '') END     AS q_license_url,
      CASE WHEN hc.insurance_url IS NOT NULL THEN hc.insurance_url
           WHEN p.insurance_status = 'pending' THEN nullif(btrim(p.insurance_url), '') END AS q_insurance_url
    FROM public.profiles p
    LEFT JOIN hc ON hc.user_id = p.user_id
  )
  SELECT
    q.user_id,
    q.full_name,
    q.email,
    q.avatar_url,
    COALESCE(q.q_license_url, q.license_url)     AS license_url,
    COALESCE(q.q_insurance_url, q.insurance_url) AS insurance_url,
    -- 'pending' only when there is a document to decide (Q102).
    CASE WHEN q.q_license_url IS NOT NULL THEN 'pending'
         WHEN q.license_status = 'pending' THEN 'none'
         ELSE q.license_status END                AS license_status,
    CASE WHEN q.q_insurance_url IS NOT NULL THEN 'pending'
         WHEN q.insurance_status = 'pending' THEN 'none'
         ELSE q.insurance_status END              AS insurance_status,
    q.is_licensed OR q.q_license_url IS NOT NULL  AS is_licensed,
    q.is_insured  OR q.q_insurance_url IS NOT NULL AS is_insured,
    q.business_name,
    LEAST(q.updated_at, COALESCE(q.hc_submitted_at, q.updated_at)) AS submitted_at,
    q.license_categories::text[]                  AS license_categories
  FROM q
  WHERE has_role(auth.uid(), 'admin')
    AND (q.q_license_url IS NOT NULL OR q.q_insurance_url IS NOT NULL)
  ORDER BY submitted_at ASC;
$fn$;

REVOKE ALL ON FUNCTION public.get_pending_credentials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Sales tax: the new categories that follow an existing rule (restated from
--    20261017055441 with two categories added; ::text compare kept)
CREATE OR REPLACE FUNCTION public.enforce_funded_category_tax_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  taxable CONSTANT text[] := ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing', 'tire_service', 'dent_windshield'];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;
  IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;
  IF (OLD.payment_status IS DISTINCT FROM 'unpaid' OR OLD.stripe_session_id IS NOT NULL)
     AND (COALESCE(OLD.category::text, '') = ANY (taxable)) IS DISTINCT FROM (COALESCE(NEW.category::text, '') = ANY (taxable)) THEN
    RAISE EXCEPTION 'A paid job cannot switch between taxed and untaxed categories'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_funded_category_tax_class() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_category_taxable(_category public.job_category)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(_category::text = ANY (ARRAY['assembly', 'handyman', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing', 'tire_service', 'dent_windshield']), false);
$$;

COMMENT ON FUNCTION public.is_category_taxable(public.job_category) IS
'True exactly for the categories whose labor line is charged LA sales tax: supabase/functions/_shared/salesTax.ts TAXABLE_CATEGORIES (assembly, handyman, the twelve trades, owner 2026-10-17, and tire_service and dent_windshield, 2026-10-19). Read by get_helper_earnings_export''s tax_status column.';

REVOKE ALL ON FUNCTION public.is_category_taxable(public.job_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_category_taxable(public.job_category) TO service_role;

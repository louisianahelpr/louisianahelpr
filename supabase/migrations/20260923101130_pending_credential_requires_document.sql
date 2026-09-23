-- Q102 (docs/OPEN.md): the admin credential queue could list a row with no
-- Approve or Reject.
--
-- Layers, read LIVE on 2026-09-23 (prod fncmgoasalhdgfwzhsqa):
--   * RLS "Users can insert own credentials": WITH CHECK auth.uid() = user_id
--     only; nothing about document_url.
--   * trigger enforce_credential_status_server_owned (BEFORE INSERT/UPDATE):
--     a member INSERT is forced to status 'submitted'; nothing requires a
--     document either.
--   * constraints: only credential_type / status enums; document_url nullable.
--   * get_pending_credentials(): lists every trade_license / insurance row in
--     'unverified'/'submitted', document or not.
--   * AdminCredentialQueue.tsx: renders a credential's box (and so its
--     Approve / Reject) only when license_status = 'pending' AND license_url
--     (same for insurance). A document-less pending row therefore listed a
--     person with nothing to act on.
--
-- Fix, at two layers:
--   1. CHECK: a trade_license / insurance row awaiting review (unverified /
--      submitted) must carry a non-blank document_url. Scoped to the two types
--      this queue decides: a paid background_check is inserted 'submitted' with
--      no document by stripe-webhook (checkoutSessionCompleted.ts) and is
--      legitimately document-less; identity / bond are not in this queue.
--      Violators on prod when written: 0 (of 3 rows). Added VALIDATED, never
--      NOT VALID (scripts/check-unvalidated-constraints.mjs fails deploys on
--      NOT VALID). If a violator appeared before deploy, this migration
--      refuses loudly rather than rewriting a member's row.
--   2. get_pending_credentials(): a credential is listed as pending only when
--      it has a document (either store), and a person is listed only when at
--      least one of their credentials is actionable. So the queue can never
--      show an actionless row, even from the profiles mirror.

DO $$
DECLARE
  v_bad int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.helper_credentials'::regclass
       AND conname = 'helper_credentials_pending_review_needs_document'
  ) THEN
    SELECT count(*) INTO v_bad
      FROM public.helper_credentials
     WHERE credential_type IN ('trade_license', 'insurance')
       AND status IN ('unverified', 'submitted')
       AND nullif(btrim(document_url), '') IS NULL;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Q102: % helper_credentials row(s) await review with no document; resolve them before adding helper_credentials_pending_review_needs_document', v_bad;
    END IF;

    ALTER TABLE public.helper_credentials
      ADD CONSTRAINT helper_credentials_pending_review_needs_document
      CHECK (
        credential_type NOT IN ('trade_license', 'insurance')
        OR status NOT IN ('unverified', 'submitted')
        OR nullif(btrim(document_url), '') IS NOT NULL
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_pending_credentials()
RETURNS TABLE(
  user_id uuid, full_name text, email text, avatar_url text,
  license_url text, insurance_url text, license_status text, insurance_status text,
  is_licensed boolean, is_insured boolean, business_name text, submitted_at timestamptz
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
    LEAST(q.updated_at, COALESCE(q.hc_submitted_at, q.updated_at)) AS submitted_at
  FROM q
  WHERE has_role(auth.uid(), 'admin')
    AND (q.q_license_url IS NOT NULL OR q.q_insurance_url IS NOT NULL)
  ORDER BY submitted_at ASC;
$fn$;

REVOKE ALL ON FUNCTION public.get_pending_credentials() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated, service_role;

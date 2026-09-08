-- Two defects in the credential-review path, both found by re-reading the LIVE
-- function definitions rather than the migration history.
--
-- 1. review_credential() rejecting a document set `*_status = 'rejected'` and
--    left `is_licensed` / `is_insured` TRUE. auto_pending_credentials() sets
--    those booleans on URL presence and only clears them when the URL is
--    cleared, so a rejection left the declaration standing. Prod today has one
--    such row (`is_licensed` true, status not 'verified').
--
--    Blast radius is narrower than it looks, and worth writing down so nobody
--    re-files it as a badge leak: every consumer already pairs the boolean with
--    `status = 'verified'` — CredentialBadge.tsx:43, get_safe_profiles (the
--    `is_licensed AND license_status = 'verified'` arm), useApplicantComparison
--    .ts:97. No public "Insured" badge was ever shown for a rejected COI. What
--    it did break is the helper's own CredentialsTab toggle, which reads the
--    bare boolean, so "I Am Licensed" stayed switched on after a rejection —
--    and it left a column whose name promises a fact it does not hold, which is
--    a trap for the next reader who trusts it alone.
--
-- 2. get_pending_credentials() read `profiles` and nothing else, so a
--    credential landing in `helper_credentials` — the vendor-verified store —
--    was invisible to the review queue forever. Zero rows there today, so this
--    is a structural gap rather than a live outage, which is exactly why it
--    could sit unnoticed until the first vendor submission.
--
--    The queue and review_credential() both speak only 'license' and
--    'insurance', so this unifies the two types that map cleanly:
--    `trade_license` and `insurance`. `identity` has its own IDV queue,
--    `background_check` has a vendor path, and `bond` has NO reviewer anywhere
--    in the app — that last one is a real gap, reported rather than papered
--    over here, because inventing a reviewer for it blind (the table holds no
--    rows to validate against) is how a queue ends up accepting decisions it
--    cannot apply.
--
-- Replay-safe: both objects are unconditional CREATE OR REPLACE with unchanged
-- signatures, so re-applying is a no-op.

-- ── 1. review_credential: clear the declaration boolean on rejection, and keep
--       helper_credentials from diverging from profiles. ────────────────────
CREATE OR REPLACE FUNCTION public.review_credential(
  _user_id uuid,
  _credential text,
  _decision text,
  _reason text DEFAULT NULL::text,
  _expires date DEFAULT NULL::date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_rows int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may review credentials';
  END IF;
  IF _credential NOT IN ('license','insurance') THEN
    RAISE EXCEPTION 'Invalid credential type';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  -- The invariant that lets get_user_credential_tier() fail closed on a NULL
  -- expiry without ever stranding an approved helper: you cannot approve
  -- without recording when it lapses. The date is printed on the document the
  -- admin is already looking at.
  IF _decision = 'verified' AND _expires IS NULL THEN
    RAISE EXCEPTION 'An expiry date is required to verify a credential';
  END IF;
  IF _decision = 'verified' AND _expires <= current_date THEN
    RAISE EXCEPTION 'That credential already expired on %', _expires;
  END IF;

  IF _credential = 'license' THEN
    UPDATE public.profiles
       SET license_status = _decision,
           -- A rejected document is not a held licence. Leaving this TRUE is
           -- what made the column unsafe to read on its own.
           is_licensed = (_decision = 'verified'),
           license_reviewed_at = now(),
           license_reviewed_by = auth.uid(),
           license_expires_at = CASE WHEN _decision = 'verified' THEN _expires ELSE NULL END,
           license_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    UPDATE public.profiles
       SET insurance_status = _decision,
           is_insured = (_decision = 'verified'),
           insurance_reviewed_at = now(),
           insurance_reviewed_by = auth.uid(),
           insurance_expires_at = CASE WHEN _decision = 'verified' THEN _expires ELSE NULL END,
           insurance_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END IF;

  -- A profile UPDATE matching zero rows returns no error (CLAUDE.md, "A null
  -- `error` does NOT mean the write happened"). Raise BEFORE the notification
  -- and the audit row, so a decision that changed nothing cannot produce a
  -- success toast, an email to the helper, and an audit entry claiming it
  -- happened. The original wrote all three unconditionally.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'No profile found for user %', _user_id;
  END IF;

  -- Mirror the decision onto helper_credentials when a row exists. Without
  -- this, surfacing that store in the queue below would let an admin decide a
  -- credential and change nothing in the table it came from — a zero-row write
  -- dressed as a decision. No-op when the helper has no such row.
  UPDATE public.helper_credentials
     SET status = _decision,
         verified_at = CASE WHEN _decision = 'verified' THEN now() ELSE NULL END,
         expiration_date = CASE WHEN _decision = 'verified' THEN _expires ELSE expiration_date END,
         rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END,
         updated_at = now()
   WHERE user_id = _user_id
     AND credential_type = CASE WHEN _credential = 'license' THEN 'trade_license' ELSE 'insurance' END
     AND status IN ('unverified', 'submitted');

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    _user_id,
    CASE WHEN _credential = 'license'
      THEN CASE WHEN _decision = 'verified' THEN 'License verified' ELSE 'License needs attention' END
      ELSE CASE WHEN _decision = 'verified' THEN 'Insurance verified' ELSE 'Insurance needs attention' END
    END,
    CASE WHEN _decision = 'verified' THEN
      CASE WHEN _credential = 'license'
        THEN 'Your professional license has been verified. The Licensed badge is live on your profile until ' || to_char(_expires, 'FMMonth FMDD, YYYY') || '.'
        ELSE 'Your Certificate of Insurance has been verified. The Insured badge is live on your profile until ' || to_char(_expires, 'FMMonth FMDD, YYYY') || '.'
      END
    ELSE
      CASE WHEN _credential = 'license'
        THEN 'Your license could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
        ELSE 'Your insurance document could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END
    END,
    CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
    '/profile?tab=credentials'
  );

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'credential_' || _decision,
    _user_id::text,
    'profile',
    jsonb_build_object('credential', _credential, 'reason', _reason, 'expires', _expires)
  );
END;
$function$;

-- ── 2. get_pending_credentials: one queue, both stores. ────────────────────
-- Signature is unchanged on purpose — AdminCredentialQueue.tsx's PendingRow
-- contract still holds, so this needs no client change and cannot half-deploy.
-- A helper_credentials submission is projected onto the license_/insurance_
-- columns the queue already renders and review_credential already decides.
CREATE OR REPLACE FUNCTION public.get_pending_credentials()
RETURNS TABLE(
  user_id uuid, full_name text, email text, avatar_url text,
  license_url text, insurance_url text,
  license_status text, insurance_status text,
  is_licensed boolean, is_insured boolean,
  business_name text, submitted_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH hc AS (
    -- Only the two types this queue can actually decide, and only while they
    -- are awaiting a human. 'identity' / 'background_check' / 'bond' are
    -- deliberately excluded: review_credential() would reject them.
    SELECT
      c.user_id,
      MAX(c.document_url)   FILTER (WHERE c.credential_type = 'trade_license') AS license_url,
      MAX(c.document_url)   FILTER (WHERE c.credential_type = 'insurance')     AS insurance_url,
      bool_or(c.credential_type = 'trade_license')                             AS has_license,
      bool_or(c.credential_type = 'insurance')                                 AS has_insurance,
      MIN(c.created_at)                                                        AS submitted_at
    FROM public.helper_credentials c
    WHERE c.credential_type IN ('trade_license', 'insurance')
      AND c.status IN ('unverified', 'submitted')
    GROUP BY c.user_id
  )
  SELECT
    p.user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    COALESCE(p.license_url, hc.license_url)     AS license_url,
    COALESCE(p.insurance_url, hc.insurance_url) AS insurance_url,
    -- A pending helper_credentials row makes the credential pending to this
    -- queue even when the profiles mirror still says 'none'.
    CASE WHEN p.license_status = 'pending' OR COALESCE(hc.has_license, false)
         THEN 'pending' ELSE p.license_status END       AS license_status,
    CASE WHEN p.insurance_status = 'pending' OR COALESCE(hc.has_insurance, false)
         THEN 'pending' ELSE p.insurance_status END     AS insurance_status,
    p.is_licensed  OR COALESCE(hc.has_license, false)   AS is_licensed,
    p.is_insured   OR COALESCE(hc.has_insurance, false) AS is_insured,
    p.business_name,
    LEAST(p.updated_at, COALESCE(hc.submitted_at, p.updated_at)) AS submitted_at
  FROM public.profiles p
  LEFT JOIN hc ON hc.user_id = p.user_id
  WHERE has_role(auth.uid(), 'admin')
    AND (p.license_status = 'pending' OR p.insurance_status = 'pending' OR hc.user_id IS NOT NULL)
  ORDER BY submitted_at ASC;
$function$;

-- Supabase's ALTER DEFAULT PRIVILEGES already granted EXECUTE on both of these
-- to anon/authenticated/service_role individually when they were first created,
-- and CREATE OR REPLACE preserves the existing ACL — so no GRANT is added here.
-- Both gate on has_role(auth.uid(), 'admin') internally, which is the real
-- control: get_pending_credentials returns zero rows for a non-admin and
-- review_credential raises. Verified against pg_proc.proacl after deploy.

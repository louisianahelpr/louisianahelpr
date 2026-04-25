-- 1. Add verification columns to businesses table
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verification_document_url text,
  ADD COLUMN IF NOT EXISTS verification_document_type text,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS verification_rejection_reason text;

-- Constrain values
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_verification_status_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_verification_status_check
  CHECK (verification_status IN ('none', 'pending', 'verified', 'rejected'));

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_verification_doc_type_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_verification_doc_type_check
  CHECK (verification_document_type IS NULL OR verification_document_type IN ('license', 'ein_letter', 'insurance'));

-- 2. Trigger: when owner uploads/changes the document, force status back to pending
-- and prevent non-admins from writing verification_* status fields directly.
CREATE OR REPLACE FUNCTION public.enforce_business_verification_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  v_is_admin := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role));

  -- Non-admins cannot directly modify verification status / reviewer fields
  IF NOT v_is_admin THEN
    NEW.verification_status := OLD.verification_status;
    NEW.verification_reviewed_at := OLD.verification_reviewed_at;
    NEW.verification_reviewed_by := OLD.verification_reviewed_by;
    NEW.verification_rejection_reason := OLD.verification_rejection_reason;
  END IF;

  -- If document URL was added or changed, auto-flip to pending (for non-admins)
  IF NOT v_is_admin
     AND NEW.verification_document_url IS NOT NULL
     AND NEW.verification_document_url IS DISTINCT FROM OLD.verification_document_url THEN
    NEW.verification_status := 'pending';
    NEW.verification_reviewed_at := NULL;
    NEW.verification_reviewed_by := NULL;
    NEW.verification_rejection_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_business_verification_safety ON public.businesses;
CREATE TRIGGER trg_enforce_business_verification_safety
BEFORE UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_business_verification_safety();

-- 3. Admin RPC: approve / reject a business verification
CREATE OR REPLACE FUNCTION public.review_business_verification(
  _business_id uuid,
  _decision text,
  _rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins may review business verifications';
  END IF;

  IF _decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be verified or rejected';
  END IF;

  UPDATE public.businesses
     SET verification_status = _decision,
         verification_reviewed_at = now(),
         verification_reviewed_by = auth.uid(),
         verification_rejection_reason = CASE WHEN _decision = 'rejected' THEN _rejection_reason ELSE NULL END
   WHERE id = _business_id;

  -- Log
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'business_verification_' || _decision,
    _business_id::text,
    'business',
    jsonb_build_object('reason', _rejection_reason)
  );

  -- Notify owner
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT
    b.owner_id,
    CASE WHEN _decision = 'verified' THEN '✅ Business verified!' ELSE '❌ Business verification rejected' END,
    CASE WHEN _decision = 'verified'
         THEN 'Your business "' || b.name || '" is now verified. The Verified Business badge is live on your team profiles.'
         ELSE 'Your business "' || b.name || '" was not verified. Reason: ' || COALESCE(_rejection_reason, 'No reason provided') || '. Please re-upload a valid document.'
    END,
    'system_alert',
    '/business-team'
  FROM public.businesses b
  WHERE b.id = _business_id;
END;
$$;

-- 4. Admin queue RPC
CREATE OR REPLACE FUNCTION public.get_pending_business_verifications()
RETURNS TABLE(
  business_id uuid,
  business_name text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  document_url text,
  document_type text,
  submitted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.name,
    b.owner_id,
    p.full_name,
    p.email,
    b.verification_document_url,
    b.verification_document_type,
    b.updated_at
  FROM public.businesses b
  LEFT JOIN public.profiles p ON p.user_id = b.owner_id
  WHERE b.verification_status = 'pending'
    AND has_role(auth.uid(), 'admin'::app_role)
  ORDER BY b.updated_at ASC;
$$;

-- 5. Helper RPC: get the business + verification status for current user (owner or member)
CREATE OR REPLACE FUNCTION public.get_my_business_verification()
RETURNS TABLE(
  business_id uuid,
  business_name text,
  is_owner boolean,
  verification_status text,
  verification_document_url text,
  verification_document_type text,
  verification_rejection_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.name,
    (b.owner_id = auth.uid()) AS is_owner,
    b.verification_status,
    b.verification_document_url,
    b.verification_document_type,
    b.verification_rejection_reason
  FROM public.businesses b
  WHERE b.id IN (SELECT public.get_user_business_ids(auth.uid()))
  ORDER BY (b.owner_id = auth.uid()) DESC
  LIMIT 1;
$$;

-- 6. RPC: check if a given user is part of a verified business (for badges on profiles)
CREATE OR REPLACE FUNCTION public.is_user_verified_business_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.user_id = _user_id
      AND bm.status = 'active'
      AND b.verification_status = 'verified'
  );
$$;

-- 7. Storage bucket for business verification documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-documents',
  'business-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies
DROP POLICY IF EXISTS "Business owners read own business documents" ON storage.objects;
CREATE POLICY "Business owners read own business documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.owner_id = auth.uid()
        AND b.id::text = (storage.foldername(name))[1]
    )
  )
);

DROP POLICY IF EXISTS "Business owners upload own business documents" ON storage.objects;
CREATE POLICY "Business owners upload own business documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = (storage.foldername(name))[1]
  )
);

DROP POLICY IF EXISTS "Business owners update own business documents" ON storage.objects;
CREATE POLICY "Business owners update own business documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = (storage.foldername(name))[1]
  )
);

DROP POLICY IF EXISTS "Business owners delete own business documents" ON storage.objects;
CREATE POLICY "Business owners delete own business documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-documents'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = (storage.foldername(name))[1]
  )
);
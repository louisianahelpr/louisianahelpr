-- Landlord ID: an admin reviews a photo of the landlord's government ID (no
-- charge anywhere), and the paid Stripe Identity check is removed.
--
-- OWNER DECISIONS (2026-10-19 pop-ups):
--   1. "REPLACE the paid Stripe check." A landlord uploads a photo of their
--      government ID (front; back optional) together with their ownership
--      proof; an admin approves, or rejects with a note. Payout setup (Stripe
--      Connect's identity check) still counts too. No charge anywhere.
--   2. A Stripe ID verification done ONCE (Stripe Identity or Stripe Connect)
--      counts in every section and is never asked again, and an admin-APPROVED
--      uploaded ID counts in every section too, the same as Stripe's.
--
-- HOW AN APPROVAL COUNTS EVERYWHERE. The app's ONE identity rule is the
-- predicate public.identity_is_verified(idv_status, stripe_identity_verified)
-- (20260923123701). Every SQL gate and badge already calls it (helper_accept_missing,
-- get_safe_profiles, get_public_profile_stats, shop_badges, and through
-- public.is_identity_verified(uuid), created here, the rentals gates), and the client's
-- isIdentityVerified (src/lib/awardGate.ts) is the same OR. An admin's manual
-- verification already writes profiles.idv_status = 'verified' with
-- legacy_manual_review = true (admin-user-actions manual_verify). An approved
-- landlord ID writes exactly that, so it passes every gate through the one rule
-- with no second rule to drift. Stripe Connect's payout KYC is Stripe's own and
-- is not touched: stripe_identity_verified / payouts stay Stripe's verdict.
-- src/test/identityOneRule.test.ts fails on a gate that reads the verdict
-- columns itself.
--
-- WHAT THIS FILE DOES
--   1. public.landlord_id_reviews: one row per landlord (the current
--      submission), RLS owner-or-admin read, no client write. Which admin
--      reviewed it is staff-only (column grant, as rental_properties).
--   2. rentals_submit_landlord_id(front, back): the files must sit in the
--      caller's own user-documents folder under landlord-id/, and exist.
--      Pages every admin once per waiting spell (the ownership alert's path).
--   3. rentals_admin_review_landlord_id(user, approve, note): admin only,
--      never their own; approve writes the verdict above; reject needs a note;
--      one admin_audit_log row per decision; the landlord is told.
--   4. rentals_my_identity(): the caller's own state for Homes.
--   5. Retention: landlord_id_images_due / landlord_id_images_deleted, for the
--      daily sweep in cleanup-abandoned-accounts
--      (supabase/functions/_shared/landlordIdRetention.ts holds THE number of
--      days). service_role only.
--   6. is_submitted_credential_object: an ID photo the review names cannot be
--      replaced or deleted by its owner until the sweep removes it (restated from 20261017205605 verbatim
--      plus one branch).
--   7. The admin-queue alert closes itself: admin_alert_close_rule and
--      admin_queue_still_pending restated from 20261017223352 VERBATIM plus one
--      VALUES row / one ELSIF branch. Any later restatement starts from THESE.
--   0. public.is_identity_verified(uuid): THE per-user identity lookup over the
--      one predicate identity_is_verified(idv_status, stripe_identity_verified).
--   8. rentals_create_property no longer asks for identity: a landlord adds the
--      property, then sends ID and ownership proof together in one review.
--      rentals_invite_tenant (the first act that reaches another person) still
--      requires both: identity (now is_identity_verified, so Stripe Connect's
--      verdict counts too, not idv_status alone) and approved ownership.
--   9. claim_idv_attempt: its "already verified" answer reads the one rule, so
--      a Connect-verified or admin-approved account never gets a second
--      Stripe Identity session. Everything else verbatim from 20260829090211
--      (the job_post fee-gate skip is unchanged: the poster pays the $2 setup
--      fee in the same job checkout, owner 2026-10-19).
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS;
-- plpgsql resolves rental tables at run time.

-- ---------------------------------------------------------------------------
-- 0. THE per-user identity rule. The verdict itself is THE predicate
--    public.identity_is_verified(text, boolean) (20260923123701), which
--    get_safe_profiles, get_public_profile_stats, shop_badges and
--    helper_accept_missing already read; this only looks the user's two
--    columns up. An approved landlord ID reaches it through idv_status.
CREATE OR REPLACE FUNCTION public.is_identity_verified(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
      FROM public.profiles p
     WHERE p.user_id = p_user_id
  ), false);
$fn$;
COMMENT ON FUNCTION public.is_identity_verified(uuid) IS
  'THE identity rule looked up per user: Stripe Identity (idv_status = ''verified'', also written by an admin approval of a landlord ID photo or admin manual_verify) OR the Stripe Connect identity verdict (stripe_identity_verified), through identity_is_verified. Same rule as src/lib/awardGate.ts isIdentityVerified. Owner 2026-10-19: verified once counts everywhere.';
-- Called from SECURITY DEFINER RPCs and the service role (stripe-idv-start);
-- no client asks it about an arbitrary user id.
REVOKE ALL ON FUNCTION public.is_identity_verified(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_identity_verified(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 1. The review row.
CREATE TABLE IF NOT EXISTS public.landlord_id_reviews (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  front_path text
    CHECK (front_path IS NULL OR front_path ~ '^[0-9a-f-]{36}/landlord-id/[A-Za-z0-9._-]{1,100}$'),
  back_path text
    CHECK (back_path IS NULL OR back_path ~ '^[0-9a-f-]{36}/landlord-id/[A-Za-z0-9._-]{1,100}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  images_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landlord_id_reviews_pending_has_front CHECK (status <> 'pending_review' OR front_path IS NOT NULL),
  CONSTRAINT landlord_id_reviews_decided_has_time CHECK (status = 'pending_review' OR reviewed_at IS NOT NULL)
);
COMMENT ON TABLE public.landlord_id_reviews IS
  'A landlord''s photo ID sent for admin review (owner 2026-10-19: replaces the paid Stripe check; no charge). One row per user: the current submission. Approval writes profiles.idv_status = ''verified'' (as admin manual_verify), so it counts in every section through identity_is_verified. The photos are deleted LANDLORD_ID_RETENTION_DAYS after the decision (supabase/functions/_shared/landlordIdRetention.ts).';

-- The admin queue (pending, oldest first) and the reviewer foreign key.
CREATE INDEX IF NOT EXISTS landlord_id_reviews_pending_idx ON public.landlord_id_reviews (submitted_at)
  WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS landlord_id_reviews_reviewer_idx ON public.landlord_id_reviews (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

ALTER TABLE public.landlord_id_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.landlord_id_reviews FROM PUBLIC, anon, authenticated;
-- Every column EXCEPT reviewed_by (staff-only, as rental_properties.ownership_reviewed_by:
-- the landlord sees "Louisiana Helpr", never which admin). Every write is an RPC.
GRANT SELECT (user_id, status, front_path, back_path, submitted_at, reviewed_at, review_note, images_deleted_at, created_at, updated_at)
  ON TABLE public.landlord_id_reviews TO authenticated;
GRANT ALL ON TABLE public.landlord_id_reviews TO service_role;

DROP POLICY IF EXISTS "landlord id reviews: owner or admin" ON public.landlord_id_reviews;
CREATE POLICY "landlord id reviews: owner or admin" ON public.landlord_id_reviews
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Q807: the unconfirmed-email statement gate every public table carries.
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;

-- ---------------------------------------------------------------------------
-- 2. The landlord sends their ID.
CREATE OR REPLACE FUNCTION public.rentals_submit_landlord_id(p_front_path text, p_back_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
  v_pattern text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  -- Verified once (either Stripe verdict, or an approved ID) is never asked again.
  IF public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'already_verified' USING ERRCODE = '22023';
  END IF;
  -- Both files in the caller's own folder, under landlord-id/, and really uploaded.
  v_pattern := format('^%s/landlord-id/[A-Za-z0-9._-]{1,100}$', v_uid);
  IF p_front_path IS NULL OR p_front_path !~ v_pattern
     OR (p_back_path IS NOT NULL AND (p_back_path !~ v_pattern OR p_back_path = p_front_path)) THEN
    RAISE EXCEPTION 'bad_id_path' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'user-documents' AND o.name = p_front_path)
     OR (p_back_path IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'user-documents' AND o.name = p_back_path)) THEN
    RAISE EXCEPTION 'id_photo_missing' USING ERRCODE = '22023';
  END IF;

  -- An 'approved' row whose verdict was later taken away (admin idv_reject) may
  -- send again: is_identity_verified above is the only "already verified" test.
  SELECT status INTO v_status FROM public.landlord_id_reviews WHERE user_id = v_uid FOR UPDATE;
  INSERT INTO public.landlord_id_reviews AS r (user_id, status, front_path, back_path, submitted_at)
  VALUES (v_uid, 'pending_review', p_front_path, p_back_path, now())
  ON CONFLICT (user_id) DO UPDATE
     SET status = 'pending_review', front_path = EXCLUDED.front_path, back_path = EXCLUDED.back_path,
         submitted_at = now(), reviewed_at = NULL, reviewed_by = NULL, review_note = NULL,
         images_deleted_at = NULL, updated_at = now();

  -- Tell every admin, once per waiting spell (a new photo while it already
  -- waits does not page again). Best effort: a failed alert never refuses the
  -- landlord. A test landlord never pages a real admin (Q137).
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Landlord ID waits for review',
             'A landlord sent a photo of their ID. Check it in Admin -> Settings -> Rentals: ownership proof.',
             'admin_alert',
             '/admin?view=settings'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_submit_landlord_id: admin alert failed: %', SQLERRM;
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_landlord_id(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_landlord_id(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The admin decides.
CREATE OR REPLACE FUNCTION public.rentals_admin_review_landlord_id(p_user_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_submitted timestamptz;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'decision_required' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  -- An admin never approves their own ID.
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT status, submitted_at INTO v_status, v_submitted FROM public.landlord_id_reviews WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'not_pending_review' USING ERRCODE = 'P0002';
  END IF;
  -- The decision is about the photos the admin opened: a new photo sent since
  -- (submitted_at moved) is refused, so the admin looks again (authz review #1).
  IF p_submitted_at IS NULL OR v_submitted IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'review_changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.landlord_id_reviews
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_uid, reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE user_id = p_user_id;

  IF p_approve THEN
    -- THE verdict every gate reads (identity_is_verified), written exactly as
    -- admin-user-actions manual_verify writes it. An admin caller passes
    -- prevent_self_escalation. Stripe's own columns are never touched.
    UPDATE public.profiles
       SET idv_status = 'verified', idv_confidence = 100, idv_failure_reason = NULL, legacy_manual_review = true
     WHERE user_id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'landlord_id_approved' ELSE 'landlord_id_rejected' END,
          'user', p_user_id::text, jsonb_build_object('note', p_note));

  PERFORM public.rentals_notify(p_user_id,
    CASE WHEN p_approve THEN 'ID approved' ELSE 'Send a new photo of your ID' END,
    CASE WHEN p_approve THEN 'Louisiana Helpr approved your ID. You are ID-verified everywhere in the app.'
         ELSE 'Louisiana Helpr could not accept your ID photo: ' || btrim(p_note) END,
    '/rentals', false, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_review_landlord_id(uuid, boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_review_landlord_id(uuid, boolean, text, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The caller's own state (Homes): verified by any route, and their review.
CREATE OR REPLACE FUNCTION public.rentals_my_identity()
RETURNS TABLE (verified boolean, id_status text, review_note text, submitted_at timestamptz, reviewed_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('rentals');
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT public.is_identity_verified((SELECT auth.uid())),
         r.status, r.review_note, r.submitted_at, r.reviewed_at
    FROM (SELECT (SELECT auth.uid()) AS uid) x
    LEFT JOIN public.landlord_id_reviews r ON r.user_id = x.uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_my_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_identity() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Retention (the daily sweep; Storage objects are removed through the
--    Storage API, storage.protect_delete forbids SQL deletes).
CREATE OR REPLACE FUNCTION public.landlord_id_images_due(p_retention_days integer, p_limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, reviewed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.user_id, r.reviewed_at
    FROM public.landlord_id_reviews r
   WHERE r.status IN ('approved', 'rejected')
     AND r.images_deleted_at IS NULL
     AND p_retention_days IS NOT NULL AND p_retention_days >= 1
     AND r.reviewed_at < now() - make_interval(days => p_retention_days)
   ORDER BY r.reviewed_at
   LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$fn$;
REVOKE ALL ON FUNCTION public.landlord_id_images_due(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landlord_id_images_due(integer, integer) TO service_role;

-- Stamps the row once its photos are gone. Only the decision the sweep read:
-- a new submission in between (status back to pending, reviewed_at NULL) is
-- left alone. Returns whether it stamped.
CREATE OR REPLACE FUNCTION public.landlord_id_images_deleted(p_user_id uuid, p_reviewed_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.landlord_id_reviews
     SET front_path = NULL, back_path = NULL, images_deleted_at = now(), updated_at = now()
   WHERE user_id = p_user_id
     AND reviewed_at = p_reviewed_at
     AND status IN ('approved', 'rejected')
     AND images_deleted_at IS NULL;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.landlord_id_images_deleted(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landlord_id_images_deleted(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Submitted files stay put: 20261017205605's body verbatim plus the ID
--    photos the current review names, until the retention sweep deletes them
--    (the evidence of a decision stays for its 30 days; authz review #3).
CREATE OR REPLACE FUNCTION public.is_submitted_credential_object(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_name IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND (p.license_url = p_name OR p.insurance_url = p_name)
  ) OR EXISTS (
    SELECT 1 FROM public.helper_credentials c
     WHERE c.user_id = auth.uid()
       AND c.document_url = p_name
  ) OR EXISTS (
    SELECT 1 FROM public.rental_properties rp
     WHERE rp.owner_id = auth.uid()
       AND rp.ownership_proof_path = p_name
       AND rp.ownership_status IN ('pending_review', 'approved')
  ) OR EXISTS (
    SELECT 1 FROM public.maintenance_request_photos mp
     WHERE mp.tenant_id = auth.uid()
       AND mp.storage_path = p_name
  ) OR EXISTS (
    SELECT 1 FROM public.landlord_id_reviews lr
     WHERE lr.user_id = auth.uid()
       AND lr.images_deleted_at IS NULL
       AND (lr.front_path = p_name OR lr.back_path = p_name)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.is_submitted_credential_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_credential_object(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The admin-queue alert closes itself (20261017223352 bodies + one row / branch).
CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.rule
    FROM (VALUES
      ('ban review needed',                         'ban-review'),
      ('identity verification needs review',        'idv-review'),
      ('user flagged',                              'reported-user'),
      ('dispute escalated',                         'dispute-open'),
      ('escalated dispute overdue',                 'dispute-open'),
      ('dispute stuck — escrow cannot auto-settle', 'dispute-open'),
      ('dispute split did not settle',              'dispute-unsettled'),
      ('job stalled — nobody marked it done',       'stalled-job'),
      ('stuck payment — webhook may be failing',    'stuck-payment'),
      ('payout blocked — ',                          'money-held'),
      ('scheduled payout failed',                   'money-held'),
      ('transfer failed',                           'money-held'),
      ('arrival not confirmed in ',                 'arrival-unconfirmed'),
      ('arrival near a wrong pin not confirmed',    'arrival-unconfirmed'),
      ('auto-restricted (',                         'restriction-review'),
      ('repeat offender: ',                         'repeat-offender'),
      ('low rating alert',                          'low-rating'),
      ('new member joined',                         'notice'),
      ('dispute auto-resolved',                     'notice'),
      -- Q1324: an account banned on a card / bank match waits for an admin.
      ('ban settlement review',                     'ban-settlement-review'),
      -- Rentals slice 3: a landlord's ownership proof waits for an admin.
      ('ownership proof waits for review',          'rentals-ownership-review'),
      -- Landlord ID (20261019051407): a landlord's photo ID waits for an admin.
      ('landlord id waits for review',              'rentals-landlord-id-review')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO supabase_read_only_user;
  END IF;
END
$grant$;

CREATE OR REPLACE FUNCTION public.admin_queue_still_pending(p_rule text, p_ref jsonb, p_since timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (p_ref ->> 'user_id')::uuid;
  v_job  uuid := (p_ref ->> 'job_id')::uuid;
BEGIN
  IF p_rule = 'ban-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_violations v
       WHERE v.action_taken = 'pending_ban_review'
         AND (v.user_id = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = v.user_id AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'idv-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.idv_status = 'manual_review'
         AND (p.user_id = v_user OR p.is_seed IS NOT TRUE))
      OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = v_user
         AND p.idv_status = 'failed'
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = v_user::text
                            AND a.action IN ('manual_verify_user', 'idv_reject', 'request_id_reupload')
                            AND a.created_at > p_since));

  ELSIF p_rule = 'reported-user' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       CROSS JOIN LATERAL (
         SELECT CASE WHEN r.reported_type = 'user' THEN r.reported_id
                     ELSE (SELECT a.helper_id FROM public.applications a WHERE a.id = r.reported_id) END AS subject) s
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND r.reported_type IN ('user', 'application')
         AND s.subject IS NOT NULL
         AND (s.subject = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = s.subject AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'dispute-open' THEN
    -- The whole /admin?view=disputes queue (AdminDisputes.tsx): a job still
    -- 'disputed', or a decided dispute whose settlement has not executed
    -- ("Dispute stuck" is also sent for split_pending, a decided split).
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status = 'disputed'
         AND (j.id = v_job OR j.is_seed IS NOT TRUE))
      OR public.admin_queue_still_pending('dispute-unsettled', p_ref, p_since);

  ELSIF p_rule = 'dispute-unsettled' THEN
    -- AdminDisputes' unsettled read: decided, execution NULL or not 'executed'.
    RETURN EXISTS (
      SELECT 1 FROM public.disputes d
        LEFT JOIN public.jobs j ON j.id = d.job_id
       WHERE d.status = 'decided'
         AND coalesce(d.execution_status, '') <> 'executed'
         AND (d.job_id = v_job OR j.is_seed IS NOT TRUE));

  ELSIF p_rule = 'stalled-job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.job_completion_nudges n
        LEFT JOIN public.jobs j ON j.id = n.job_id
       WHERE n.escalated_at IS NOT NULL
         AND n.resolved_at IS NULL
         AND (n.job_id = v_job OR j.is_seed IS NOT TRUE));

  -- Q1324 (20261006030849): still pending while any ban settlement review is
  -- open; closes once every review is confirmed or lifted.
  ELSIF p_rule = 'ban-settlement-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.review_state = 'open');

  -- Rentals slice 3: open while any property's ownership proof waits.
  ELSIF p_rule = 'rentals-ownership-review' THEN
    -- Test (seed) owners never hold a real alert open (as idv-review and the job
    -- rules); a LEFT JOIN, so an owner with no profile row keeps it open.
    RETURN EXISTS (SELECT 1 FROM public.rental_properties rp
                     LEFT JOIN public.profiles p ON p.user_id = rp.owner_id
                    WHERE rp.ownership_status = 'pending_review' AND p.is_seed IS NOT TRUE);

  -- Landlord ID (20261019051407): open while any landlord's ID photo waits;
  -- test (seed) landlords never hold a real alert open, as the rule above.
  ELSIF p_rule = 'rentals-landlord-id-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.landlord_id_reviews lr
                     LEFT JOIN public.profiles p ON p.user_id = lr.user_id
                    WHERE lr.status = 'pending_review' AND p.is_seed IS NOT TRUE);

  ELSIF p_rule = 'stuck-payment' THEN
    RETURN public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, p_since, false);

  -- Q355 part 2 (20260926035647): the posts that name no queue. Each asks
  -- about every subject the item was raised for (admin_alert_subjects).
  ELSIF p_rule = 'notice' THEN
    -- Informational: nothing to act on.
    RETURN false;

  ELSIF p_rule IN ('money-held', 'arrival-unconfirmed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.job_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.jobs j ON j.id = s.job_id
       WHERE j.is_seed IS NOT TRUE
         AND CASE p_rule
               WHEN 'money-held' THEN
                 j.payment_status IN ('escrow', 'payout_pending')
                 -- a group job released before every roster member was paid
                 OR (j.is_group_job IS TRUE AND j.payment_status = 'released'
                     AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                                  WHERE g.job_id = j.id AND g.helper_id IS NOT NULL
                                    AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                                                     WHERE pt.job_id = j.id AND pt.helper_id = g.helper_id
                                                       AND pt.status IN ('pending', 'paid'))))
               ELSE j.status IN ('accepted', 'in_progress')
                    AND j.helper_arrived_at IS NOT NULL
                    AND j.poster_confirmed_arrival_at IS NULL
             END);

  ELSIF p_rule IN ('restriction-review', 'repeat-offender', 'low-rating') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.user_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.profiles p ON p.user_id = s.user_id
       WHERE p.is_seed IS NOT TRUE
         -- a moderation DECISION on the person after the alert is the review
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = s.user_id::text
                            AND a.action IN ('set_ban_status', 'ban_user', 'unban_user', 'reverse_auto_ban',
                                             'reverse_violation', 'restrict_applications', 'formal_warning',
                                             'final_warning', 'auto_suspend_3_strikes', 'confirm_message_ban',
                                             'dismiss_message_ban_review')
                            AND a.created_at > s.alerted_at)
         AND CASE p_rule
               WHEN 'restriction-review' THEN
                 p.ban_status = 'temp_banned'
                 AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())
               WHEN 'repeat-offender' THEN
                 coalesce(p.ban_status, '') NOT IN ('banned', 'permanently_banned')
               ELSE EXISTS (SELECT 1 FROM public.user_violations v
                             WHERE v.user_id = s.user_id AND v.violation_type = 'low_ratings')
             END);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The rentals gates. Adding a property asks for no identity
--    (20261017205605's body minus the identity lines); inviting a tenant asks
--    through the one helper (20261017205605's body, identity line only).
CREATE OR REPLACE FUNCTION public.rentals_create_property(p_label text, p_street_address text, p_city text, p_zip_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  -- No identity check here (owner 2026-10-19): the landlord adds the property,
  -- then sends ID and ownership proof together for one admin review.
  -- rentals_invite_tenant still requires both before anyone else is reached.
  -- Serialize the cap per owner (a parallel burst cannot pass the count together).
  PERFORM pg_advisory_xact_lock(hashtext('rentals_property:' || v_uid::text));
  IF (SELECT count(*) FROM public.rental_properties WHERE owner_id = v_uid) >= 50 THEN
    RAISE EXCEPTION 'too_many_properties' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_properties (owner_id, label, street_address, city, zip_code)
  VALUES (v_uid, btrim(p_label), btrim(p_street_address), btrim(p_city), btrim(p_zip_code))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_create_property(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_create_property(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_invite_tenant(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_prop uuid;
  v_status text;
  v_token text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT u.property_id, p.ownership_status INTO v_prop, v_status
    FROM public.rental_units u JOIN public.rental_properties p ON p.id = u.property_id
   WHERE u.id = p_unit_id AND p.owner_id = v_uid
   FOR UPDATE OF p;  -- serializes the open-invite cap below
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Q5 holds for as long as they invite, not only at creation (review #8).
  -- The one identity rule (owner 2026-10-19): Stripe Identity, Stripe Connect's
  -- identity check, or an admin-approved ID photo.
  IF NOT public.is_identity_verified(v_uid) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;
  -- Open invites per unit are capped so a link cannot be farmed.
  IF (SELECT count(*) FROM public.rental_tenancies
       WHERE unit_id = p_unit_id AND status = 'invited' AND invite_expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'too_many_open_invites' USING ERRCODE = '22023';
  END IF;
  -- Two v4 UUIDs (gen_random_uuid draws from the CSPRNG): 244 random bits.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.rental_tenancies (unit_id, property_id, landlord_id, invite_token_sha256, invite_expires_at)
  VALUES (p_unit_id, v_prop, v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '14 days');
  RETURN v_token;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_invite_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_invite_tenant(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. claim_idv_attempt: "already verified" by the one rule. 20260829090211's
--    body verbatim except the profile read (+ stripe_identity_verified) and
--    the already_verified test.
CREATE OR REPLACE FUNCTION public.claim_idv_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 1,
  p_skip_fee_gate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status  text;
  v_connect boolean;
  v_paid    boolean;
  v_count   integer;
  v_banned  text;
  v_claimed integer;
  -- Hard-coded on purpose: see 20260829031405. `p_max_attempts` is accepted
  -- for signature compatibility and deliberately not read.
  v_max     integer := 1;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.idv_status, p.stripe_identity_verified, p.onboarding_fee_paid, p.idv_attempt_count, p.ban_status
    INTO v_status, v_connect, v_paid, v_count, v_banned
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'profile_not_found');
  END IF;

  -- Verified once, by any route (Stripe Identity, Stripe Connect, an approved
  -- ID), is never asked again (owner 2026-10-19): the one rule.
  IF public.identity_is_verified(v_status, v_connect) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_verified');
  END IF;

  -- Already with a human. Spending a second session on an account an admin is
  -- actively reviewing is the exact double-charge this migration exists to
  -- stop, and it would also stomp the reviewable state back to 'pending'.
  IF v_status = 'manual_review' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_manual_review');
  END IF;

  -- A banned account must not be able to spend platform money either.
  IF v_banned IN ('temp_banned', 'permanently_banned') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_restricted');
  END IF;

  IF v_paid IS NOT TRUE AND NOT p_skip_fee_gate THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'onboarding_fee_unpaid');
  END IF;

  IF COALESCE(v_count, 0) >= v_max THEN
    RETURN jsonb_build_object(
      'claimed', false, 'reason', 'attempt_limit_reached',
      'attempt', COALESCE(v_count, 0), 'max_attempts', v_max
    );
  END IF;

  UPDATE public.profiles
     SET idv_attempt_count = COALESCE(idv_attempt_count, 0) + 1,
         idv_attempted_at  = now(),
         idv_status        = 'pending'
   WHERE user_id = p_user_id
     AND COALESCE(idv_attempt_count, 0) = COALESCE(v_count, 0)
  RETURNING idv_attempt_count INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- Someone else took this attempt between the read and the write.
    RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_race_lost');
  END IF;

  RETURN jsonb_build_object(
    'claimed', true, 'reason', NULL,
    'attempt', v_claimed, 'max_attempts', v_max
  );
END;
$$;
COMMENT ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) IS
  'Atomically claims THE ONE billable Stripe Identity attempt this account gets, or refuses with a reason (already_verified / in_manual_review / account_restricted / onboarding_fee_unpaid / attempt_limit_reached / attempt_race_lost). already_verified reads the one identity rule (identity_is_verified: Stripe Identity, Stripe Connect, or an approved ID; owner 2026-10-19 "never asked again"). p_skip_fee_gate lets a caller (job-posting only, as of 2026-08-29) proceed without the $2 already settled, because that fee is collected in the same job checkout moments later — see 20260829090211. The cap is hard-coded at 1 — p_max_attempts is ignored — because the $2 onboarding fee funds exactly one Stripe charge.';

REVOKE ALL ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) TO service_role;

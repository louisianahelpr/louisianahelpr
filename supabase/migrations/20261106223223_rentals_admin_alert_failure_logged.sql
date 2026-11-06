-- Q2203 (finding: lh-silent-failure@c3f459d3b#4): a failed admin alert for a landlord's ID photo or ownership proof
-- left no durable trace. Both submit RPCs page the admins best effort and, on any error, only RAISEd a WARNING,
-- which PostgREST drops: the submission still waited in the admin card, but nobody was told.
--
-- Now each alert handler also writes an error_logs row through log_cron_defect (20261004004835): deduped to one row
-- per function per hour, flood-capped, and it never raises (its own EXCEPTION block), so the landlord's submit is
-- still never refused. A test landlord's failure is logged under '<fn>-seed', which error_log_is_seed treats as seed
-- (20260923052520): it reaches the daily digest and never pages.
--
-- Restated verbatim from the newest definitions, changing only each alert handler:
--   rentals_submit_landlord_id       from 20261019051407_rentals_landlord_id_review.sql
--   rentals_submit_ownership_proof   from 20261103055505_declutter_shops_homes_messages_not_found_is_404.sql

-- rentals_submit_landlord_id, restated from 20261019051407_rentals_landlord_id_review.sql.
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
             'A landlord sent a photo of their ID. Check it in Admin -> Settings -> Homes: ownership proof.',
             'admin_alert',
             '/admin?view=settings'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_submit_landlord_id: admin alert failed: %', SQLERRM;
      -- Q2203: the WARNING alone is dropped by PostgREST; this row is the durable trace.
      PERFORM public.log_cron_defect(
        'rentals_submit_landlord_id' || CASE WHEN public.is_test_member(v_uid) THEN '-seed' ELSE '' END,
        'admin-alert', SQLERRM, jsonb_build_object('stage', 'admin_alert'));
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_landlord_id(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_landlord_id(text, text) TO authenticated, service_role;

-- rentals_submit_ownership_proof, restated from 20261103055505_declutter_shops_homes_messages_not_found_is_404.sql.
CREATE OR REPLACE FUNCTION public.rentals_submit_ownership_proof(p_property_id uuid, p_storage_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT ownership_status INTO v_status FROM public.rental_properties
   WHERE id = p_property_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'already_approved' USING ERRCODE = '22023';
  END IF;
  -- The file must sit in the caller's own folder for THIS property.
  IF p_storage_path IS NULL
     OR p_storage_path !~ format('^%s/rentals/%s/[A-Za-z0-9._-]{1,100}$', v_uid, p_property_id) THEN
    RAISE EXCEPTION 'bad_proof_path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_properties
     SET ownership_proof_path = p_storage_path, ownership_status = 'pending_review',
         ownership_submitted_at = now(), updated_at = now()
   WHERE id = p_property_id;
  -- Slice 3: tell every admin (the admin-queue alert path; it closes itself
  -- through admin_alert_close_rule 'rentals-ownership-review' once no proof
  -- waits). Once per property per waiting spell: a re-upload while it already
  -- waits does not page again. Best effort: a failed alert never refuses the
  -- landlord's upload.
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ownership proof waits for review',
             'A landlord sent ownership proof for a property. Check it in Admin -> Settings -> Homes: ownership proof.',
             'admin_alert',
             '/admin?view=settings'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         -- The seed boundary judged with the landlord as the actor (the link
         -- names none): a test landlord never pages a real admin (Q137).
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_submit_ownership_proof: admin alert failed: %', SQLERRM;
      -- Q2203: the WARNING alone is dropped by PostgREST; this row is the durable trace.
      PERFORM public.log_cron_defect(
        'rentals_submit_ownership_proof' || CASE WHEN public.is_test_member(v_uid) THEN '-seed' ELSE '' END,
        'admin-alert', SQLERRM, jsonb_build_object('stage', 'admin_alert'));
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) TO authenticated, service_role;

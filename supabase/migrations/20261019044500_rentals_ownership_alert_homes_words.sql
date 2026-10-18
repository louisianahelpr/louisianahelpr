-- HOMES rename (owner 2026-10-18): the admin alert sent when a landlord's
-- ownership proof waits for review still pointed admins at
-- "Admin -> Settings -> Rentals: ownership proof", but that card is now
-- "Homes: ownership proof" (RentalsOwnershipCard.tsx).
--
-- The body is the NEWEST rentals_submit_ownership_proof
-- (20261017223352_rentals_ownership_review_alert) VERBATIM with only the
-- alert's message text changed. Replay-safe CREATE OR REPLACE of the same
-- (uuid, text) signature; grants restated exactly as 20261017223352 sets them
-- (EXECUTE for authenticated and service_role, revoked from PUBLIC and anon).

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
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
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
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) TO authenticated, service_role;

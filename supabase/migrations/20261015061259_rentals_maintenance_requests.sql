-- RENTALS, SLICE S1: maintenance requests -> Helpr jobs (owner decisions in
-- docs/specs/landlord-hub-prep.md, "Owner answers", cited as Q<n>; build queue
-- item 6). Lowest legal risk slice: the existing jobs marketplace with a new
-- "who asked" link. No listings, applications, leases or rent here.
--
-- HIDDEN: everything is behind the hidden switch 'rentals', created OFF
-- (20261012031120's recipe). Every client RPC starts
-- PERFORM public.require_feature('rentals'), and every read policy needs the
-- switch too, so a non-tester reads and writes nothing even by REST.
--
-- WHO (Q5, Q6, Q53, Q37, Q59): a landlord is the property's OWNER, ID-verified
-- (profiles.idv_status = 'verified', the same check posting a job needs). Each
-- property needs ownership proof (deed, tax bill or parish assessor page,
-- stored privately in user-documents under <owner uid>/rentals/<property id>/)
-- checked by an admin before it can invite tenants. A tenant joins a unit by
-- the landlord's invite link (this slice; app leases come in S6). Under 18
-- (member_under_18, the rule jobs use) can neither own a property here, accept
-- an invite, file a request nor approve one. Banned accounts write nothing.
--
-- FLOW (Q38-Q42, Q46, Q48):
--   tenant files a request (category, description, photos, urgency, when
--   someone may come in, pets on site, OK to enter without me, private access
--   notes) -> the landlord is notified (an EMERGENCY also gets an email at
--   once, Q40; the app shows "call 911 / your utility now" BEFORE filing; the
--   server never sends a Helpr) -> the landlord approves or declines WITH a
--   reason the tenant sees (Q46) -> approval opens Post a Job pre-filled
--   (/post-job?maintenance=<request id>); the landlord checks the price and
--   pays with their card exactly like any job (Q39, Q47: same fees, the same
--   create-payment pipeline; NO jobs row is written here, the
--   noJobRowBeforePayment rule) -> link_maintenance_request_job points the
--   request at the new job -> once work has started the tenant answers
--   "Was it fixed?" and the landlord sees it before confirming and paying
--   through the normal job completion (Q42).
--   Auto-approve (Q48): per property, OFF by default (NULL). When set, a
--   non-emergency request is approved on filing; the landlord still posts and
--   pays (Q39 chose no saved-card charging), with the budget pre-filled up to
--   the limit. Emergencies always wait for the landlord (Q40).
--
-- RECORD (Q46, art. 2688 notice): requests are never deleted by a client;
-- created_at / decided_at / tenant_answered_at are the dates. A deleted
-- account leaves the other side's copy (FKs SET NULL; the property's label and
-- address are snapshotted on the request).
--
-- Error codes: 42501 refusals (feature_disabled, not_authenticated,
-- account_restricted, under_18, identity_not_verified, ownership_not_approved,
-- not_authorized), 22023 bad input, P0002 a row the caller cannot act on (a
-- stranger is never told "exists but not yours").
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- DO NOTHING; grants restated by role name. Applied 3x in PGlite by
-- src/test/pglite/rentalsMaintenance.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The hidden switch, OFF.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('rentals', 'off',
        'Rentals: landlords (property owners) invite tenants, and tenants send maintenance requests that become Helpr jobs. '
        'Gates every rentals_* RPC and the Rentals table reads.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Properties (one owner each; Q5 owners only, no property managers Q7).
CREATE TABLE IF NOT EXISTS public.rental_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 60),
  street_address text NOT NULL CHECK (char_length(btrim(street_address)) BETWEEN 5 AND 200),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 80),
  zip_code text NOT NULL CHECK (zip_code ~ '^[0-9]{5}$'),
  -- Q6/Q53: proof checked by an admin before the property can invite tenants.
  ownership_status text NOT NULL DEFAULT 'needs_proof'
    CHECK (ownership_status IN ('needs_proof', 'pending_review', 'approved', 'rejected')),
  ownership_proof_path text
    CHECK (ownership_proof_path IS NULL OR ownership_proof_path ~ '^[0-9a-f-]{36}/rentals/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  ownership_submitted_at timestamptz,
  ownership_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ownership_reviewed_at timestamptz,
  ownership_review_note text CHECK (ownership_review_note IS NULL OR char_length(ownership_review_note) <= 500),
  -- Q48: NULL = auto-approve OFF (the default).
  auto_approve_limit_cents integer CHECK (auto_approve_limit_cents IS NULL OR auto_approve_limit_cents BETWEEN 100 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_properties_owner_idx ON public.rental_properties (owner_id);
CREATE INDEX IF NOT EXISTS rental_properties_review_idx ON public.rental_properties (ownership_submitted_at)
  WHERE ownership_status = 'pending_review';
CREATE INDEX IF NOT EXISTS rental_properties_reviewer_idx ON public.rental_properties (ownership_reviewed_by)
  WHERE ownership_reviewed_by IS NOT NULL;

-- 2. Units.
CREATE TABLE IF NOT EXISTS public.rental_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.rental_properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_units_label_key UNIQUE (property_id, label)
);
CREATE INDEX IF NOT EXISTS rental_units_owner_idx ON public.rental_units (owner_id);

-- 3. Tenancies: an invite link, then the tenant who accepted it (Q37).
--    Only the SHA-256 of the invite token is stored; the token itself is
--    returned once, to the landlord who made it.
CREATE TABLE IF NOT EXISTS public.rental_tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.rental_units(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.rental_properties(id) ON DELETE CASCADE,
  landlord_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'ended', 'revoked')),
  invite_token_sha256 text NOT NULL UNIQUE CHECK (invite_token_sha256 ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_tenancies_active_has_tenant CHECK (status <> 'active' OR tenant_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS rental_tenancies_unit_idx ON public.rental_tenancies (unit_id);
CREATE INDEX IF NOT EXISTS rental_tenancies_landlord_idx ON public.rental_tenancies (landlord_id);
CREATE INDEX IF NOT EXISTS rental_tenancies_tenant_idx ON public.rental_tenancies (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rental_tenancies_property_idx ON public.rental_tenancies (property_id);
-- One live tenancy per tenant per unit.
CREATE UNIQUE INDEX IF NOT EXISTS rental_tenancies_one_active
  ON public.rental_tenancies (unit_id, tenant_id) WHERE status = 'active';

-- A tenant's account deletion nulls tenant_id (FK SET NULL); an ACTIVE row
-- would then break rental_tenancies_active_has_tenant and abort the deletion
-- (lh-authz-rls review of 3e84eea25, #1). A BEFORE trigger runs on the FK's
-- UPDATE ahead of the CHECK: the tenancy ends instead.
CREATE OR REPLACE FUNCTION public.rentals_end_tenancy_on_tenant_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL AND OLD.tenant_id IS NOT NULL AND NEW.status = 'active' THEN
    NEW.status := 'ended';
    NEW.ended_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_end_tenancy_on_tenant_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_tenancies_end_on_tenant_delete ON public.rental_tenancies;
CREATE TRIGGER rental_tenancies_end_on_tenant_delete
  BEFORE UPDATE OF tenant_id ON public.rental_tenancies
  FOR EACH ROW EXECUTE FUNCTION public.rentals_end_tenancy_on_tenant_delete();

-- 4. Maintenance requests (Q38, Q46, Q42).
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid REFERENCES public.rental_tenancies(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.rental_units(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.rental_properties(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  landlord_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot, so either side keeps a readable record after the other leaves.
  property_label text NOT NULL,
  unit_label text NOT NULL,
  property_address text NOT NULL,
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 10 AND 2000),
  urgency text NOT NULL CHECK (urgency IN ('emergency', 'soon', 'whenever')),
  access_windows text NOT NULL DEFAULT '' CHECK (char_length(access_windows) <= 300),
  pets_on_site boolean NOT NULL DEFAULT false,
  ok_to_enter_alone boolean NOT NULL DEFAULT false,
  -- Gate/lock info (Q41): copied into the job's private access notes, which
  -- only the booked Helpr reads. Here only the tenant and landlord read it.
  access_notes text NOT NULL DEFAULT '' CHECK (char_length(access_notes) <= 500),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'declined', 'withdrawn')),
  auto_approved boolean NOT NULL DEFAULT false,
  approved_budget_cents integer CHECK (approved_budget_cents IS NULL OR approved_budget_cents BETWEEN 100 AND 1000000),
  decline_reason_code text CHECK (decline_reason_code IS NULL OR decline_reason_code IN
    ('handle_myself', 'not_my_responsibility', 'already_scheduled', 'other')),
  decline_reason_text text CHECK (decline_reason_text IS NULL OR char_length(decline_reason_text) <= 500),
  decided_at timestamptz,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- Q42: "Was it fixed?"
  tenant_says_fixed boolean,
  tenant_fixed_note text CHECK (tenant_fixed_note IS NULL OR char_length(tenant_fixed_note) <= 500),
  tenant_answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_requests_decline_has_reason CHECK (status <> 'declined' OR decline_reason_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS maintenance_requests_tenant_idx ON public.maintenance_requests (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS maintenance_requests_landlord_idx ON public.maintenance_requests (landlord_id) WHERE landlord_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS maintenance_requests_tenancy_idx ON public.maintenance_requests (tenancy_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_unit_idx ON public.maintenance_requests (unit_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_property_idx ON public.maintenance_requests (property_id);
-- One request per job (the link RPC's check alone could race).
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_requests_one_per_job
  ON public.maintenance_requests (job_id) WHERE job_id IS NOT NULL;

-- 5. Request photos: private user-documents objects in the TENANT's folder,
--    <tenant uid>/rentals/requests/<batch uuid>/<file>. The landlord reads
--    them through the storage policy in section 9.
CREATE TABLE IF NOT EXISTS public.maintenance_request_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/rentals/requests/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_request_photos_position_key UNIQUE (request_id, position)
);
CREATE INDEX IF NOT EXISTS maintenance_request_photos_tenant_idx ON public.maintenance_request_photos (tenant_id) WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. RLS: reads only, and only with the switch on. No client writes at all.
ALTER TABLE public.rental_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_tenancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_request_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_properties, public.rental_units, public.rental_tenancies,
  public.maintenance_requests, public.maintenance_request_photos FROM PUBLIC, anon, authenticated;
-- One statement per table (scripts/check-migration-relation-grants.mjs reads one relation per GRANT).
-- SELECT only, for the read policies below; every write goes through a SECURITY DEFINER RPC.
GRANT SELECT ON TABLE public.rental_properties TO authenticated;
GRANT SELECT ON TABLE public.rental_units TO authenticated;
GRANT SELECT ON TABLE public.rental_tenancies TO authenticated;
GRANT SELECT ON TABLE public.maintenance_requests TO authenticated;
GRANT SELECT ON TABLE public.maintenance_request_photos TO authenticated;
GRANT ALL ON TABLE public.rental_properties TO service_role;
GRANT ALL ON TABLE public.rental_units TO service_role;
GRANT ALL ON TABLE public.rental_tenancies TO service_role;
GRANT ALL ON TABLE public.maintenance_requests TO service_role;
GRANT ALL ON TABLE public.maintenance_request_photos TO service_role;

-- Is the CALLER an active tenant of p_property? Definer, so the policies below
-- do not recurse through rental_tenancies' own policy; scoped to auth.uid()
-- (never a user argument), so a client cannot probe other people's tenancies
-- (the 20261012184600 policy-helper rule).
CREATE OR REPLACE FUNCTION public.rentals_caller_is_active_tenant_of(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.rental_tenancies t
                  WHERE t.property_id = p_property_id AND t.tenant_id = (SELECT auth.uid()) AND t.status = 'active');
$fn$;
REVOKE ALL ON FUNCTION public.rentals_caller_is_active_tenant_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_caller_is_active_tenant_of(uuid) TO authenticated, service_role;

-- The OWNER and admins only: the row carries the proof path, the admin's
-- review and the auto-approve limit, none of which a tenant may read
-- (lh-authz-rls review of 3e84eea25, #2). A tenant reads its home's name and
-- address through rentals_my_homes() (8p).
DROP POLICY IF EXISTS "rental properties: owner, active tenant or admin" ON public.rental_properties;
DROP POLICY IF EXISTS "rental properties: owner or admin" ON public.rental_properties;
CREATE POLICY "rental properties: owner or admin" ON public.rental_properties
  FOR SELECT TO authenticated
  USING (
    (SELECT public.feature_enabled_for('rentals'))
    AND (owner_id = (SELECT auth.uid())
         OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

DROP POLICY IF EXISTS "rental units: owner or active tenant" ON public.rental_units;
CREATE POLICY "rental units: owner or active tenant" ON public.rental_units
  FOR SELECT TO authenticated
  USING (
    (SELECT public.feature_enabled_for('rentals'))
    AND (owner_id = (SELECT auth.uid()) OR public.rentals_caller_is_active_tenant_of(property_id))
  );

DROP POLICY IF EXISTS "rental tenancies: landlord or tenant" ON public.rental_tenancies;
CREATE POLICY "rental tenancies: landlord or tenant" ON public.rental_tenancies
  FOR SELECT TO authenticated
  USING (
    (SELECT public.feature_enabled_for('rentals'))
    AND (landlord_id = (SELECT auth.uid()) OR tenant_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "maintenance requests: tenant or landlord" ON public.maintenance_requests;
CREATE POLICY "maintenance requests: tenant or landlord" ON public.maintenance_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT public.feature_enabled_for('rentals'))
    AND (tenant_id = (SELECT auth.uid()) OR landlord_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "maintenance photos: with their request" ON public.maintenance_request_photos;
CREATE POLICY "maintenance photos: with their request" ON public.maintenance_request_photos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.maintenance_requests r WHERE r.id = maintenance_request_photos.request_id));

COMMENT ON TABLE public.rental_properties IS
  'Rentals S1 (docs/specs/landlord-hub-prep.md): a landlord''s property. Written only by rentals_* RPCs.';
COMMENT ON TABLE public.maintenance_requests IS
  'Rentals S1: a tenant''s maintenance request (Q38) and its record (Q46). Written only by rentals_* RPCs '
  'and link_maintenance_request_job; never deleted by a client.';

-- ---------------------------------------------------------------------------
-- 7. Internal helpers.

-- The member gates every Rentals write runs (after require_feature).
CREATE OR REPLACE FUNCTION public.rentals_assert_member()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Q59: minors can't request, approve, own or accept here.
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_assert_member() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_assert_member() TO service_role;

-- A notice to one member (push + bell through the notifications fan-out), and
-- for emergencies an email at once (Q40), the send_backout_email pattern.
-- Best effort: a failed notice never fails the request that caused it.
CREATE OR REPLACE FUNCTION public.rentals_notify(p_user uuid, p_title text, p_message text, p_link text, p_email boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_link text := p_link;
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  -- Carry the actor (the tenant, landlord or admin whose RPC sent this) in the
  -- link, so the notifications seed-boundary trigger can judge the row: a test
  -- account never notifies a real person (Q137, seedNeverNotifiesReal). A
  -- Rentals link names no job, so without it the trigger could not tell.
  IF v_actor IS NOT NULL AND v_actor <> p_user AND v_link IS NOT NULL THEN
    v_link := CASE WHEN strpos(v_link, '?') > 0 THEN v_link || '&user=' ELSE v_link || '?user=' END || v_actor::text;
  END IF;
  BEGIN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (p_user, p_title, p_message, 'job_updates', v_link);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rentals_notify: %', SQLERRM;
  END;
  IF p_email THEN
    BEGIN
      IF public.notification_crosses_seed_boundary(p_user, NULL, v_link, v_actor) THEN
        RETURN;
      END IF;
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', p_message, 'type', 'job_updates', 'link', v_link)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_notify email: %', SQLERRM;
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_notify(uuid, text, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Client RPCs. Each VOLATILE one names is_caller_banned() in its own body
--    and starts with require_feature('rentals').

-- 8a. A landlord adds a property (Q5: ID-verified owner).
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.idv_status = 'verified') THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
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

-- 8b. The landlord submits ownership proof already uploaded to their own
--     private folder (Q6). Sends the property to admin review.
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
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) TO authenticated, service_role;

-- 8c. Admin decides ownership proof (Q53). Audited.
CREATE OR REPLACE FUNCTION public.rentals_admin_review_property(p_property_id uuid, p_approve boolean, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
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
  SELECT owner_id, ownership_status INTO v_owner, v_status FROM public.rental_properties
   WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'not_pending_review' USING ERRCODE = 'P0002';
  END IF;
  -- An admin never approves their own property.
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rental_properties
     SET ownership_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         ownership_reviewed_by = v_uid, ownership_reviewed_at = now(),
         ownership_review_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   WHERE id = p_property_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'rentals_ownership_approved' ELSE 'rentals_ownership_rejected' END,
          'rental_property', p_property_id::text, jsonb_build_object('note', p_note));
  PERFORM public.rentals_notify(v_owner,
    CASE WHEN p_approve THEN 'Property approved' ELSE 'Ownership proof not accepted' END,
    CASE WHEN p_approve THEN 'Your ownership proof was accepted. You can now invite tenants.'
         ELSE 'Your ownership proof was not accepted: ' || btrim(p_note) END,
    '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_review_property(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_review_property(uuid, boolean, text) TO authenticated, service_role;

-- 8d. Units.
CREATE OR REPLACE FUNCTION public.rentals_add_unit(p_property_id uuid, p_label text)
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
  PERFORM 1 FROM public.rental_properties WHERE id = p_property_id AND owner_id = v_uid FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.rental_units WHERE property_id = p_property_id) >= 200 THEN
    RAISE EXCEPTION 'too_many_units' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rental_units (property_id, owner_id, label)
  VALUES (p_property_id, v_uid, btrim(p_label))
  ON CONFLICT (property_id, label) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unit_exists' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_add_unit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_add_unit(uuid, text) TO authenticated, service_role;

-- 8e. Auto-approve limit (Q48). NULL turns it off.
CREATE OR REPLACE FUNCTION public.rentals_set_auto_approve(p_property_id uuid, p_limit_cents integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_limit_cents IS NOT NULL AND (p_limit_cents < 100 OR p_limit_cents > 1000000) THEN
    RAISE EXCEPTION 'bad_limit' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_properties SET auto_approve_limit_cents = p_limit_cents, updated_at = now()
   WHERE id = p_property_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_auto_approve(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_auto_approve(uuid, integer) TO authenticated, service_role;

-- 8f. Invite a tenant to a unit (Q37). Only an admin-approved property (Q6).
--     Returns the token ONCE; the table keeps only its SHA-256. 14 days.
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_uid AND pr.idv_status = 'verified') THEN
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

-- 8g. A tenant accepts an invite link. Returns the tenancy id.
CREATE OR REPLACE FUNCTION public.rentals_accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_existing uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE invite_token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND OR v_t.status <> 'invited' OR v_t.invite_expires_at <= now() THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_t.landlord_id = v_uid THEN
    RAISE EXCEPTION 'own_invite' USING ERRCODE = '22023';
  END IF;
  SELECT o.id INTO v_existing FROM public.rental_tenancies o
   WHERE o.unit_id = v_t.unit_id AND o.tenant_id = v_uid AND o.status = 'active';
  IF v_existing IS NOT NULL THEN
    -- Already living there: the link is spent either way.
    UPDATE public.rental_tenancies SET status = 'revoked', ended_at = now() WHERE id = v_t.id;
    RETURN v_existing;
  END IF;
  UPDATE public.rental_tenancies SET tenant_id = v_uid, status = 'active', accepted_at = now()
   WHERE id = v_t.id;
  PERFORM public.rentals_notify(v_t.landlord_id, 'Tenant joined',
    'A tenant accepted your invite and can now send maintenance requests.', '/rentals', false);
  RETURN v_t.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_accept_invite(text) TO authenticated, service_role;

-- 8h. Either side ends a tenancy (the landlord also cancels an open invite).
--     Banned members may still leave (it only removes access).
CREATE OR REPLACE FUNCTION public.rentals_end_tenancy(p_tenancy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rental_tenancies
     SET status = CASE WHEN status = 'invited' THEN 'revoked' ELSE 'ended' END, ended_at = now()
   WHERE id = p_tenancy_id AND status IN ('invited', 'active')
     AND (landlord_id = v_uid OR tenant_id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_end_tenancy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_end_tenancy(uuid) TO authenticated, service_role;

-- 8i. A tenant files a request (Q38). Photos are paths the tenant already
--     uploaded to their own private folder. Emergencies alert the landlord by
--     push + email at once (Q40); auto-approve (Q48) never applies to them.
CREATE OR REPLACE FUNCTION public.rentals_file_request(
  p_tenancy_id uuid,
  p_category text,
  p_description text,
  p_urgency text,
  p_access_windows text,
  p_pets_on_site boolean,
  p_ok_to_enter_alone boolean,
  p_access_notes text,
  p_photo_paths text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_p public.rental_properties%ROWTYPE;
  v_unit_label text;
  v_id uuid;
  v_auto boolean;
  v_leak text;
  v_path text;
  v_pos int := 0;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE id = p_tenancy_id AND tenant_id = v_uid AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_p FROM public.rental_properties WHERE id = v_t.property_id;
  SELECT label INTO v_unit_label FROM public.rental_units WHERE id = v_t.unit_id;
  IF p_urgency IS NULL OR p_urgency NOT IN ('emergency', 'soon', 'whenever') THEN
    RAISE EXCEPTION 'bad_urgency' USING ERRCODE = '22023';
  END IF;
  IF p_category IS NULL OR p_category !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'bad_category' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'bad_description' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_access_windows, '')) > 300 OR char_length(coalesce(p_access_notes, '')) > 500 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;
  -- The existing message filter rules (owner: maintenance uses them as-is).
  -- The private access notes (gate codes) are not scanned: digits there are
  -- codes, and only the landlord and the booked Helpr ever read them.
  v_leak := public.contact_leak_reason(p_description || ' ' || coalesce(p_access_windows, ''));
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
  END IF;
  IF coalesce(array_length(p_photo_paths, 1), 0) > 10 THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  -- Rate limit: 20 requests a day per tenant, serialized per tenant (it also
  -- bounds emergency emails to the landlord; review #6).
  PERFORM pg_advisory_xact_lock(hashtext('rentals_file:' || v_uid::text));
  IF (SELECT count(*) FROM public.maintenance_requests
       WHERE tenant_id = v_uid AND created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'too_many_requests' USING ERRCODE = '22023';
  END IF;
  v_auto := p_urgency <> 'emergency' AND v_p.auto_approve_limit_cents IS NOT NULL;
  INSERT INTO public.maintenance_requests (
    tenancy_id, unit_id, property_id, tenant_id, landlord_id,
    property_label, unit_label, property_address,
    category, description, urgency, access_windows, pets_on_site, ok_to_enter_alone, access_notes,
    status, auto_approved, approved_budget_cents, decided_at)
  VALUES (
    v_t.id, v_t.unit_id, v_t.property_id, v_uid, v_t.landlord_id,
    v_p.label, coalesce(v_unit_label, ''), v_p.street_address || ', ' || v_p.city || ', LA ' || v_p.zip_code,
    p_category, btrim(p_description), p_urgency, btrim(coalesce(p_access_windows, '')),
    coalesce(p_pets_on_site, false), coalesce(p_ok_to_enter_alone, false), btrim(coalesce(p_access_notes, '')),
    CASE WHEN v_auto THEN 'approved' ELSE 'submitted' END, v_auto,
    CASE WHEN v_auto THEN v_p.auto_approve_limit_cents END,
    CASE WHEN v_auto THEN now() END)
  RETURNING id INTO v_id;
  IF p_photo_paths IS NOT NULL THEN
    FOREACH v_path IN ARRAY p_photo_paths LOOP
      IF v_path IS NULL OR v_path !~ format('^%s/rentals/requests/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$', v_uid) THEN
        RAISE EXCEPTION 'bad_photo_path' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.maintenance_request_photos (request_id, tenant_id, storage_path, position)
      VALUES (v_id, v_uid, v_path, v_pos);
      v_pos := v_pos + 1;
    END LOOP;
  END IF;
  IF p_urgency = 'emergency' THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'EMERGENCY maintenance request',
      'Your tenant at ' || v_p.label || ' reported an emergency. Open the request now.',
      '/rentals/requests/' || v_id::text, true);
  ELSIF v_auto THEN
    PERFORM public.rentals_notify(v_t.landlord_id, 'Repair ready to post',
      'A maintenance request at ' || v_p.label || ' was auto-approved. Post the job to send a Helpr.',
      '/rentals/requests/' || v_id::text, false);
  ELSE
    PERFORM public.rentals_notify(v_t.landlord_id, 'New maintenance request',
      'Your tenant at ' || v_p.label || ' sent a maintenance request.',
      '/rentals/requests/' || v_id::text, false);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_file_request(uuid, text, text, text, text, boolean, boolean, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_file_request(uuid, text, text, text, text, boolean, boolean, text, text[]) TO authenticated, service_role;

-- 8j. The landlord approves (Q39). The client then opens Post a Job
--     pre-filled; nothing is charged or posted here.
CREATE OR REPLACE FUNCTION public.rentals_approve_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_tenant uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  UPDATE public.maintenance_requests SET status = 'approved', decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND landlord_id = v_uid AND status = 'submitted'
  RETURNING tenant_id INTO v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.rentals_notify(v_tenant, 'Request approved',
    'Your landlord approved your maintenance request. You''ll hear when a Helpr is booked.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_approve_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_approve_request(uuid) TO authenticated, service_role;

-- 8k. The landlord declines WITH a reason the tenant sees (Q46).
CREATE OR REPLACE FUNCTION public.rentals_decline_request(p_request_id uuid, p_reason_code text, p_reason_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_tenant uuid;
  v_text text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_leak text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('handle_myself', 'not_my_responsibility', 'already_scheduled', 'other') THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code = 'other' AND char_length(coalesce(v_text, '')) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_text, '')) > 500 THEN
    RAISE EXCEPTION 'too_long' USING ERRCODE = '22023';
  END IF;
  IF v_text IS NOT NULL THEN
    v_leak := public.contact_leak_reason(v_text);
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
    END IF;
  END IF;
  UPDATE public.maintenance_requests
     SET status = 'declined', decline_reason_code = p_reason_code, decline_reason_text = v_text,
         decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND landlord_id = v_uid AND status = 'submitted'
  RETURNING tenant_id INTO v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.rentals_notify(v_tenant, 'Request answered',
    'Your landlord answered your maintenance request. Tap to see their reason.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_decline_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_decline_request(uuid, text, text) TO authenticated, service_role;

-- 8l. The tenant withdraws a request nobody has decided yet.
CREATE OR REPLACE FUNCTION public.rentals_withdraw_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.maintenance_requests SET status = 'withdrawn', decided_at = now(), updated_at = now()
   WHERE id = p_request_id AND tenant_id = v_uid AND status = 'submitted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_withdraw_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_withdraw_request(uuid) TO authenticated, service_role;

-- 8m. Point an approved request at the job the landlord just posted from it
--     (link_str_turnover_job's rules, 20261007145950): the caller's OPEN job,
--     one request per job, a FUNDED link is never re-pointed.
CREATE OR REPLACE FUNCTION public.link_maintenance_request_job(p_request_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cur uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- FOR UPDATE: every link to one job serializes here, so two requests racing
  -- for the same job get true/false, never a raw unique violation (review #7).
  PERFORM 1 FROM public.jobs j
   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  SELECT r.job_id INTO v_cur FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.landlord_id = v_uid AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.maintenance_requests o WHERE o.job_id = p_job_id AND o.id <> p_request_id) THEN
    RETURN false;
  END IF;
  -- A funded job, or one whose checkout is in flight (a Stripe session
  -- exists and may still complete), is never re-pointed: re-pointing it
  -- would let the same repair be paid twice (lh-money-escrow review #2).
  IF v_cur IS NOT NULL AND v_cur <> p_job_id AND EXISTS (
       SELECT 1 FROM public.jobs cur
        WHERE cur.id = v_cur AND cur.status <> 'cancelled'
          AND (cur.payment_status IN ('escrow', 'payout_pending', 'released')
               OR (cur.payment_status IN ('unpaid', 'cancelling') AND cur.stripe_session_id IS NOT NULL))
        FOR SHARE) THEN
    RETURN false;
  END IF;
  UPDATE public.maintenance_requests SET job_id = p_job_id, updated_at = now() WHERE id = p_request_id;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.link_maintenance_request_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_maintenance_request_job(uuid, uuid) TO authenticated, service_role;

-- 8n. "Was it fixed?" (Q42): the tenant answers once the linked job's work
--     has started; the landlord sees it before confirming and paying through
--     the normal job completion. Re-answerable (the latest answer counts).
CREATE OR REPLACE FUNCTION public.rentals_tenant_answer_fixed(p_request_id uuid, p_fixed boolean, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_landlord uuid;
  v_job uuid;
  v_leak text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_fixed IS NULL THEN
    RAISE EXCEPTION 'answer_required' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 500 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_note, '')), '') IS NOT NULL THEN
    v_leak := public.contact_leak_reason(p_note);
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'contact_info_not_allowed' USING ERRCODE = '22023', DETAIL = v_leak;
    END IF;
  END IF;
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved';
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Race class (check-race-class): the job's status decides this write, so the
  -- job row is held FOR SHARE until commit (a cancel or reopen waits). Job
  -- first, then the request, the same order link_maintenance_request_job takes,
  -- so the two never deadlock; the request is re-read under its lock and must
  -- still point at the job that was checked.
  PERFORM 1 FROM public.jobs j WHERE j.id = v_job
     AND j.status IN ('in_progress', 'pending_approval', 'completed', 'revision_requested', 'disputed')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT r.landlord_id INTO v_landlord FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved' AND r.job_id = v_job
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.maintenance_requests
     SET tenant_says_fixed = p_fixed, tenant_fixed_note = nullif(btrim(coalesce(p_note, '')), ''),
         tenant_answered_at = now(), updated_at = now()
   WHERE id = p_request_id;
  PERFORM public.rentals_notify(v_landlord,
    CASE WHEN p_fixed THEN 'Tenant says it''s fixed' ELSE 'Tenant says it''s NOT fixed' END,
    'Your tenant answered "Was it fixed?". Check before you confirm the job.',
    '/rentals/requests/' || p_request_id::text, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_tenant_answer_fixed(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_tenant_answer_fixed(uuid, boolean, text) TO authenticated, service_role;

-- 8o. The linked job's state, for the request screen (lh-money-escrow review
--     #1): the tenant cannot read an unpaid job through RLS, and "a job id is
--     set" is not "booked" (the link is written before payment). Only the
--     request's tenant or landlord gets an answer; 'booked' = funded and not
--     cancelled, 'refunding' = money going back, 'paying' = checkout in
--     flight, 'none' = nothing live (no
--     job, cancelled, failed, abandoned, refunded, unpaid with no session):
--     the landlord may post again.
CREATE OR REPLACE FUNCTION public.rentals_request_job_state(p_request_id uuid)
RETURNS TABLE (job_id uuid, booking text, job_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.job_id,
           CASE
             WHEN j.id IS NULL THEN 'none'
             WHEN j.payment_status = 'cancelling' THEN 'refunding'
             WHEN j.status::text = 'cancelled' THEN 'none'
             WHEN j.payment_status IN ('escrow', 'payout_pending', 'released') THEN 'booked'
             WHEN j.payment_status = 'unpaid' AND j.stripe_session_id IS NOT NULL THEN 'paying'
             ELSE 'none'
           END,
           j.status::text
      FROM public.maintenance_requests r
      LEFT JOIN public.jobs j ON j.id = r.job_id
     WHERE r.id = p_request_id AND (r.tenant_id = v_uid OR r.landlord_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_request_job_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_request_job_state(uuid) TO authenticated, service_role;

-- 8p. The homes the caller rents: name and address only (review #2).
CREATE OR REPLACE FUNCTION public.rentals_my_homes()
RETURNS TABLE (tenancy_id uuid, property_id uuid, unit_id uuid, label text, unit_label text,
               street_address text, city text, zip_code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, p.id, u.id, p.label, u.label, p.street_address, p.city, p.zip_code
      FROM public.rental_tenancies t
      JOIN public.rental_properties p ON p.id = t.property_id
      JOIN public.rental_units u ON u.id = t.unit_id
     WHERE t.tenant_id = v_uid AND t.status = 'active'
     ORDER BY t.accepted_at DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_my_homes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_homes() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8q. Submitted files stay put (review #3): the user-documents UPDATE/DELETE
--     policies refuse any object is_submitted_credential_object() names. The
--     live body (md5 69e0bf1fd86cdd28714fe3b7938bdeaa of prosrc, read
--     2026-10-15) restated verbatim, plus two branches: a property's ownership
--     proof once it is sent for review or approved, and every photo attached
--     to a maintenance request (the request is a record, Q46). Account purge
--     runs as service_role and is unaffected. Grants restated as live
--     (authenticated + service_role).
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
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.is_submitted_credential_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_credential_object(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Storage: the landlord reads the photos of requests sent to them (the
--    tenant's own folder is already theirs under the existing owner policy;
--    admins already read user-documents).
DROP POLICY IF EXISTS "user-documents: landlord reads maintenance photos" ON storage.objects;
CREATE POLICY "user-documents: landlord reads maintenance photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND EXISTS (
      SELECT 1 FROM public.maintenance_request_photos ph
        JOIN public.maintenance_requests r ON r.id = ph.request_id
       WHERE ph.storage_path = storage.objects.name
         AND r.landlord_id = (SELECT auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 10. Download My Data (Q290 / Declutter B9 lesson: the export ships in the
--     same slice). The newest definition on the base
--     (20261015052622_export_my_data_category_suggestions, which carries the
--     trades 'category_suggestions' section) verbatim, plus the five Rentals
--     sections before RETURN (request photos are the tenant's files: exported
--     to the tenant, who took them). LANDING ORDER: a later restatement must
--     carry both category_suggestions and these five sections.
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Rentals S1 (20261015061259): the caller's properties, units, tenancies
  -- (as landlord or tenant), maintenance requests and their photos.
  v_out := v_out || jsonb_build_object('rental_properties', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ownership_reviewed_by'), '[]'::jsonb) FROM public.rental_properties t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_units', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.rental_units t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('rental_tenancies', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'invite_token_sha256'), '[]'::jsonb) FROM public.rental_tenancies t
      WHERE t.landlord_id = v_uid OR t.tenant_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_requests t
      WHERE t.tenant_id = v_uid OR t.landlord_id = v_uid));
  v_out := v_out || jsonb_build_object('maintenance_request_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.maintenance_request_photos t
      WHERE t.tenant_id = v_uid));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Q807: every public table carries the unconfirmed-email statement gate
-- (zz_refuse_unconfirmed_email_write). The five Rentals tables are written only
-- by the SECURITY DEFINER RPCs above, and the trigger fires on those writes too,
-- so a session whose email is unconfirmed cannot file, approve or invite.
-- Server contexts (service_role account deletion, pg_cron) carry no end-user
-- sub and pass. Idempotent: attaches only where the trigger is missing.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

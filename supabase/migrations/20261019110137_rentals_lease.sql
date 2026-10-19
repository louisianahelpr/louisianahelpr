-- HOMES: the lease, from OUR Louisiana template only (owner D4, 2026-10-18; template
-- docs/specs/lease-template-draft.md APPROVED AS WRITTEN 2026-10-18 ~20:05Z). No upload.
--
-- Flow: the landlord fills the template's blanks for a live tenancy, then signs and sends it: a typed
-- name, agreement to sign electronically and a tick for each clause the template has both sides
-- INITIAL. The tenant reviews it and either signs the same way (R.S. 9:2605/9:2607 and the lease's own
-- section 21) or asks for changes (it goes back to the landlord, unsigned). A signed lease is final and
-- belongs to BOTH people: it outlives the tenancy and either account (lead review #6). Both download the
-- same PDF, made from the stored record (template version + filled blanks + signatures).
--
--   rental_leases  one row per lease. At most one OPEN lease (draft or sent) per tenancy; signed leases
--                  stay (a renewal is a new lease). The template text ships in the app, versioned
--                  (src/lib/rentals/leaseTemplate.ts; a version's text never changes, pinned by
--                  src/test/rentalsLeaseTemplate.test.ts). The landlord's app sends the sha256 of the
--                  exact text it showed TOGETHER with the blanks and version it hashed; the server
--                  refuses unless they are the stored ones (lead review #1). The tenant's app sends the
--                  sent_at it read and the same hash: both signed the same words (lease_changed otherwise).
--                  Blanks are printable ASCII (the app normalises curly quotes, dashes and accents; the
--                  PDF's fonts are Latin-1; lead review #4), and every required blank is filled before it
--                  can be sent (rentals_lease_missing, lead review #9).
--
--   rentals_lease(tenancy)                                     either side (read; a draft is only a flag
--                                                              for the tenant, lead review #8)
--   rentals_my_leases()                                        every signed lease the caller is a party to,
--                                                              live, ended or deleted tenancy (lead review #2)
--   rentals_lease_save(tenancy, version, fields)               landlord: create or update the open draft
--   rentals_lease_send(lease, version, fields, sha256, name, consent, initials)
--                                                              landlord: sign and send the draft
--   rentals_lease_withdraw(lease)                              landlord: take back a sent, unsigned lease
--   rentals_lease_discard(lease)                               landlord: delete a draft
--   rentals_lease_request_changes(lease, note)                 tenant: send it back, unsigned
--   rentals_lease_sign(lease, sent_at, sha256, name, consent, initials)
--                                                              tenant: sign; final
--
-- Rules: the 'rentals' switch, is_caller_banned and rentals_assert_member on every write; the tenancy's
-- own landlord or tenant only; writes only while the tenancy is live; no client reads or writes the
-- table (a draft is the landlord's until sent). Replay-safe. Proof: src/test/pglite/homesLease.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. The table.
CREATE TABLE IF NOT EXISTS public.rental_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL: a signed lease outlives its tenancy (an unsigned one is deleted with it, trigger below).
  tenancy_id uuid REFERENCES public.rental_tenancies(id) ON DELETE SET NULL,
  -- The two parties, kept on the lease itself so each keeps it after the tenancy or the other's account
  -- is gone (lead review #6). SET NULL when that person deletes their own account.
  landlord_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The home in words, taken when the lease is sent (the property may be deleted later).
  home_label text CHECK (home_label IS NULL OR char_length(home_label) <= 400),
  template_version text NOT NULL CHECK (template_version ~ '^la-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  -- The template's blanks and choices: { key: text | boolean }. Keys, sizes and ASCII are checked by rentals_lease_save.
  fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object' AND octet_length(fields::text) <= 65536),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed')),
  -- The tenant's note when they sent it back for changes (kept until the landlord sends again).
  change_request text CHECK (change_request IS NULL OR char_length(change_request) BETWEEN 3 AND 1000),
  body_sha256 text CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
  -- The server's own fingerprint of the stored blanks when the lease was sent (sha256 of version + fields).
  -- The text hash (body_sha256) can only be computed by the app, which renders the template; the server
  -- binds it to these exact blanks: sign refuses unless the blanks still have this fingerprint AND the
  -- tenant's app, rendering the same stored blanks itself, produced the same text hash (lead review round 2 #2).
  blanks_sha256 text CHECK (blanks_sha256 IS NULL OR blanks_sha256 ~ '^[0-9a-f]{64}$'),
  landlord_signed_name text CHECK (landlord_signed_name IS NULL OR char_length(landlord_signed_name) BETWEEN 2 AND 120),
  landlord_signed_at timestamptz,
  -- When each side agreed to sign electronically, and the clauses each one initialed (lead review #3).
  landlord_consent_at timestamptz,
  landlord_initials text[] NOT NULL DEFAULT '{}',
  tenant_signed_name text CHECK (tenant_signed_name IS NULL OR char_length(tenant_signed_name) BETWEEN 2 AND 120),
  tenant_signed_at timestamptz,
  tenant_consent_at timestamptz,
  tenant_initials text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_leases_draft CHECK (status <> 'draft' OR (body_sha256 IS NULL AND blanks_sha256 IS NULL AND landlord_signed_name IS NULL AND landlord_signed_at IS NULL
                                                              AND landlord_consent_at IS NULL AND landlord_initials = '{}'
                                                              AND tenant_signed_name IS NULL AND tenant_signed_at IS NULL AND tenant_consent_at IS NULL
                                                              AND tenant_initials = '{}' AND sent_at IS NULL)),
  CONSTRAINT rental_leases_sent CHECK (status <> 'sent' OR (body_sha256 IS NOT NULL AND blanks_sha256 IS NOT NULL AND landlord_signed_name IS NOT NULL AND landlord_signed_at IS NOT NULL
                                                            AND landlord_consent_at IS NOT NULL AND sent_at IS NOT NULL AND tenant_signed_at IS NULL)),
  CONSTRAINT rental_leases_signed CHECK (status <> 'signed' OR (body_sha256 IS NOT NULL AND landlord_signed_at IS NOT NULL AND landlord_consent_at IS NOT NULL
                                                                AND tenant_signed_name IS NOT NULL AND tenant_signed_at IS NOT NULL
                                                                AND tenant_consent_at IS NOT NULL)),
  -- Only a signed lease may lose its tenancy.
  CONSTRAINT rental_leases_open_has_tenancy CHECK (status = 'signed' OR tenancy_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS rental_leases_tenancy_idx ON public.rental_leases (tenancy_id);
CREATE INDEX IF NOT EXISTS rental_leases_landlord_idx ON public.rental_leases (landlord_id);
CREATE INDEX IF NOT EXISTS rental_leases_tenant_idx ON public.rental_leases (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS rental_leases_one_open ON public.rental_leases (tenancy_id) WHERE status IN ('draft', 'sent');
ALTER TABLE public.rental_leases ENABLE ROW LEVEL SECURITY;
-- Q807: the table refuses a write from a session whose email is not confirmed.
SELECT public.attach_unconfirmed_email_gate();
REVOKE ALL ON TABLE public.rental_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rental_leases TO service_role;
COMMENT ON TABLE public.rental_leases IS
  'Homes D4 lease (20261019110137): our Louisiana template only. Read through rentals_lease / rentals_my_leases; written by its RPCs. A signed lease is final and outlives its tenancy and either account.';

-- A signed lease never changes. The only updates it takes are the foreign keys' own SET NULL (its tenancy
-- deleted, or one party deleting their account). It is deleted only once BOTH parties are gone.
CREATE OR REPLACE FUNCTION public.rentals_lease_signed_is_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.status = 'signed' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.landlord_id IS NULL AND OLD.tenant_id IS NULL THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'lease_signed_is_final' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'tenancy_id' - 'landlord_id' - 'tenant_id' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(OLD) - 'tenancy_id' - 'landlord_id' - 'tenant_id' - 'updated_at')
       OR (NEW.tenancy_id IS DISTINCT FROM OLD.tenancy_id AND NEW.tenancy_id IS NOT NULL)
       OR (NEW.landlord_id IS DISTINCT FROM OLD.landlord_id AND NEW.landlord_id IS NOT NULL)
       OR (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NEW.tenant_id IS NOT NULL) THEN
      RAISE EXCEPTION 'lease_signed_is_final' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_signed_is_final() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_leases_signed_is_final ON public.rental_leases;
CREATE TRIGGER rental_leases_signed_is_final BEFORE UPDATE OR DELETE ON public.rental_leases
  FOR EACH ROW EXECUTE FUNCTION public.rentals_lease_signed_is_final();

-- A lease that belongs to no one goes (see the rule inside).
CREATE OR REPLACE FUNCTION public.rentals_lease_drop_orphan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- An unsigned lease missing either party, or a signed one missing both, belongs to no one: it goes.
  IF (NEW.status <> 'signed' AND (NEW.landlord_id IS NULL OR NEW.tenant_id IS NULL))
     OR (NEW.landlord_id IS NULL AND NEW.tenant_id IS NULL) THEN
    DELETE FROM public.rental_leases WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_drop_orphan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_leases_drop_orphan ON public.rental_leases;
CREATE TRIGGER rental_leases_drop_orphan AFTER UPDATE OF landlord_id, tenant_id ON public.rental_leases
  FOR EACH ROW EXECUTE FUNCTION public.rentals_lease_drop_orphan();

-- A tenancy deleted (its property, unit or landlord account deleted) takes its UNSIGNED leases with it;
-- its signed leases stay with both people (tenancy_id SET NULL).
CREATE OR REPLACE FUNCTION public.rentals_lease_tenancy_deleted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  DELETE FROM public.rental_leases WHERE tenancy_id = OLD.id AND status <> 'signed';
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_tenancy_deleted() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_tenancies_lease_cleanup ON public.rental_tenancies;
CREATE TRIGGER rental_tenancies_lease_cleanup BEFORE DELETE ON public.rental_tenancies
  FOR EACH ROW EXECUTE FUNCTION public.rentals_lease_tenancy_deleted();

-- Round 2 #1 (retention): a tenancy that ENDS takes its unsigned leases with it. Signed leases are untouched.
--   * Either side ends it (rentals_end_tenancy): an UPDATE of status, so this trigger fires.
--   * The tenant deletes their account: the FK sets tenant_id NULL and rentals_end_tenancy_on_tenant_delete
--     (a BEFORE trigger) ends the tenancy in that same UPDATE; the UPDATE lists tenant_id, not status, so
--     this trigger also listens on tenant_id. The lease's own tenant_id going NULL is caught a second time
--     by rentals_lease_drop_orphan (an unsigned lease missing a party goes).
CREATE OR REPLACE FUNCTION public.rentals_lease_tenancy_ended()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('ended', 'revoked') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.rental_leases WHERE tenancy_id = NEW.id AND status <> 'signed';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_tenancy_ended() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rental_tenancies_lease_ended ON public.rental_tenancies;
CREATE TRIGGER rental_tenancies_lease_ended AFTER UPDATE OF status, tenant_id ON public.rental_tenancies
  FOR EACH ROW EXECUTE FUNCTION public.rentals_lease_tenancy_ended();

-- ---------------------------------------------------------------------------
-- 2. What the template needs (server only). Mirrors LEASE_FIELDS in src/lib/rentals/leaseTemplate.ts;
--    src/test/rentalsLeaseRequired.test.ts holds the two lists equal, both ways.
--    Each row: the blank, whether it is a yes/no, and up to two conditions (blank = value) under which
--    it is asked at all.
CREATE OR REPLACE FUNCTION public.rentals_lease_missing(p_version text, p_fields jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_version IS DISTINCT FROM 'la-2026-10-14' OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN ARRAY['template_version']
  ELSE COALESCE((
    SELECT array_agg(r.key ORDER BY r.key)
      FROM (VALUES
        -- la-2026-10-14 REQUIRED BEGIN
        ('lease_date', false, NULL, NULL, NULL, NULL), ('landlord_name', false, NULL, NULL, NULL, NULL),
        ('tenant_names', false, NULL, NULL, NULL, NULL), ('home_address', false, NULL, NULL, NULL, NULL),
        ('home_type', false, NULL, NULL, NULL, NULL), ('bedrooms', false, NULL, NULL, NULL, NULL),
        ('bathrooms', false, NULL, NULL, NULL, NULL), ('home_includes', false, NULL, NULL, NULL, NULL),
        ('term_kind', false, NULL, NULL, NULL, NULL), ('start_date', false, NULL, NULL, NULL, NULL),
        ('end_date', false, 'term_kind', 'fixed', NULL, NULL),
        ('monthly_notice_days', false, NULL, NULL, NULL, NULL), ('early_move_in', true, NULL, NULL, NULL, NULL),
        ('early_move_in_date', false, 'early_move_in', 'true', NULL, NULL), ('early_move_in_rent', false, 'early_move_in', 'true', NULL, NULL),
        ('rent_amount', false, NULL, NULL, NULL, NULL), ('rent_due_day', false, NULL, NULL, NULL, NULL),
        ('pay_methods', false, NULL, NULL, NULL, NULL), ('payee', false, NULL, NULL, NULL, NULL),
        ('first_rent_amount', false, NULL, NULL, NULL, NULL), ('first_rent_due', false, NULL, NULL, NULL, NULL),
        ('partial_month', false, NULL, NULL, NULL, NULL), ('late_after_day', false, NULL, NULL, NULL, NULL),
        ('late_fee', false, NULL, NULL, NULL, NULL), ('daily_late', true, NULL, NULL, NULL, NULL),
        ('daily_late_amount', false, 'daily_late', 'true', NULL, NULL),
        ('late_fee_cap', false, NULL, NULL, NULL, NULL), ('returned_payment_fee', false, NULL, NULL, NULL, NULL),
        ('deposit_amount', false, NULL, NULL, NULL, NULL), ('deposit_due', false, NULL, NULL, NULL, NULL),
        ('tenant_utilities', false, NULL, NULL, NULL, NULL), ('landlord_utilities', false, NULL, NULL, NULL, NULL),
        ('occupants', false, NULL, NULL, NULL, NULL), ('guest_days_row', false, NULL, NULL, NULL, NULL),
        ('guest_days_six_months', false, NULL, NULL, NULL, NULL), ('emergency_contact', false, NULL, NULL, NULL, NULL),
        ('furnishings', false, NULL, NULL, NULL, NULL), ('appliances', false, NULL, NULL, NULL, NULL),
        ('tenant_supplies', false, NULL, NULL, NULL, NULL), ('as_is', true, NULL, NULL, NULL, NULL),
        ('as_is_items', false, 'as_is', 'true', NULL, NULL),
        ('checklist_days', false, NULL, NULL, NULL, NULL), ('pets_allowed', true, NULL, NULL, NULL, NULL),
        ('pet_list', false, 'pets_allowed', 'true', NULL, NULL), ('pet_max', false, 'pets_allowed', 'true', NULL, NULL),
        ('pet_weight_limit', false, 'pets_allowed', 'true', NULL, NULL), ('pet_fee', false, 'pets_allowed', 'true', NULL, NULL),
        ('pet_deposit', false, 'pets_allowed', 'true', NULL, NULL), ('pet_rent', false, 'pets_allowed', 'true', NULL, NULL),
        ('no_smoking_property', true, NULL, NULL, NULL, NULL), ('picture_hooks_ok', true, NULL, NULL, NULL, NULL),
        ('extra_rules', false, NULL, NULL, NULL, NULL), ('ac_landlord', true, NULL, NULL, NULL, NULL),
        ('lawn', false, NULL, NULL, NULL, NULL), ('filter_days', false, NULL, NULL, NULL, NULL),
        ('filters_supplied', true, NULL, NULL, NULL, NULL), ('pest_control', false, NULL, NULL, NULL, NULL),
        ('detector_locations', false, NULL, NULL, NULL, NULL), ('entry_notice_hours', false, NULL, NULL, NULL, NULL),
        ('key_count', false, NULL, NULL, NULL, NULL), ('key_cost', false, NULL, NULL, NULL, NULL),
        ('landlord_contact', false, NULL, NULL, NULL, NULL), ('tenant_contact', false, NULL, NULL, NULL, NULL),
        ('landlord_address', false, NULL, NULL, NULL, NULL), ('sale_ends_lease', true, NULL, NULL, NULL, NULL),
        ('sale_notice_days', false, 'sale_ends_lease', 'true', NULL, NULL),
        ('early_exit', true, NULL, NULL, NULL, NULL),
        ('early_exit_days', false, 'early_exit', 'true', NULL, NULL), ('early_exit_fee', false, 'early_exit', 'true', NULL, NULL),
        ('insurance', false, NULL, NULL, NULL, NULL),
        ('insurance_liability', false, 'insurance', 'required', NULL, NULL), ('insurance_proof_due', false, 'insurance', 'required', NULL, NULL),
        ('accelerate', true, NULL, NULL, NULL, NULL), ('notice_waiver', true, NULL, NULL, NULL, NULL),
        ('federal_mortgage', true, NULL, NULL, NULL, NULL), ('holdover_amount', false, NULL, NULL, NULL, NULL),
        ('assume_condition', true, NULL, NULL, NULL, NULL), ('additional_terms', false, NULL, NULL, NULL, NULL),
        ('built_before_1978', true, NULL, NULL, NULL, NULL),
        ('lead_known', false, 'built_before_1978', 'true', NULL, NULL),
        ('lead_details', false, 'built_before_1978', 'true', 'lead_known', 'known'),
        ('lead_records', false, 'built_before_1978', 'true', NULL, NULL),
        ('lead_records_list', false, 'built_before_1978', 'true', 'lead_records', 'provided'),
        ('foreclosure', false, NULL, NULL, NULL, NULL), ('foreclosure_details', false, 'foreclosure', 'pending', NULL, NULL),
        ('flood_disclosure', true, NULL, NULL, NULL, NULL),
        ('flood_zone', false, 'flood_disclosure', 'true', NULL, NULL), ('flood_source', false, 'flood_disclosure', 'true', NULL, NULL),
        ('flooded_before', false, 'flood_disclosure', 'true', NULL, NULL),
        ('flooded_details', false, 'flood_disclosure', 'true', 'flooded_before', 'Yes'),
        ('mold', false, 'flood_disclosure', 'true', NULL, NULL),
        ('mold_details', false, 'flood_disclosure', 'true', 'mold', 'Yes')
        -- la-2026-10-14 REQUIRED END
      ) AS r(key, is_yes, c1_key, c1_val, c2_key, c2_val)
     WHERE (r.c1_key IS NULL OR p_fields ->> r.c1_key = r.c1_val)
       AND (r.c2_key IS NULL OR p_fields ->> r.c2_key = r.c2_val)
       AND CASE WHEN r.is_yes THEN jsonb_typeof(p_fields -> r.key) IS DISTINCT FROM 'boolean'
                ELSE COALESCE(btrim(p_fields ->> r.key), '') = '' END), '{}'::text[]) END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_missing(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_missing(text, jsonb) TO service_role;

-- The clauses the template has both sides INITIAL, when chosen (sorted): the as-is appliances (section 8),
-- the waiver of notice to vacate (19), the tenant taking on the home's condition (24), the lead-paint
-- disclosure (Addendum 1). Mirrors INITIALED in src/components/rentals/LeasePanel.tsx (same test).
CREATE OR REPLACE FUNCTION public.rentals_lease_initial_keys(p_fields jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(array_agg(k ORDER BY k), '{}'::text[])
    FROM unnest(ARRAY['as_is', 'assume_condition', 'built_before_1978', 'notice_waiver']) AS k
   WHERE p_fields -> k = 'true'::jsonb;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_initial_keys(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_initial_keys(jsonb) TO service_role;

-- The server's fingerprint of a lease's blanks (version + fields as stored). jsonb text is canonical.
CREATE OR REPLACE FUNCTION public.rentals_lease_blanks_sha256(p_version text, p_fields jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT encode(sha256(convert_to(COALESCE(p_version, '') || E'\n' || COALESCE(p_fields::text, ''), 'UTF8')), 'hex');
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_blanks_sha256(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_blanks_sha256(text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Read: the open lease (a draft's blanks only to the landlord; for the tenant a draft is a status and
--    their own change note, nothing else) and every signed lease of this tenancy.
CREATE OR REPLACE FUNCTION public.rentals_lease_signed_json(l public.rental_leases, p_uid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'id', l.id, 'tenancy_id', l.tenancy_id, 'side', CASE WHEN l.landlord_id = p_uid THEN 'landlord' ELSE 'tenant' END,
    'home_label', l.home_label, 'template_version', l.template_version, 'fields', l.fields, 'body_sha256', l.body_sha256,
    'landlord_signed_name', l.landlord_signed_name, 'landlord_signed_at', l.landlord_signed_at, 'landlord_consent_at', l.landlord_consent_at,
    'landlord_initials', to_jsonb(l.landlord_initials),
    'tenant_signed_name', l.tenant_signed_name, 'tenant_signed_at', l.tenant_signed_at, 'tenant_consent_at', l.tenant_consent_at,
    'tenant_initials', to_jsonb(l.tenant_initials), 'sent_at', l.sent_at);
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_signed_json(public.rental_leases, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_signed_json(public.rental_leases, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_lease(p_tenancy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_side text;
  v_open public.rental_leases%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id;
  v_side := CASE WHEN v_t.landlord_id = v_uid THEN 'landlord' WHEN v_t.tenant_id = v_uid THEN 'tenant' END;
  IF v_side IS NULL OR v_t.status NOT IN ('active', 'ended') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_open FROM public.rental_leases WHERE tenancy_id = p_tenancy_id AND status IN ('draft', 'sent');
  RETURN jsonb_build_object(
    'side', v_side,
    'tenancy_status', v_t.status,
    'can_edit', v_side = 'landlord' AND v_t.status = 'active',
    'open', CASE
      WHEN v_open.id IS NULL THEN NULL
      -- Lead review #8: the tenant learns only that a lease is being prepared (and their own note).
      WHEN v_side = 'tenant' AND v_open.status = 'draft' THEN jsonb_build_object('status', 'draft', 'change_request', v_open.change_request)
      ELSE jsonb_build_object(
        'id', v_open.id,
        'status', v_open.status,
        'template_version', v_open.template_version,
        'fields', v_open.fields,
        'change_request', v_open.change_request,
        'body_sha256', v_open.body_sha256,
        'landlord_signed_name', v_open.landlord_signed_name,
        'landlord_signed_at', v_open.landlord_signed_at,
        'landlord_initials', to_jsonb(v_open.landlord_initials),
        'sent_at', v_open.sent_at,
        'updated_at', v_open.updated_at) END,
    'signed', (SELECT coalesce(jsonb_agg(public.rentals_lease_signed_json(l, v_uid) ORDER BY l.tenant_signed_at DESC), '[]'::jsonb)
      FROM public.rental_leases l WHERE l.tenancy_id = p_tenancy_id AND l.status = 'signed'
       AND (l.landlord_id = v_uid OR l.tenant_id = v_uid)));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease(uuid) TO authenticated, service_role;

-- Every signed lease the caller is a party to, whatever happened to the tenancy since (lead review #2).
CREATE OR REPLACE FUNCTION public.rentals_my_leases()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(public.rentals_lease_signed_json(l, v_uid) ORDER BY l.tenant_signed_at DESC), '[]'::jsonb)
            FROM public.rental_leases l WHERE l.status = 'signed' AND (l.landlord_id = v_uid OR l.tenant_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_my_leases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_leases() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The landlord saves the draft (creates it on first save). A sent lease must be taken back first.
CREATE OR REPLACE FUNCTION public.rentals_lease_save(p_tenancy_id uuid, p_template_version text, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_open public.rental_leases%ROWTYPE;
  v_bad integer;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Blanks: an object of at most 300 keys (lower-case words), each a boolean or printable-ASCII text up to
  -- 4000 characters (the app normalises curly quotes, dashes and accents first; lead review #4).
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR octet_length(p_fields::text) > 65536
     OR p_template_version IS NULL OR p_template_version !~ '^la-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'bad_lease_fields' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) FILTER (WHERE e.key !~ '^[a-z][a-z0-9_]{0,39}$'
                             OR jsonb_typeof(e.value) NOT IN ('string', 'boolean')
                             OR (jsonb_typeof(e.value) = 'string' AND (char_length(e.value #>> '{}') > 4000
                                                                       OR (e.value #>> '{}') ~ '[^\x20-\x7E\n]'))) + greatest(count(*) - 300, 0)
    INTO v_bad FROM jsonb_each(p_fields) e;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'bad_lease_fields' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_open FROM public.rental_leases WHERE tenancy_id = p_tenancy_id AND status IN ('draft', 'sent') FOR UPDATE;
  IF v_open.status = 'sent' THEN
    RAISE EXCEPTION 'lease_awaiting_signature' USING ERRCODE = '22023';
  END IF;
  IF v_open.id IS NULL THEN
    INSERT INTO public.rental_leases (tenancy_id, landlord_id, tenant_id, template_version, fields)
    VALUES (p_tenancy_id, v_t.landlord_id, v_t.tenant_id, p_template_version, p_fields) RETURNING id INTO v_id;
  ELSE
    UPDATE public.rental_leases SET template_version = p_template_version, fields = p_fields, updated_at = now()
     WHERE id = v_open.id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_save(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_save(uuid, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. One lock-and-check for the lease actions: the open lease, its live tenancy, the caller's side.
CREATE OR REPLACE FUNCTION public.rentals_lease_for_action(p_lease_id uuid, p_side text, p_status text)
RETURNS public.rental_leases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_leases%ROWTYPE;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  -- Lock order tenancy -> lease, the same as rentals_lease_save (no deadlock between a save and an action).
  SELECT * INTO v_t FROM public.rental_tenancies
   WHERE id = (SELECT l.tenancy_id FROM public.rental_leases l WHERE l.id = p_lease_id) FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_l FROM public.rental_leases WHERE id = p_lease_id FOR UPDATE;
  END IF;
  IF v_l.id IS NULL OR v_t.status IS DISTINCT FROM 'active'
     OR (p_side = 'landlord' AND v_t.landlord_id IS DISTINCT FROM v_uid)
     OR (p_side = 'tenant' AND v_t.tenant_id IS DISTINCT FROM v_uid)
     -- The tenant never learns a draft's id is real.
     OR (p_side = 'tenant' AND v_l.status = 'draft') THEN
    RAISE EXCEPTION 'lease_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'lease_not_open' USING ERRCODE = '22023';
  END IF;
  RETURN v_l;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_for_action(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_for_action(uuid, text, text) TO service_role;

-- A typed signature: 2-120 printable ASCII characters after tidying spaces (the app normalises first).
CREATE OR REPLACE FUNCTION public.rentals_lease_signature(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
BEGIN
  IF char_length(v_name) NOT BETWEEN 2 AND 120 OR v_name ~ '[^\x20-\x7E]' THEN
    RAISE EXCEPTION 'bad_signature' USING ERRCODE = '22023';
  END IF;
  RETURN v_name;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_signature(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lease_signature(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The landlord signs and sends the draft. The app sends the version and blanks it hashed with the hash;
--    they must be the stored ones (lead review #1), every required blank filled (#9), consent given and
--    each initialed clause ticked (#3).
CREATE OR REPLACE FUNCTION public.rentals_lease_send(p_lease_id uuid, p_template_version text, p_fields jsonb, p_body_sha256 text,
                                                     p_signed_name text, p_consent boolean, p_initials text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_leases%ROWTYPE;
  v_name text;
  v_t public.rental_tenancies%ROWTYPE;
  v_home text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_l := public.rentals_lease_for_action(p_lease_id, 'landlord', 'draft');
  IF p_template_version IS DISTINCT FROM v_l.template_version OR p_fields IS NULL OR p_fields IS DISTINCT FROM v_l.fields THEN
    RAISE EXCEPTION 'lease_changed' USING ERRCODE = '22023';
  END IF;
  IF p_body_sha256 IS NULL OR p_body_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'bad_lease_fields' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.rentals_lease_missing(v_l.template_version, v_l.fields)) > 0 THEN
    RAISE EXCEPTION 'lease_incomplete' USING ERRCODE = '22023';
  END IF;
  IF p_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'lease_consent_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}'::text[]) FROM unnest(COALESCE(p_initials, '{}'::text[])) k)
       IS DISTINCT FROM public.rentals_lease_initial_keys(v_l.fields) THEN
    RAISE EXCEPTION 'lease_initials_required' USING ERRCODE = '22023';
  END IF;
  v_name := public.rentals_lease_signature(p_signed_name);
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_l.tenancy_id;
  SELECT left(p.label || COALESCE(', ' || NULLIF(u.label, ''), '') || ' (' || p.street_address || ', ' || p.city || ' ' || p.zip_code || ')', 400)
    INTO v_home
    FROM public.rental_properties p LEFT JOIN public.rental_units u ON u.id = v_t.unit_id
   WHERE p.id = v_t.property_id;
  UPDATE public.rental_leases
     SET status = 'sent', body_sha256 = p_body_sha256, blanks_sha256 = public.rentals_lease_blanks_sha256(v_l.template_version, v_l.fields),
         landlord_signed_name = v_name, landlord_signed_at = now(),
         landlord_consent_at = now(), landlord_initials = public.rentals_lease_initial_keys(v_l.fields),
         landlord_id = v_t.landlord_id, tenant_id = v_t.tenant_id, home_label = v_home,
         sent_at = clock_timestamp(), change_request = NULL, updated_at = now()
   WHERE id = v_l.id;
  PERFORM public.rentals_notify(v_t.tenant_id, 'Lease ready to sign',
    'Your landlord signed your lease and sent it to you. Read it and sign it under Homes.', '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_send(uuid, text, jsonb, text, text, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_send(uuid, text, jsonb, text, text, boolean, text[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The landlord takes back a sent lease the tenant has not signed (to change it). Their signature goes.
CREATE OR REPLACE FUNCTION public.rentals_lease_withdraw(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_leases%ROWTYPE;
  v_tenant uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_l := public.rentals_lease_for_action(p_lease_id, 'landlord', 'sent');
  UPDATE public.rental_leases
     SET status = 'draft', body_sha256 = NULL, blanks_sha256 = NULL, landlord_signed_name = NULL, landlord_signed_at = NULL, landlord_consent_at = NULL,
         landlord_initials = '{}', sent_at = NULL, updated_at = now()
   WHERE id = v_l.id;
  SELECT tenant_id INTO v_tenant FROM public.rental_tenancies WHERE id = v_l.tenancy_id;
  PERFORM public.rentals_notify(v_tenant, 'Lease taken back',
    'Your landlord took back the lease to make changes. You will be told when it is ready to sign.', '/rentals', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_withdraw(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_withdraw(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The landlord deletes a draft.
CREATE OR REPLACE FUNCTION public.rentals_lease_discard(p_lease_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_leases%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_l := public.rentals_lease_for_action(p_lease_id, 'landlord', 'draft');
  DELETE FROM public.rental_leases WHERE id = v_l.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_discard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_discard(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The tenant sends it back for changes, with a note. The landlord's signature goes; it is a draft again.
CREATE OR REPLACE FUNCTION public.rentals_lease_request_changes(p_lease_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_leases%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_landlord uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_l := public.rentals_lease_for_action(p_lease_id, 'tenant', 'sent');
  IF char_length(v_note) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'bad_change_request' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_leases
     SET status = 'draft', change_request = v_note, body_sha256 = NULL, blanks_sha256 = NULL, landlord_signed_name = NULL, landlord_signed_at = NULL,
         landlord_consent_at = NULL, landlord_initials = '{}', sent_at = NULL, updated_at = now()
   WHERE id = v_l.id;
  SELECT landlord_id INTO v_landlord FROM public.rental_tenancies WHERE id = v_l.tenancy_id;
  PERFORM public.rentals_notify(v_landlord, 'Lease changes asked',
    'Your tenant asked for changes to the lease before signing. See their note under Homes.', '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_request_changes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_request_changes(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. The tenant signs: the version they read (its sent_at; a lease taken back and sent again is a new
--     one, lead review #1), the same text the landlord signed (hash), a typed name, agreement to sign
--     electronically and a tick for each initialed clause. Final; both sides are told (and emailed).
CREATE OR REPLACE FUNCTION public.rentals_lease_sign(p_lease_id uuid, p_sent_at timestamptz, p_body_sha256 text, p_signed_name text,
                                                     p_consent boolean, p_initials text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_l public.rental_leases%ROWTYPE;
  v_name text;
  v_t public.rental_tenancies%ROWTYPE;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_l := public.rentals_lease_for_action(p_lease_id, 'tenant', 'sent');
  IF p_sent_at IS DISTINCT FROM v_l.sent_at OR p_body_sha256 IS DISTINCT FROM v_l.body_sha256
     OR public.rentals_lease_blanks_sha256(v_l.template_version, v_l.fields) IS DISTINCT FROM v_l.blanks_sha256 THEN
    RAISE EXCEPTION 'lease_changed' USING ERRCODE = '22023';
  END IF;
  IF p_consent IS NOT TRUE THEN
    RAISE EXCEPTION 'lease_consent_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}'::text[]) FROM unnest(COALESCE(p_initials, '{}'::text[])) k)
       IS DISTINCT FROM public.rentals_lease_initial_keys(v_l.fields) THEN
    RAISE EXCEPTION 'lease_initials_required' USING ERRCODE = '22023';
  END IF;
  v_name := public.rentals_lease_signature(p_signed_name);
  UPDATE public.rental_leases
     SET status = 'signed', tenant_signed_name = v_name, tenant_signed_at = now(), tenant_consent_at = now(),
         tenant_initials = public.rentals_lease_initial_keys(v_l.fields), updated_at = now()
   WHERE id = v_l.id;
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = v_l.tenancy_id;
  PERFORM public.rentals_notify(v_t.landlord_id, 'Lease signed',
    'Your tenant signed the lease. Download the signed PDF under Homes.', '/rentals', true);
  PERFORM public.rentals_notify(v_t.tenant_id, 'Lease signed',
    'You signed the lease. Download the signed PDF under Homes any time.', '/rentals', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lease_sign(uuid, timestamptz, text, text, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_sign(uuid, timestamptz, text, text, boolean, text[]) TO authenticated, service_role;

-- HOMES: an admin approves a lister's FIRST listing before it goes live
-- (owner answers 2026-10-19 ~19Z: "admin approves a landlord's FIRST listing";
-- rent or sale; later listings go live right away).
--
-- THE RULE. A lister is TRUSTED once an admin has approved one of their
-- listings (rentals_lister_trusted). Until then, publishing a listing
-- (rentals_set_listing_status 'live') runs every publish check exactly as
-- before and then, instead of going live, marks the listing
-- first_review = 'pending_review' and pages the admins. The listing keeps its
-- status ('draft'), so EVERY reader stays closed without being touched:
-- Browse (rent and sale), the in-app page (rentals_listing_visible), the public
-- link (rentals_public_listing_visible) and the photo proxy all require
-- status = 'live'. Nothing new can leak by being forgotten.
--
-- FAIL-CLOSED BACKSTOP. A trigger (rentals_listing_review_guard) refuses ANY
-- write that makes a listing live for an untrusted owner unless that write is
-- the admin's approval of this very listing (first_review = 'approved'), so a
-- future writer (a lift, a renewal, a new RPC) cannot skip the review either.
--
-- WHAT THE ADMIN APPROVES IS WHAT GOES LIVE. The queue returns each listing's
-- first_review_submitted_at; the decision must name it. An edit or a photo
-- added or removed while the listing waits moves that time (the same trigger,
-- and one on rental_listing_photos), so a decision about older content is
-- refused ('review_changed') and the admin looks again. Approval re-runs every
-- publish check against the OWNER (ID, approved ownership, take-down, wording,
-- photos, fee gate, ban), then publishes and tells the owner; a rejection needs
-- a reason, leaves the draft as it was, and tells the owner the reason. The
-- owner fixes it and presses Publish again, which sends it back for review.
--
-- WHO SEES WHAT. first_review / _submitted_at / _decided_at / _note are on
-- rental_listings, which the owner (and admins) already read under RLS. WHICH
-- admin decided is never stored on the listing; it is in admin_audit_log only.
--
-- Prod had 0 rental_listings and 0 rental_properties when this was written
-- (measured 2026-10-19 18:4xZ), so there is nothing to grandfather.
--
-- Also restated (VERBATIM from 20261019051407 plus one row / one branch): the
-- admin-queue alert closes itself once no first listing waits.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints dropped before added,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

-- ---------------------------------------------------------------------------
-- 1. The review state on the listing.
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS first_review text;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS first_review_submitted_at timestamptz;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS first_review_decided_at timestamptz;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS first_review_note text;
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_first_review_check;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_first_review_check
  CHECK (first_review IS NULL OR first_review IN ('pending_review', 'approved', 'rejected'));
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_first_review_shape;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_first_review_shape CHECK (
  (first_review IS NULL OR first_review_submitted_at IS NOT NULL)
  AND (first_review IS DISTINCT FROM 'rejected' OR (first_review_decided_at IS NOT NULL AND first_review_note IS NOT NULL))
  AND (first_review_note IS NULL OR char_length(first_review_note) <= 500));
COMMENT ON COLUMN public.rental_listings.first_review IS
  'The admin review of a lister''s FIRST listing (owner 2026-10-19): pending_review (waits; the listing is not live), approved (an admin published it; the lister is trusted from then on), rejected (first_review_note says why; the lister edits and publishes again). NULL: no review was needed. 20261019185022.';

-- The admin queue: waiting first listings, oldest first.
CREATE INDEX IF NOT EXISTS rental_listings_first_review_pending_idx
  ON public.rental_listings (first_review_submitted_at) WHERE first_review = 'pending_review';
-- The trust lookup: one approved listing per owner is enough.
CREATE INDEX IF NOT EXISTS rental_listings_first_review_approved_idx
  ON public.rental_listings (owner_id) WHERE first_review = 'approved';

-- ---------------------------------------------------------------------------
-- 2. Trusted = an admin has approved one of this lister's listings.
CREATE OR REPLACE FUNCTION public.rentals_lister_trusted(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.rental_listings l WHERE l.owner_id = p_uid AND l.first_review = 'approved');
$fn$;
REVOKE ALL ON FUNCTION public.rentals_lister_trusted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_lister_trusted(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Every publish check, for one listing and its OWNER (moved out of
--    rentals_set_listing_status 20261019062540 unchanged, so the owner's
--    Publish and the admin's approval run the same checks).
CREATE OR REPLACE FUNCTION public.rentals_listing_publish_check(p_l public.rental_listings, p_owner uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_photos integer;
  v_fee integer;
  v_flags text[];
BEGIN
  -- A rented listing stays rented (lh-authz-rls review of 390bbc7a9 #3): the
  -- unit is listed again with a NEW listing, so the one-open-listing rule
  -- never surfaces as a raw unique violation. A sold one stays sold.
  IF p_l.status IN ('leased', 'sold', 'removed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_identity_verified(p_owner) THEN
    RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
  END IF;
  -- A take-down is on the PROPERTY (lead review must-fix 1): no unit and neither kind on it goes live
  -- again until an admin lifts it (the trigger refuses it too; this answers first, with the same code).
  IF EXISTS (SELECT 1 FROM public.rental_properties rp
              WHERE rp.id = p_l.property_id AND rp.listings_taken_down_at IS NOT NULL) THEN
    RAISE EXCEPTION 'listing_taken_down' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rental_properties rp
                  WHERE rp.id = p_l.property_id AND rp.owner_id = p_owner AND rp.ownership_status = 'approved') THEN
    RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
  END IF;
  -- The check is re-run on the stored text (the phrase list may have grown since the last save).
  IF p_l.kind = 'sale' THEN
    v_flags := public.homes_sale_wording_flags(concat_ws(' ', p_l.headline, p_l.description));
  ELSE
    v_flags := public.rentals_listing_wording_flags(concat_ws(' ', p_l.headline, p_l.description, p_l.pet_rules));
  END IF;
  IF cardinality(v_flags) > 0 THEN
    IF p_l.kind = 'sale' THEN
      RAISE EXCEPTION 'sale_wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
    END IF;
    RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
  END IF;
  SELECT count(*) INTO v_photos FROM public.rental_listing_photos WHERE listing_id = p_l.id;
  IF v_photos < 5 THEN
    RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023';
  END IF;
  -- THE FEE GATE (owner 2026-10-19: sale listings stay FREE; the setting is 0).
  -- No payment flow exists, so a fee above 0 refuses the publish rather than
  -- letting it through unpaid. Fail closed: no settings row refuses too.
  IF p_l.kind = 'sale' THEN
    SELECT ps.homes_sale_listing_fee_cents INTO v_fee FROM public.platform_settings ps LIMIT 1;
    IF v_fee IS NULL OR v_fee > 0 THEN
      RAISE EXCEPTION 'listing_fee_not_ready' USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_publish_check(public.rental_listings, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_listing_publish_check(public.rental_listings, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Status: 20261019062540's body; the 'live' branch runs the moved checks,
--    then sends an untrusted lister's listing to review instead of live.
CREATE OR REPLACE FUNCTION public.rentals_set_listing_status(p_listing_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_l public.rental_listings%ROWTYPE;
  v_waiting boolean;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_status IS NULL OR p_status NOT IN ('live', 'paused', 'leased', 'sold', 'removed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
  END IF;
  v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
  IF v_l.status = 'removed' THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'live' THEN
    PERFORM public.rentals_listing_publish_check(v_l, v_uid);
    -- FIRST LISTING (owner 2026-10-19): until an admin has approved one of this
    -- lister's listings, Publish sends the listing to review. It stays a draft:
    -- nothing that reads 'live' can show it.
    IF NOT public.rentals_lister_trusted(v_uid) THEN
      IF v_l.first_review = 'pending_review' THEN
        RAISE EXCEPTION 'listing_in_review' USING ERRCODE = '22023';
      END IF;
      v_waiting := EXISTS (SELECT 1 FROM public.rental_listings l
                            WHERE l.owner_id = v_uid AND l.first_review = 'pending_review'
                              AND l.status NOT IN ('live', 'removed'));
      UPDATE public.rental_listings
         SET first_review = 'pending_review', first_review_submitted_at = clock_timestamp(),
             first_review_decided_at = NULL, first_review_note = NULL, updated_at = now()
       WHERE id = p_listing_id;
      -- Tell every admin, once per waiting spell of this lister. Best effort: a
      -- failed alert never refuses the lister. A test lister never pages a real admin (Q137).
      IF NOT v_waiting THEN
        BEGIN
          INSERT INTO public.notifications (user_id, title, message, type, link)
          SELECT ur.user_id,
                 'First Homes listing waits for review',
                 'A lister published their first Homes listing. Check it in Admin -> Settings -> Homes: first listings.',
                 'admin_alert',
                 '/admin?view=settings'
            FROM public.user_roles ur
           WHERE ur.role = 'admin'
             AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'rentals_set_listing_status: first listing alert failed: %', SQLERRM;
        END;
      END IF;
      RETURN;
    END IF;
    -- A trusted lister's listing goes live at once; one still marked waiting
    -- (another listing was approved meanwhile) leaves the queue.
    UPDATE public.rental_listings
       SET status = 'live', published_at = COALESCE(published_at, now()), expires_at = now() + interval '30 days',
           first_review = CASE WHEN first_review = 'pending_review' THEN NULL ELSE first_review END,
           first_review_submitted_at = CASE WHEN first_review = 'pending_review' THEN NULL ELSE first_review_submitted_at END,
           updated_at = now()
     WHERE id = p_listing_id;
  ELSIF p_status = 'paused' THEN
    IF v_l.status <> 'live' THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'paused', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'leased' THEN
    IF v_l.kind <> 'rent' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'leased', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'sold' THEN
    IF v_l.kind <> 'sale' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'sold', updated_at = now() WHERE id = p_listing_id;
  ELSE
    -- Sold and leased are final (must-fix 5): the record stays as it is.
    IF v_l.status IN ('sold', 'leased') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'removed', updated_at = now() WHERE id = p_listing_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_listing_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_listing_status(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The backstop + the review clock (one trigger on each table).
CREATE OR REPLACE FUNCTION public.rentals_listing_review_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_meta text[] := ARRAY['updated_at', 'first_review', 'first_review_submitted_at', 'first_review_decided_at',
                         'first_review_note'];
BEGIN
  IF TG_TABLE_NAME = 'rental_listing_photos' THEN
    -- A photo added or removed while the listing waits restarts its review clock.
    UPDATE public.rental_listings l
       SET first_review_submitted_at = clock_timestamp()
     WHERE l.id = COALESCE(NEW.listing_id, OLD.listing_id)
       AND l.first_review = 'pending_review' AND l.status NOT IN ('live', 'removed');
    RETURN NULL;
  END IF;

  -- Nothing goes live for a lister no admin has approved, except the admin's
  -- approval of this very listing.
  IF NEW.status = 'live' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live')
     AND NEW.first_review IS DISTINCT FROM 'approved'
     AND NOT public.rentals_lister_trusted(NEW.owner_id) THEN
    RAISE EXCEPTION 'listing_needs_review' USING ERRCODE = '42501';
  END IF;
  -- Content edited while it waits: the admin must look again.
  IF TG_OP = 'UPDATE' AND OLD.first_review = 'pending_review' AND NEW.first_review = 'pending_review'
     AND NEW.first_review_submitted_at IS NOT DISTINCT FROM OLD.first_review_submitted_at
     AND (to_jsonb(NEW) - v_meta) IS DISTINCT FROM (to_jsonb(OLD) - v_meta) THEN
    NEW.first_review_submitted_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_review_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rentals_listing_review_guard ON public.rental_listings;
CREATE TRIGGER rentals_listing_review_guard BEFORE INSERT OR UPDATE ON public.rental_listings
  FOR EACH ROW EXECUTE FUNCTION public.rentals_listing_review_guard();
DROP TRIGGER IF EXISTS rentals_listing_review_guard ON public.rental_listing_photos;
CREATE TRIGGER rentals_listing_review_guard AFTER INSERT OR DELETE ON public.rental_listing_photos
  FOR EACH ROW EXECUTE FUNCTION public.rentals_listing_review_guard();

-- ---------------------------------------------------------------------------
-- 6. The admin queue: every waiting first listing with what the admin needs
--    to judge it (the street too: staff check it against the ownership proof),
--    and short-lived owner-scope photo refs ('o', valid to the next hour + 1).
CREATE OR REPLACE FUNCTION public.rentals_admin_first_listings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
             to_jsonb(l) - ARRAY['first_review_decided_at']
             || jsonb_build_object(
                  'owner_name', NULLIF(btrim(p.full_name), ''),
                  'owner_id_verified', public.is_identity_verified(l.owner_id),
                  'ownership_status', rp.ownership_status,
                  'street_address', rp.street_address,
                  'city', rp.city,
                  'zip_code', rp.zip_code,
                  'photo_refs', COALESCE((SELECT jsonb_agg(public.rentals_photo_ref(ph.id, 'o') ORDER BY ph.position)
                                            FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id), '[]'::jsonb))
             ORDER BY l.first_review_submitted_at, l.id)
      FROM public.rental_listings l
      JOIN public.rental_properties rp ON rp.id = l.property_id
      LEFT JOIN public.profiles p ON p.user_id = l.owner_id
     WHERE l.first_review = 'pending_review' AND l.status NOT IN ('live', 'removed')
  ), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_first_listings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_first_listings() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The admin decides.
CREATE OR REPLACE FUNCTION public.rentals_admin_review_first_listing(p_listing_id uuid, p_approve boolean, p_note text,
                                                                     p_submitted_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_l public.rental_listings%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
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
  IF NOT p_approve AND char_length(coalesce(v_note, '')) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.rental_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND OR v_l.first_review IS DISTINCT FROM 'pending_review' OR v_l.status IN ('live', 'removed') THEN
    RAISE EXCEPTION 'not_pending_review' USING ERRCODE = 'P0002';
  END IF;
  -- An admin never approves their own listing.
  IF v_l.owner_id = v_uid THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- The decision is about the content the admin opened (authz review #1 of the landlord ID, same rule).
  IF p_submitted_at IS NULL OR v_l.first_review_submitted_at IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'review_changed' USING ERRCODE = '40001';
  END IF;

  IF p_approve THEN
    -- The owner's own Publish checks, run for the OWNER, plus their standing now.
    IF EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.user_id = v_l.owner_id
                  AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())) THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    PERFORM public.rentals_listing_publish_check(v_l, v_l.owner_id);
    UPDATE public.rental_listings
       SET status = 'live', published_at = COALESCE(published_at, now()), expires_at = now() + interval '30 days',
           first_review = 'approved', first_review_decided_at = now(), first_review_note = v_note, updated_at = now()
     WHERE id = p_listing_id;
  ELSE
    UPDATE public.rental_listings
       SET first_review = 'rejected', first_review_decided_at = now(), first_review_note = v_note, updated_at = now()
     WHERE id = p_listing_id;
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'first_listing_approved' ELSE 'first_listing_rejected' END,
          'rental_listing', p_listing_id::text, jsonb_build_object('note', v_note, 'owner_id', v_l.owner_id));

  PERFORM public.rentals_notify(v_l.owner_id,
    CASE WHEN p_approve THEN 'Your listing is live' ELSE 'Your listing needs a change' END,
    CASE WHEN p_approve THEN 'Louisiana Helpr approved "' || v_l.headline || '". It is live now, and your next listings go live right away.'
         ELSE 'Louisiana Helpr could not publish "' || v_l.headline || '": ' || v_note || ' Fix it and press Publish again.' END,
    '/rentals?tab=own', false, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_review_first_listing(uuid, boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_review_first_listing(uuid, boolean, text, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The admin-queue alert closes itself (20261019051407 bodies + one row / branch).
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
      ('landlord id waits for review',              'rentals-landlord-id-review'),
      -- First listing (20261019185022): a lister's first Homes listing waits for an admin.
      ('first homes listing waits for review',      'rentals-first-listing-review')
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

  -- First listing (20261019185022): open while any lister's first listing waits;
  -- test (seed) listers never hold a real alert open, as the two rules above.
  ELSIF p_rule = 'rentals-first-listing-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.rental_listings l
                     LEFT JOIN public.profiles p ON p.user_id = l.owner_id
                    WHERE l.first_review = 'pending_review' AND l.status <> 'live' AND l.status <> 'removed'
                      AND p.is_seed IS NOT TRUE);

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


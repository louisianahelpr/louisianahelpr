-- LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM, POST-H3): on a "Have a Helpr list it" job (category declutter_help)
-- the HIRED Helpr writes the Declutter listings ON THE SELLER'S ACCOUNT (seller_id = the job's poster). They land as
-- "awaiting your approval" in the seller's Selling tab; the seller approves each one, or all at once, and only then
-- does a listing go live, through the normal publish path (photos, the seller's own attestation, pickup times,
-- lowest price, and the automatic photo check after Post). Buyers pay the seller; the seller handles pickups.
--
-- Lead decision (so a Helpr is never stranded): the job counts as done for the Helpr once they have SENT the
-- listings to the seller for approval, not when they go live. This replaces b51's 1d5f84bff9 "done when live" gate
-- (20261101024656, unlanded on wip/b46-1031); if both land, this file is newer and its bodies win.
--
-- What the Helpr can do, and only on THAT job while it is open (accepted / in progress / sent back), and only as its
-- assigned Helpr: create a draft for the job's poster, edit it, add or remove its photos, delete it, and send the
-- job's drafts for approval. They read only the listings of that job (declutter_helpr_job_listings): the
-- declutter_items read policy is NOT changed, so the seller's other listings stay unreadable to them, and they can
-- never publish (declutter_publish_item asks seller_id = auth.uid(), and a sent listing is no longer a draft).
--
-- Data: a new status 'pending_seller_approval' (status check restated from the newest, 20261028192719) and a
-- private link table declutter_listed_for_seller (item, job, Helpr, seller, sent_at, decided_at), service role only
-- (no client grants, RLS on with no policy): buyers never learn who wrote a listing.
--
-- Done gate: enforce_helper_completion_gates (the AUTHORITATIVE jobs trigger) and rpc_helper_mark_done restated
-- from their NEWEST definition, 20261029042735_done_floor_from_arrival.sql, verbatim plus one marked block each: a
-- declutter_help job is refused completion_requires_listings_sent (23514) until at least one listing of that job
-- has been sent for approval. create-payment's release path asks public.sell_for_me_listings_sent the same, and
-- fails closed on an error.
--
-- REPLAY-SAFE: IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE. Grants: every RPC REVOKEd from
-- PUBLIC, anon. PGlite proof: src/test/pglite/declutterListForSeller.pglite.mjs (applied 3x).

-- 1. The status.
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_status_check;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_status_check CHECK (status IN (
  'draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed',
  'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere', 'pending_seller_approval'
));

-- 2. Who wrote it, for which job. Private: service role only.
CREATE TABLE IF NOT EXISTS public.declutter_listed_for_seller (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helpr_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS declutter_listed_for_seller_job_idx ON public.declutter_listed_for_seller (job_id);
CREATE INDEX IF NOT EXISTS declutter_listed_for_seller_seller_idx ON public.declutter_listed_for_seller (seller_id);
CREATE INDEX IF NOT EXISTS declutter_listed_for_seller_helpr_idx ON public.declutter_listed_for_seller (helpr_id);
ALTER TABLE public.declutter_listed_for_seller ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_listed_for_seller FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_listed_for_seller TO service_role;
-- Q807: an unconfirmed email can't write (every public table created since gets the gate).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 3. The job gate every Helpr RPC asks: the caller is THIS job's Helpr, it is a declutter_help job, and it is open.
--    Returns the seller (the job's poster). Not client-callable.
CREATE OR REPLACE FUNCTION public.declutter_list_for_seller_job(p_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job record;
BEGIN
  SELECT id, customer_id, helper_id, category::text AS category, status::text AS status
    INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;
  IF v_job.id IS NULL OR v_job.helper_id IS DISTINCT FROM (SELECT auth.uid()) OR v_job.category <> 'declutter_help' THEN
    RAISE EXCEPTION 'not_your_job' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_open' USING ERRCODE = '22023', HINT = 'This job is closed, so its listings can''t be changed.';
  END IF;
  IF v_job.customer_id IS NULL OR v_job.customer_id = v_job.helper_id THEN
    RAISE EXCEPTION 'not_your_job' USING ERRCODE = '42501';
  END IF;
  RETURN v_job.customer_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_list_for_seller_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_list_for_seller_job(uuid) TO service_role;

-- 4. The Helpr's draft of one listing: only a draft of a job they are working, and not sent yet. Returns the row.
CREATE OR REPLACE FUNCTION public.declutter_list_for_seller_draft(p_item_id uuid)
RETURNS public.declutter_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  SELECT l.job_id INTO v_job FROM public.declutter_listed_for_seller l
   WHERE l.item_id = p_item_id AND l.helpr_id = (SELECT auth.uid());
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.declutter_list_for_seller_job(v_job);
  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023', HINT = 'This listing was already sent to the seller.';
  END IF;
  RETURN v_item;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_list_for_seller_draft(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_list_for_seller_draft(uuid) TO service_role;

-- 5. Create a draft on the seller's account. Pickup address and coordinates are the job's own (the seller's place);
--    the area label is the Helpr's, checked like any listing's. Price rules as declutter_create_item_with_id.
CREATE OR REPLACE FUNCTION public.declutter_helpr_create_listing(
  p_job_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_job record;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_seller := public.declutter_list_for_seller_job(p_job_id);
  SELECT location, latitude, longitude INTO v_job FROM public.jobs WHERE id = p_job_id FOR SHARE;

  IF p_price_cents = 0 THEN
    IF COALESCE(p_floor_price_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023', HINT = 'A free item has no lowest price.';
    END IF;
    p_floor_price_cents := 0;
  ELSIF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF v_job.latitude IS NULL OR v_job.longitude IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, v_job.location) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address'
      USING ERRCODE = '22023', HINT = 'Use the neighborhood or town, not a street address.';
  END IF;

  INSERT INTO public.declutter_items (
    seller_id, sale_mode, status, title, description, category, condition_stars,
    delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES (
    v_seller, 'offers', 'draft', btrim(p_title), COALESCE(btrim(p_description), ''), p_category,
    p_condition_stars, p_delivery_size, p_price_cents, p_price_cents, btrim(p_area_label),
    round(v_job.latitude::numeric, 2), round(v_job.longitude::numeric, 2))
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
  VALUES (v_id, v_seller, p_floor_price_cents, btrim(COALESCE(v_job.location, '')), v_job.latitude, v_job.longitude);
  INSERT INTO public.declutter_listed_for_seller (item_id, job_id, helpr_id, seller_id)
  VALUES (v_id, p_job_id, v_uid, v_seller);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_create_listing(uuid, text, text, text, integer, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_create_listing(uuid, text, text, text, integer, text, integer, integer, text) TO authenticated, service_role;

-- 6. Edit the Helpr's own unsent draft.
CREATE OR REPLACE FUNCTION public.declutter_helpr_update_listing(
  p_item_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_list_for_seller_draft(p_item_id);
  IF p_price_cents = 0 THEN
    IF COALESCE(p_floor_price_cents, 0) <> 0 THEN
      RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023', HINT = 'A free item has no lowest price.';
    END IF;
    p_floor_price_cents := 0;
  ELSIF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  UPDATE public.declutter_items
     SET title = btrim(p_title), description = COALESCE(btrim(p_description), ''), category = p_category,
         condition_stars = p_condition_stars, delivery_size = p_delivery_size,
         price_cents = p_price_cents, current_price_cents = p_price_cents, updated_at = now()
   WHERE id = p_item_id AND status = 'draft';
  UPDATE public.declutter_item_private SET floor_price_cents = p_floor_price_cents, updated_at = now()
   WHERE item_id = p_item_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_update_listing(uuid, text, text, text, integer, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_update_listing(uuid, text, text, text, integer, text, integer, integer) TO authenticated, service_role;

-- 7. A photo on the Helpr's unsent draft: the Helpr's OWN upload, in their own folder for THIS item (the same object
--    checks as declutter_add_item_photo, asked of the Helpr).
CREATE OR REPLACE FUNCTION public.declutter_helpr_add_listing_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.declutter_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_item := public.declutter_list_for_seller_draft(p_item_id);
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
  END IF;
  INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES (p_item_id, v_item.seller_id, p_storage_path, v_pos)
  RETURNING id INTO v_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = p_item_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_add_listing_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_add_listing_photo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_helpr_remove_listing_photo(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT item_id INTO v_item FROM public.declutter_item_photos WHERE id = p_photo_id;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.declutter_list_for_seller_draft(v_item);
  DELETE FROM public.declutter_item_photos WHERE id = p_photo_id AND item_id = v_item;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = v_item;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_remove_listing_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_remove_listing_photo(uuid) TO authenticated, service_role;

-- 8. Delete the Helpr's unsent draft (it never reached the seller).
CREATE OR REPLACE FUNCTION public.declutter_helpr_delete_listing(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_list_for_seller_draft(p_item_id);
  DELETE FROM public.declutter_items WHERE id = p_item_id AND status = 'draft';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_delete_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_delete_listing(uuid) TO authenticated, service_role;

-- 9. What the Helpr sees: ONLY this job's listings (title, price, status, photo count). Never the seller's others.
CREATE OR REPLACE FUNCTION public.declutter_helpr_job_listings(p_job_id uuid)
RETURNS TABLE (item_id uuid, title text, description text, category text, condition_stars smallint,
               delivery_size text, price_cents integer, floor_price_cents integer, area_label text,
               status text, photo_count integer, sent_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.helper_id = (SELECT auth.uid())
                    AND j.category::text = 'declutter_help') THEN
    RAISE EXCEPTION 'not_your_job' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.title, i.description, i.category, i.condition_stars, i.delivery_size, i.price_cents,
           pv.floor_price_cents, i.area_label,
           -- After the seller decides, the Helpr sees only that it was decided, never the listing's later life.
           CASE WHEN i.status IN ('draft', 'pending_seller_approval') THEN i.status
                WHEN i.status = 'withdrawn' AND l.decided_at IS NOT NULL THEN 'declined'
                ELSE 'approved' END,
           (SELECT count(*)::integer FROM public.declutter_item_photos ph WHERE ph.item_id = i.id),
           l.sent_at
      FROM public.declutter_listed_for_seller l
      JOIN public.declutter_items i ON i.id = l.item_id
      LEFT JOIN public.declutter_item_private pv ON pv.item_id = i.id
     WHERE l.job_id = p_job_id AND l.helpr_id = (SELECT auth.uid())
     ORDER BY l.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_job_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_job_listings(uuid) TO authenticated, service_role;

-- 10. Send the job's drafts to the seller. Each needs a photo (the seller's approval publishes it). The seller is told.
CREATE OR REPLACE FUNCTION public.declutter_helpr_send_listings(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_n integer;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_seller := public.declutter_list_for_seller_job(p_job_id);
  PERFORM 1 FROM public.declutter_items i JOIN public.declutter_listed_for_seller l ON l.item_id = i.id
   WHERE l.job_id = p_job_id AND l.helpr_id = v_uid AND i.status = 'draft' FOR UPDATE OF i;
  IF EXISTS (SELECT 1 FROM public.declutter_items i JOIN public.declutter_listed_for_seller l ON l.item_id = i.id
              WHERE l.job_id = p_job_id AND l.helpr_id = v_uid AND i.status = 'draft'
                AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = i.id)) THEN
    RAISE EXCEPTION 'photos_required' USING ERRCODE = '22023', HINT = 'Add at least 1 photo to each listing first.';
  END IF;
  WITH sent AS (
    UPDATE public.declutter_items i
       SET status = 'pending_seller_approval', updated_at = now()
      FROM public.declutter_listed_for_seller l
     WHERE l.item_id = i.id AND l.job_id = p_job_id AND l.helpr_id = v_uid AND i.status = 'draft'
    RETURNING i.id
  )
  UPDATE public.declutter_listed_for_seller l SET sent_at = now()
    FROM sent WHERE l.item_id = sent.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'nothing_to_send' USING ERRCODE = '22023', HINT = 'Add a listing first.';
  END IF;
  PERFORM public.declutter_notify(v_seller, 'declutter_listings', 'Listings waiting for your OK',
    format('Your Helpr wrote %s listing%s for you. Check them and approve to put them on sale.', v_n, CASE WHEN v_n = 1 THEN '' ELSE 's' END),
    '/declutter?tab=selling', v_uid);
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_helpr_send_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_helpr_send_listings(uuid) TO authenticated, service_role;

-- 11. The seller's approval card: listings waiting for them, with the lowest price the Helpr set and the Helpr's
--     first name.
CREATE OR REPLACE FUNCTION public.declutter_listed_for_me()
RETURNS TABLE (item_id uuid, job_id uuid, title text, price_cents integer, floor_price_cents integer,
               helpr_first_name text, sent_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT l.item_id, l.job_id, i.title, i.price_cents, pv.floor_price_cents,
           split_part(COALESCE(p.full_name, ''), ' ', 1), l.sent_at
      FROM public.declutter_listed_for_seller l
      JOIN public.declutter_items i ON i.id = l.item_id
      -- The lowest price the Helpr set, so the seller sees it before approving (lh-authz-rls review, 11-01).
      LEFT JOIN public.declutter_item_private pv ON pv.item_id = l.item_id
      LEFT JOIN public.profiles p ON p.user_id = l.helpr_id
     WHERE l.seller_id = (SELECT auth.uid()) AND i.seller_id = (SELECT auth.uid())
       AND i.status = 'pending_seller_approval'
     ORDER BY l.sent_at, l.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listed_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_listed_for_me() TO authenticated, service_role;

-- 12. The seller approves one or many. Each: the seller's own attestation (the same four statements), then the
--     NORMAL publish path (declutter_publish_item, as the seller). One that can't go live yet (no pickup times, a
--     price rule) stays waiting and says why; the others still go.
CREATE OR REPLACE FUNCTION public.declutter_approve_listed_for_me(
  p_item_ids uuid[],
  p_bought_for_personal_use boolean,
  p_not_in_the_business boolean,
  p_not_a_frequent_seller boolean,
  p_keeps_item_until_handover boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
  v_status text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 OR cardinality(p_item_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;
  FOREACH v_id IN ARRAY p_item_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.declutter_items i JOIN public.declutter_listed_for_seller l ON l.item_id = i.id
                    WHERE i.id = v_id AND i.seller_id = v_uid AND l.seller_id = v_uid
                      AND i.status = 'pending_seller_approval') THEN
      v_out := v_out || jsonb_build_object('item_id', v_id, 'error', 'item_not_found');
      CONTINUE;
    END IF;
    BEGIN
      UPDATE public.declutter_items SET status = 'draft' WHERE id = v_id AND status = 'pending_seller_approval';
      PERFORM public.declutter_attest_item(v_id, p_bought_for_personal_use, p_not_in_the_business,
                                           p_not_a_frequent_seller, p_keeps_item_until_handover);
      v_status := public.declutter_publish_item(v_id);
      UPDATE public.declutter_listed_for_seller SET decided_at = now() WHERE item_id = v_id;
      v_out := v_out || jsonb_build_object('item_id', v_id, 'status', v_status);
    EXCEPTION WHEN OTHERS THEN
      -- The sub-block rolls back: the listing stays waiting for approval.
      v_out := v_out || jsonb_build_object('item_id', v_id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_approve_listed_for_me(uuid[], boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_approve_listed_for_me(uuid[], boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- 13. The seller turns one down: it never goes on sale.
CREATE OR REPLACE FUNCTION public.declutter_decline_listed_for_me(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  UPDATE public.declutter_items i SET status = 'withdrawn', updated_at = now()
    FROM public.declutter_listed_for_seller l
   WHERE i.id = p_item_id AND l.item_id = i.id AND i.seller_id = v_uid AND l.seller_id = v_uid
     AND i.status = 'pending_seller_approval';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_listed_for_seller SET decided_at = now() WHERE item_id = p_item_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_decline_listed_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_decline_listed_for_me(uuid) TO authenticated, service_role;

-- 14. The done gate's question: has this job's Helpr sent at least one listing for approval? Answers only the job's
--     own two people, or the server (create-payment's release path asks it with the service role).
CREATE OR REPLACE FUNCTION public.sell_for_me_listings_sent(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seller uuid;
  v_helper uuid;
BEGIN
  SELECT customer_id, helper_id INTO v_seller, v_helper FROM public.jobs WHERE id = _job_id;
  IF v_seller IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_helper AND auth.uid() IS DISTINCT FROM v_seller) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.declutter_listed_for_seller l
     WHERE l.job_id = _job_id AND l.helpr_id = v_helper AND l.sent_at IS NOT NULL
  );
END;
$function$;
-- The jobs trigger runs as the Helpr (it is not a definer), so authenticated may call it.
REVOKE ALL ON FUNCTION public.sell_for_me_listings_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_for_me_listings_sent(uuid) TO authenticated, service_role;

-- 15. Restated from 20261029042735_done_floor_from_arrival.sql (newest), plus the LEAD-LIST-FOR-SELLER block.
CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- THE GROUP ROLL-UP (2026-09-19). A crew job's arrivals and completions live
  -- on `group_job_helpers`, one row per member, each already past
  -- `enforce_group_member_completion_gates` — the SAME three gates, applied per
  -- member. `rpc_group_member_mark_done` stamps this job column only once every
  -- slot is finished. The job-level predicates below read scalars a crew job
  -- never fills (poster_confirmed_arrival_at, the job's shared proof arrays),
  -- so without this the last member's roll-up would be refused for a stamp
  -- nobody on a crew job can produce.
  IF OLD.is_group_job IS TRUE
     AND COALESCE(current_setting('app.group_rollup_rpc', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- THE STATUS DOOR (VN-33 review). The whitelist allows `status` and
  -- enforce_job_status_transition allows in_progress/accepted → completed, so
  -- the assigned Helpr writing status = 'completed' directly reached a
  -- completed job with no arrival at all — and a completed status also takes
  -- the job out of create-payment's release and auto-release-payment,
  -- stranding the escrow. The app never writes that status as a Helpr; the one
  -- sanctioned Helpr-session writer is rpc_withdraw_dispute, which restores a
  -- completed job under its own transaction-local flag.
  IF NEW.status::text = 'completed'
     AND OLD.status::text IS DISTINCT FROM 'completed'
     AND COALESCE(current_setting('app.dispute_withdraw_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'helper_cannot_complete_by_status'
      USING ERRCODE = '42501',
            HINT = 'Mark the job complete; the job is completed when the payment is released.';
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    -- ARRIVAL MUST BE ESTABLISHED, and since the owner's 2026-09-19 reversal
    -- that is ONE stamp: the poster tapped "Confirm They Arrived". VN-33's
    -- "GPS AND poster" and VN-33(b)'s near-miss stand-in are both superseded —
    -- keeping GPS in this predicate while the tracker's Working step no longer
    -- reads it would let a Helpr be waved into work and then refused payment
    -- for a stamp nobody can produce. No grandfather clause: the rule only ever
    -- widens what passes, so no in-flight job is stranded by it.
    IF OLD.poster_confirmed_arrival_at IS NULL
       AND OLD.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
      RAISE EXCEPTION 'completion_requires_confirmed_arrival'
        USING ERRCODE = '23514',
              HINT = 'The person who posted this job has to tap Confirm They Arrived before you can mark it complete.';
    END IF;

    -- LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM; lead: done once SENT, so a Helpr is never stranded): a
    -- "Have a Helpr list it" job (declutter_help) is done once its Helpr has sent its listings to the seller.
    IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(OLD.id) THEN
      RAISE EXCEPTION 'completion_requires_listings_sent'
        USING ERRCODE = '23514',
              HINT = 'Send the listings to the seller for approval first, then mark the job done.';
    END IF;

    -- Photo proof is the POSTER'S call, per job. COALESCE to true so a row
    -- written by a client that predates the column (or by any path that omits
    -- it) still gets the historic always-on behaviour rather than a silent
    -- opt-out. Read off NEW so a poster who turns the requirement off while the
    -- job is in flight releases the helper immediately.
    IF COALESCE(NEW.require_photo_proof, true)
       AND (COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
            OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0) THEN
      RAISE EXCEPTION 'completion_requires_proof_photos'
        USING ERRCODE = '23514',
              HINT = 'Add before and after photos before marking the job done.';
    END IF;

    -- From the Helpr's own arrival (audit 2026-10-28 F12): LEAST, so a late
    -- "Confirm they're working" never restarts the clock.
    IF LEAST(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - LEAST(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job can be marked done 30 minutes after you arrived.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_helper_completion_gates() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_helper_mark_done(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- `record`, not `public.jobs`, so the function body does not bind the jobs
  -- rowtype at CREATE time (keeps this file creatable on a from-scratch replay
  -- before jobs exists, and matches the trigger's skip guard below).
  v_job record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: a double tap must not run two stamps against one row.
  SELECT * INTO v_job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;

  -- Already done: keep the FIRST stamp and report state.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'already_done', true,
      'helper_completed_at', v_job.helper_completed_at,
      'poster_completed_at', v_job.poster_completed_at
    );
  END IF;

  IF v_job.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active (status=' || v_job.status::text || '), so it cannot be marked done.';
  END IF;

  -- The gate checks below mirror enforce_helper_completion_gates, which is
  -- AUTHORITATIVE: it fires on this UPDATE too (its trigger is BEFORE UPDATE OF
  -- helper_completed_at, status, and auth.uid() is still the Helpr inside this
  -- definer). These give the Helpr a clean, specific refusal before the write;
  -- if the two ever drift, the trigger still fails closed. Keep them in step.
  --
  -- Arrival established = the poster's confirmation, GPS or no GPS (owner,
  -- 2026-09-19; the exact predicate the trigger enforces on the write).
  IF v_job.poster_confirmed_arrival_at IS NULL
     AND v_job.helper_arrival_verified_at IS NULL THEN  -- GPS skips the tap (2026-10-08)
    RAISE EXCEPTION 'completion_requires_confirmed_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can mark it complete.';
  END IF;

  -- LEAD-LIST-FOR-SELLER: a Have-a-Helpr-list-it job waits until its listings are sent (the trigger's rule, said first).
  IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(v_job.id) THEN
    RAISE EXCEPTION 'completion_requires_listings_sent' USING ERRCODE = '23514',
      HINT = 'Send the listings to the seller for approval first, then mark the job done.';
  END IF;
  IF COALESCE(v_job.require_photo_proof, true)
     AND (COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0
          OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) = 0) THEN
    RAISE EXCEPTION 'completion_requires_proof_photos' USING ERRCODE = '23514',
      HINT = 'Add before and after photos before marking the job done.';
  END IF;

  -- From the Helpr's own arrival (audit 2026-10-28 F12), as the trigger.
  IF LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) IS NOT NULL
     AND v_now - LEAST(v_job.poster_confirmed_working_at, v_job.helper_arrived_at) < interval '30 minutes' THEN
    RAISE EXCEPTION 'completion_min_work_time' USING ERRCODE = '23514',
      HINT = 'A job can be marked done 30 minutes after you arrived.';
  END IF;

  -- THE STAMP. The server clock, never a client-chosen time. Conditional on the
  -- live status and an unset stamp so a cancel / release / stamp that committed
  -- between the SELECT and here wins the race and this no-ops rather than
  -- reviving a job that moved on.
  UPDATE public.jobs
     SET helper_completed_at = v_now
   WHERE id = _job_id
     AND helper_completed_at IS NULL
     AND status IN ('accepted', 'in_progress', 'revision_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_completable' USING ERRCODE = '42501',
      HINT = 'This job is no longer active, so it cannot be marked done.';
  END IF;

  RETURN jsonb_build_object(
    'already_done', false,
    'helper_completed_at', v_now,
    'poster_completed_at', v_job.poster_completed_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_helper_mark_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_helper_mark_done(uuid) TO authenticated, service_role;


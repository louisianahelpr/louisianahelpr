-- Declutter posting audit 10-30 #8: Report and Block on a Wanted post, and the automatic check on its photos (owner rule:
-- content goes live at once, an admin looks only on a report or a failed automatic check). Restated functions are
-- the effective definitions (prod read 2026-10-30, or 20261030221255 on this stack) with only the changes named here.
-- Replay-safe. No Wanted rows exist on prod (measured 2026-10-30: 0), so nothing needs clearing by hand.

-- ---------------------------------------------------------------------------
-- 1. A member can report a Wanted post. The prod list (20261030071816) plus 'declutter_wanted'.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text]));

-- ---------------------------------------------------------------------------
-- 2. Which of a post's photos members may see. photo_paths stays the whole list (the poster's list, export, storage
--    rule and purge read it), and only declutter_wanted_browse shows photos to anyone else: it now shows only
--    photos_cleared. photos_held are the ones a check flagged or never finished, so asking again can't wash a flag off.
ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS photos_cleared text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS photos_held text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.declutter_wanted ADD COLUMN IF NOT EXISTS photo_added_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. The report keeps a copy of what was reported (the post can change after it), as a message report does. Changed:
--    the declutter_wanted branch. A member reports only a post they could be shown; anything else reads as not found,
--    because the copy is readable by its reporter and would otherwise read out a private post.
CREATE OR REPLACE FUNCTION public.report_message_party_and_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m public.messages%ROWTYPE;
  w public.declutter_wanted%ROWTYPE;
BEGIN
  IF NEW.reported_type = 'declutter_wanted' THEN
    SELECT * INTO w FROM public.declutter_wanted WHERE id = NEW.reported_id;
    IF NOT FOUND
       OR (NOT public.is_server_context()
           AND (NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = NEW.reporter_id
                OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    NEW.reported_content := left(w.what, 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type IS DISTINCT FROM 'message' THEN
    NEW.reported_content := NULL;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM public.messages WHERE id = NEW.reported_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- L6: only someone in the conversation reports its message.
  IF NOT public.is_server_context()
     AND NEW.reporter_id IS DISTINCT FROM m.sender_id
     AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN
    RAISE EXCEPTION 'report_not_allowed' USING ERRCODE = '42501';
  END IF;
  NEW.reported_content := left(concat_ws(E'\n',
    NULLIF(m.content, ''),
    CASE WHEN m.attachment_url IS NOT NULL THEN 'Attachment: ' || m.attachment_url END), 4000);
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Block a post's poster. The post is the handle, the same one-answer gate as the browse rows, so it is no oracle.
--    A block from a Wanted post NEVER cancels a job or prices a fee: block_user_and_settle is unchanged, and when it
--    settled anything (a job cancelled, a crew member taken off, a fee or strike, an admin alert) this raises, which
--    rolls ALL of it back, the block row included. That covers every seat and a hire that commits while this runs, and
--    no second copy of "what counts as a live job" can drift from it. The member blocks from the job itself, where
--    BlockUserDialog shows the fee first.
CREATE OR REPLACE FUNCTION public.declutter_block_wanted_poster(p_wanted_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id;
  IF NOT FOUND OR NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = v_uid
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_result := public.block_user_and_settle(w.user_id, 'Blocked from a Wanted post');
  IF jsonb_array_length(COALESCE(v_result -> 'settled', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'wanted_block_shared_job' USING ERRCODE = 'P0001';
  END IF;
  RETURN 'blocked';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_block_wanted_poster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_block_wanted_poster(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Hold a post's unchecked photos for an admin: they stay hidden and one open report carries the reason. The post's
--    words stay up. A test post never reaches admin (its photos are held, no report is written). Server only.
--    p_paths NULL means every photo not yet decided.
CREATE OR REPLACE FUNCTION public.declutter_wanted_hold_photos(p_wanted_id uuid, p_paths text[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  w public.declutter_wanted%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_wanted d
     SET photos_held = d.photos_held || ARRAY(
       SELECT p.path FROM unnest(d.photo_paths) AS p(path)
        WHERE NOT p.path = ANY (d.photos_cleared) AND NOT p.path = ANY (d.photos_held)
          AND (p_paths IS NULL OR p.path = ANY (p_paths)))
   WHERE d.id = p_wanted_id;
  IF w.is_seed IS NOT TRUE AND NOT EXISTS (
       SELECT 1 FROM public.reports r
        WHERE r.reported_type = 'declutter_wanted' AND r.reported_id = p_wanted_id AND r.reporter_id IS NULL
          AND r.status IN ('pending', 'new', 'investigating')) THEN
    INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description, status)
    VALUES (NULL, 'declutter_wanted', p_wanted_id, 'Automatic photo check', left(btrim(COALESCE(p_reason, '')), 300), 'pending');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_hold_photos(uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_hold_photos(uuid, text[], text) TO service_role;

-- 6. The verdict of the automatic check (declutter-ai-draft, mode wanted_check; service role only). Only what it judged
--    is decided, and a held photo stays held: a photo added or removed while it ran is not swept up.
CREATE OR REPLACE FUNCTION public.declutter_record_wanted_ai_check(p_wanted_id uuid, p_user_id uuid, p_judged_paths text[], p_flag_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
BEGIN
  PERFORM 1 FROM public.declutter_wanted
    WHERE id = p_wanted_id AND user_id = p_user_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_flag IS NOT NULL THEN
    PERFORM public.declutter_wanted_hold_photos(p_wanted_id, COALESCE(p_judged_paths, ARRAY[]::text[]), v_flag);
    RETURN 'held';
  END IF;
  UPDATE public.declutter_wanted d
     SET photos_cleared = d.photos_cleared || ARRAY(
       SELECT p.path FROM unnest(d.photo_paths) AS p(path)
        WHERE p.path = ANY (COALESCE(p_judged_paths, ARRAY[]::text[]))
          AND NOT p.path = ANY (d.photos_cleared) AND NOT p.path = ANY (d.photos_held))
   WHERE d.id = p_wanted_id;
  RETURN 'cleared';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_record_wanted_ai_check(uuid, uuid, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_wanted_ai_check(uuid, uuid, text[], text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The reports queue's half. reported_id is a declutter_wanted id, never a person, and the post's policy shows it
--    only to its poster, so an admin reads it here. is_seed lets the queue drop test posts.
CREATE OR REPLACE FUNCTION public.declutter_admin_reported_wanted(p_wanted_ids uuid[])
 RETURNS TABLE(wanted_id uuid, what text, poster_id uuid, status text, removed boolean, is_seed boolean, photo_paths text[], photos_held text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.user_id, w.status, w.removed_at IS NOT NULL, COALESCE(w.is_seed, false), w.photo_paths, w.photos_held
      FROM public.declutter_wanted w
     WHERE w.id = ANY (COALESCE(p_wanted_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_reported_wanted(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_reported_wanted(uuid[]) TO authenticated, service_role;

-- 8. Take a reported post down: it leaves every list, its photos stop showing, the poster reads why. The paths stay on
--    the row so the account purge still finds the files; Post again refuses a removed post (removed_at).
CREATE OR REPLACE FUNCTION public.declutter_admin_take_down_wanted(p_wanted_id uuid, p_note text, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND OR w.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF w.user_id = v_uid THEN
    RAISE EXCEPTION 'own_post' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_wanted' AND rp.reported_id = p_wanted_id) THEN
    RAISE EXCEPTION 'report_not_for_post' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET status = 'closed', closed_at = COALESCE(closed_at, now()), removed_at = now(), photos_cleared = '{}'
   WHERE id = p_wanted_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_wanted_taken_down', 'declutter_wanted', p_wanted_id::text,
          jsonb_build_object('note', v_note, 'report_id', p_report_id));
  PERFORM public.declutter_wanted_notify(w.user_id, 'Your Wanted post was taken down',
    format('Your Wanted for "%s" was taken down: %s', w.what, v_note), '/declutter?tab=wanted');
  RETURN 'removed';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_take_down_wanted(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_take_down_wanted(uuid, text, uuid) TO authenticated, service_role;

-- 9. A held photo an admin looked at and found fine: members see it now, and the report closes.
CREATE OR REPLACE FUNCTION public.declutter_admin_release_wanted_photos(p_wanted_id uuid, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  IF NOT FOUND OR w.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF w.user_id = v_uid THEN
    RAISE EXCEPTION 'own_post' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports rp
                  WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_wanted' AND rp.reported_id = p_wanted_id) THEN
    RAISE EXCEPTION 'report_not_for_post' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_wanted
     SET photos_cleared = photos_cleared || photos_held, photos_held = '{}'
   WHERE id = p_wanted_id;
  UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_wanted_photos_released', 'declutter_wanted', p_wanted_id::text,
          jsonb_build_object('report_id', p_report_id, 'paths', to_jsonb(w.photos_held)));
  RETURN 'released';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_release_wanted_photos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_release_wanted_photos(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Adding a photo stamps when, for the sweep's hour. Changed: the UPDATE only. Grants are unchanged.
CREATE OR REPLACE FUNCTION public.declutter_add_wanted_photo(p_wanted_id uuid, p_storage_path text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_w public.declutter_wanted%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_w FROM public.declutter_wanted WHERE id = p_wanted_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status <> 'open' OR v_w.expires_at <= now() THEN
    RAISE EXCEPTION 'wanted_not_open' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS post, and the object is really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'wanted'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_wanted_id::text
     OR split_part(p_storage_path, '/', 4) = ''
     OR split_part(p_storage_path, '/', 5) <> ''
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its GPS atoms (the app's re-encode strips
          -- images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_storage_path = ANY (v_w.photo_paths) THEN
    RETURN cardinality(v_w.photo_paths);
  END IF;
  IF cardinality(v_w.photo_paths) >= 3 THEN
    RAISE EXCEPTION 'wanted_too_many_photos' USING ERRCODE = '22023', HINT = 'A Wanted post has at most 3 photos.';
  END IF;

  UPDATE public.declutter_wanted SET photo_paths = photo_paths || p_storage_path, photo_added_at = now() WHERE id = p_wanted_id;
  RETURN cardinality(v_w.photo_paths) + 1;
END;
$fn$;

-- 11. What members see: only cleared photos. Changed: the photo columns and the LATERAL. Same columns, so no DROP.
CREATE OR REPLACE FUNCTION public.declutter_wanted_browse(p_lat numeric, p_lng numeric)
 RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, poster_name text, miles integer, expires_at timestamp with time zone, replied boolean, photo_path text, photo_paths text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_lat numeric := round(p_lat, 2);
  v_lng numeric := round(p_lng, 2);
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The same member gates as posting and replying (row 53: under 18 never reads adults' posts) (review #4).
  PERFORM public.declutter_assert_member(true);
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'wanted_area_unknown' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.category, w.max_price_cents, public.member_display_name(pr.full_name),
           public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng),
           w.expires_at,
           EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid),
           cleared.paths[1],
           cleared.paths
      FROM public.declutter_wanted w
      LEFT JOIN public.profiles pr ON pr.user_id = w.user_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(array_agg(p.path ORDER BY p.ord), ARRAY[]::text[]) AS paths
          FROM unnest(w.photo_paths) WITH ORDINALITY AS p(path, ord)
         WHERE p.path = ANY (w.photos_cleared)) cleared
     WHERE w.public
       AND w.status = 'open'
       AND w.expires_at > now()
       AND w.user_id <> v_uid
       AND pr.anonymized_at IS NULL
       AND NOT public.are_users_blocked(v_uid, w.user_id)
       AND NOT public.declutter_member_out(w.user_id)
       AND NOT public.member_under_18(w.user_id)
       AND NOT public.declutter_seller_hidden(w.user_id)
       AND (w.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
       AND public.declutter_wanted_snap_miles(v_lat, v_lng, w.area_lat, w.area_lng) <= w.radius_miles
     ORDER BY 6, w.created_at DESC
     LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_browse(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_browse(numeric, numeric) TO authenticated, service_role;

-- 12. The sweep files a photo whose check never came back. Changed: the new loop, ahead of the queue.
CREATE OR REPLACE FUNCTION public.declutter_wanted_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q record;
  e record;
  h record;
  v_items integer := 0;
  v_alerts integer := 0;
  v_failed integer := 0;
BEGIN
  -- Nobody can have the feature while either switch is off: empty the queue
  -- (a listing that goes live again later is queued again).
  IF NOT EXISTS (SELECT 1 FROM public.feature_switches s
                  WHERE s.key = 'declutter_wanted' AND s.audience IN ('testers', 'everyone'))
     OR NOT EXISTS (SELECT 1 FROM public.feature_switches s
                     WHERE s.key = 'declutter' AND s.audience IN ('testers', 'everyone')) THEN
    DELETE FROM public.declutter_wanted_queue;
    RETURN jsonb_build_object('items', 0, 'alerts', 0, 'failed', 0, 'switch', 'off');
  END IF;
  FOR e IN SELECT w.id, w.user_id, w.what FROM public.declutter_wanted w
            WHERE w.status = 'open' AND w.removed_at IS NULL AND w.expiry_told_at IS NULL
              AND w.expires_at > now() AND w.expires_at <= now() + interval '3 days'
            ORDER BY w.expires_at, w.id LIMIT 200 LOOP
    BEGIN
      UPDATE public.declutter_wanted SET expiry_told_at = now() WHERE id = e.id;
      IF public.declutter_wanted_alert_block(e.user_id) IS NULL THEN
        v_alerts := v_alerts + public.declutter_wanted_notify(e.user_id,
          'Your Wanted ends soon',
          'Your Wanted for "' || e.what || '" ends within 3 days. You can post it again from the Wanted tab once it ends.',
          '/declutter?tab=wanted');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_wanted_sweep', 'expiry:' || e.id::text, SQLERRM);
    END;
  END LOOP;
  -- A photo whose check never came back (the app closed, or the check kept failing) goes to an admin after an hour. It
  -- stays hidden from members meanwhile, so skipping the check never gets a photo shown.
  FOR h IN SELECT w.id FROM public.declutter_wanted w
            WHERE w.status = 'open' AND w.removed_at IS NULL AND w.photo_added_at <= now() - interval '1 hour'
              AND EXISTS (SELECT 1 FROM unnest(w.photo_paths) AS p(path)
                           WHERE NOT p.path = ANY (w.photos_cleared) AND NOT p.path = ANY (w.photos_held))
            ORDER BY w.photo_added_at, w.id LIMIT 200 LOOP
    BEGIN
      PERFORM public.declutter_wanted_hold_photos(h.id, NULL, 'The automatic photo check did not finish.');
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_wanted_sweep', 'photo:' || h.id::text, SQLERRM);
    END;
  END LOOP;
  FOR q IN SELECT * FROM public.declutter_wanted_queue ORDER BY queued_at, item_id LIMIT 200 LOOP
    BEGIN
      v_alerts := v_alerts + public.declutter_wanted_match_item(q.item_id);
      DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
      v_items := v_items + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      IF q.attempts + 1 >= 12 THEN
        -- Out of tries: drop the row (so a later go-live queues it afresh)
        -- and say so plainly.
        DELETE FROM public.declutter_wanted_queue WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text,
          'gave up after 12 tries, no wanted alerts for this listing: ' || SQLERRM);
      ELSE
        UPDATE public.declutter_wanted_queue SET attempts = attempts + 1 WHERE item_id = q.item_id;
        PERFORM public.log_cron_defect('declutter_wanted_sweep', q.item_id::text, SQLERRM);
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'alerts', v_alerts, 'failed', v_failed);
END;
$function$;

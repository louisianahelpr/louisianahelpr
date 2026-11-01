-- A seller who removes a photo, withdraws a listing or marks it sold elsewhere asks the database to detach the
-- photos, then deletes the storage objects from the app. On a "Have a Helpr list it" listing the Helpr uploaded the
-- photos into the HELPR's own folder (<helpr>/declutter/<item>/...), and storage RLS lets a member delete only their
-- own folder. Storage answers that refused delete with { data: [], error: null }, so nothing even logged it: the
-- object stayed PUBLIC by URL until the Helpr deleted their account (B59 open finding 2, measured by code read).
-- A seller who declined a listing the Helpr wrote kept its photos attached and public too.
--
-- Fix, server side:
--   1. declutter_photo_purge_queue: every declutter_item_photos row that is deleted (by any path: remove photo,
--      withdraw, sold elsewhere, decline, a deleted draft or account) queues its own storage_path, by an AFTER
--      DELETE trigger. The queue only ever holds paths of photo rows that existed, with that row's item and seller.
--   2. declutter_photo_purge_due / declutter_photo_purge_done (service role only): the declutter-photo-purge edge
--      function claims due paths and removes them THROUGH THE STORAGE API (never a storage.objects row in SQL), then
--      drops the claimed entries. A path still named by a photo row is never handed out. A refusal leaves the entry
--      queued (re-handed out after 15 minutes) and the run fails non-2xx; the 5th failed try is logged as a defect.
--   3. The app calls the same function right after the seller's change (it removes only the CALLER's own queued
--      paths, read from the verified JWT, never from the body); a cron every 15 minutes is the backstop.
--   4. declutter_decline_listed_for_me (restated from 20261101034159, the newest) now detaches the declined
--      listing's photos, so they go the same way.
--
-- No cron_catchup_policy row: that policy is for daily/weekly jobs only, and this one runs every 15 minutes.
--
-- REPLAY-SAFETY: CREATE ... IF NOT EXISTS / CREATE OR REPLACE; cron rows guarded by to_regclass / the
-- cron schema.

CREATE TABLE IF NOT EXISTS public.declutter_photo_purge_queue (
  storage_path text PRIMARY KEY
    CHECK (storage_path ~ '^[0-9a-f-]{36}/declutter/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  item_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  -- Only the object of THAT item's folder: the third segment is the item the photo row belonged to.
  CONSTRAINT declutter_photo_purge_queue_item_folder CHECK (split_part(storage_path, '/', 3) = item_id::text)
);
CREATE INDEX IF NOT EXISTS declutter_photo_purge_queue_seller_idx ON public.declutter_photo_purge_queue (seller_id);
ALTER TABLE public.declutter_photo_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_photo_purge_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_photo_purge_queue TO service_role;

-- 1. Every deleted photo row queues its object. SECURITY DEFINER: the delete may come from an account purge's
--    cascade (auth.users, run by the auth service role), which has no rights on this table.
CREATE OR REPLACE FUNCTION public.declutter_item_photo_queue_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  BEGIN
    INSERT INTO public.declutter_photo_purge_queue (storage_path, item_id, seller_id)
    VALUES (OLD.storage_path, OLD.item_id, OLD.seller_id)
    ON CONFLICT (storage_path) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- The seller's change already happened and must not be undone; a photo that could not be queued is logged where
    -- ops reads, with its path, so it can be removed by hand.
    PERFORM public.log_cron_defect('declutter_item_photo_queue_purge', OLD.storage_path, SQLERRM,
      jsonb_build_object('item_id', OLD.item_id, 'seller_id', OLD.seller_id));
  END;
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_photo_queue_purge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_item_photo_queue_purge ON public.declutter_item_photos;
CREATE TRIGGER declutter_item_photo_queue_purge
  AFTER DELETE ON public.declutter_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.declutter_item_photo_queue_purge();

-- 2. Claim what is due, row-locked (SKIP LOCKED). p_seller: only that seller's own entries (the app's call, the id
--    taken from the verified JWT by the edge function); NULL: everyone's (the cron). A path a photo row still names is
--    never handed out (and its entry is dropped). A claim older than 15 minutes (a run that died) is handed out again.
CREATE OR REPLACE FUNCTION public.declutter_photo_purge_due(p_limit integer DEFAULT 200, p_seller uuid DEFAULT NULL)
RETURNS TABLE (storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
BEGIN
  DELETE FROM public.declutter_photo_purge_queue q
   WHERE (p_seller IS NULL OR q.seller_id = p_seller)
     AND EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.storage_path = q.storage_path);
  -- A path that failed 5 times is told to ops once (it stays queued and is still retried).
  FOR r IN
    SELECT q.storage_path, q.item_id, q.seller_id, q.attempts FROM public.declutter_photo_purge_queue q
     WHERE (p_seller IS NULL OR q.seller_id = p_seller) AND q.attempts = 5
       AND q.claimed_at IS NOT NULL AND q.claimed_at <= now() - interval '15 minutes'
  LOOP
    PERFORM public.log_cron_defect('declutter-photo-purge', r.storage_path, 'photo object not removed after 5 tries',
      jsonb_build_object('item_id', r.item_id, 'seller_id', r.seller_id));
  END LOOP;
  RETURN QUERY
  WITH pick AS (
    SELECT q.storage_path AS sp
      FROM public.declutter_photo_purge_queue q
     WHERE (p_seller IS NULL OR q.seller_id = p_seller)
       AND (q.claimed_at IS NULL OR q.claimed_at <= now() - interval '15 minutes')
     ORDER BY q.queued_at, q.storage_path
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
       FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.declutter_photo_purge_queue q
     SET claimed_at = now(), attempts = q.attempts + 1
    FROM pick
   WHERE q.storage_path = pick.sp
  RETURNING q.storage_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photo_purge_due(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_photo_purge_due(integer, uuid) TO service_role;

-- After Storage removed them: only the CLAIMED entries go (a path reported done that was never handed out changes
-- nothing).
CREATE OR REPLACE FUNCTION public.declutter_photo_purge_done(p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.declutter_photo_purge_queue q
   WHERE q.storage_path = ANY (COALESCE(p_paths, '{}'::text[])) AND q.claimed_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_photo_purge_done(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_photo_purge_done(text[]) TO service_role;

-- 4. Restated from 20261101034159 (the newest CREATE); one change: the declined listing's photos are detached.
CREATE OR REPLACE FUNCTION public.declutter_decline_listed_for_me(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_link record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_items i SET status = 'withdrawn', updated_at = now()
    FROM public.declutter_listed_for_seller l
   WHERE i.id = p_item_id AND l.item_id = i.id AND i.seller_id = v_uid AND l.seller_id = v_uid
     AND i.status = 'pending_seller_approval';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- B63: a declined listing is never shown again, so its photos are detached like a withdraw's; the AFTER DELETE
  -- trigger queues their objects (they sit in the HELPR's folder, which the seller's app cannot delete).
  DELETE FROM public.declutter_item_photos WHERE item_id = p_item_id;
  UPDATE public.declutter_listed_for_seller l SET decided_at = now() WHERE l.item_id = p_item_id
  RETURNING l.job_id, l.helpr_id, (SELECT i.title FROM public.declutter_items i WHERE i.id = l.item_id) AS title,
            (SELECT public.member_display_name(p.full_name, 'The seller') FROM public.profiles p WHERE p.user_id = l.seller_id) AS seller_name
    INTO v_link;
  -- Tell the Helpr who wrote it (B55 open item e). In-app only, on their job. Test data never reaches a real member:
  -- a seed seller's decline is not sent to a Helpr who is not seed.
  IF v_link.helpr_id IS NOT NULL
     AND NOT (EXISTS (SELECT 1 FROM public.profiles s WHERE s.user_id = v_uid AND s.is_seed)
              AND NOT EXISTS (SELECT 1 FROM public.profiles h WHERE h.user_id = v_link.helpr_id AND h.is_seed)) THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_link.helpr_id, 'A listing wasn''t used',
              format('%s chose not to put "%s" on sale. Nothing else changes for your job.',
                     COALESCE(v_link.seller_name, 'The seller'), v_link.title),
              'job_update', '/jobs?job=' || v_link.job_id::text, v_link.job_id);
    EXCEPTION WHEN OTHERS THEN
      -- The decline already happened; a lost notice must not undo it. Logged where ops reads.
      PERFORM public.log_cron_defect('declutter_decline_listed_for_me', p_item_id::text, SQLERRM,
        jsonb_build_object('helpr_id', v_link.helpr_id, 'job_id', v_link.job_id));
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_decline_listed_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_decline_listed_for_me(uuid) TO authenticated, service_role;

-- 3. The backstop: every 15 minutes, everyone's due paths (the app's own call after each change does the same for the
--    caller at once).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-photo-purge', interval '1 hour',
            'Declutter (B63): every 15 minutes, deletes through the Storage API the objects of deleted declutter_item_photos rows (a Helpr-uploaded photo the seller removed, withdrew or declined).',
            'exempt',
            'The app removes most objects at once, so a run that deletes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-photo-purge', '13,28,43,58 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'declutter-photo-purge')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/declutter-photo-purge',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;

-- Q807: every public table carries the unconfirmed-email statement gate (db-smoke's
-- scripts/ci/unconfirmed-email-gate.sql; added by L20 on train 12's replay red, 2026-11-01).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

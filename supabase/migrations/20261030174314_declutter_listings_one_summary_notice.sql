-- Sell a bunch audit, finding 14 (owner chose all 15 findings, 2026-10-30): listing 50 items sent 50 pushes, one
-- "Your listing is live" each. 20261028200440 removed the old 10-minute skip because it dropped the second listing's
-- notice altogether (A3-4). This keeps every listing told, in ONE notice:
--
--   declutter_listing_submitted_notice (restated from 20261028200440, the effective prod definition read with
--   pg_get_functiondef 2026-10-30): the first listing still inserts its named notice, with its one push. While that
--   notice is unread and under 10 minutes old, the next listing updates it to "3 listings are live" instead of adding
--   a row. notifications_fan_out_to_push and _to_sms are AFTER INSERT, so an update sends nothing. created_at moves
--   forward each time, so 10 minutes is the gap between listings, not the whole run (50 items take over 12 minutes).
--   A notice the seller has read is left alone: the next listing is news, with its own push.
--
-- Only this trigger's own notices are rolled up. The approval RPC's "Your listing is live" (declutter_admin_review_item)
-- links to Selling, not an item, and names what was approved, so it is never counted or rewritten. Going live and going
-- to review are separate titles, so each is counted on its own.
-- CREATE OR REPLACE keeps the trigger. Proof: src/test/pglite/declutterBunchOneNotice.pglite.mjs (applied 3x).
CREATE OR REPLACE FUNCTION public.declutter_listing_submitted_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text;
  v_name text := COALESCE(NULLIF(btrim(NEW.title), ''), 'Your item');
  v_prior uuid;
  v_prior_message text;
  v_n integer;
BEGIN
  IF NEW.status NOT IN ('pending_review', 'live')
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_title := CASE WHEN NEW.status = 'live' THEN 'Your listing is live' ELSE 'Listing sent for review' END;
    -- Locked, so two listings finishing together still both count.
    SELECT n.id, n.message INTO v_prior, v_prior_message
      FROM public.notifications n
     WHERE n.user_id = NEW.seller_id
       AND n.type = 'declutter_listings'
       AND n.read = false
       AND n.created_at > now() - interval '10 minutes'
       AND CASE WHEN NEW.status = 'live'
             THEN n.title = 'Your listings are live'
               OR (n.title = 'Your listing is live' AND n.link LIKE '/declutter/item/%')
             ELSE n.title IN ('Listing sent for review', 'Listings sent for review')
           END
     ORDER BY n.created_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_prior IS NOT NULL THEN
      -- A named notice counts as one; a summary says its own count.
      v_n := COALESCE(substring(v_prior_message FROM '^([0-9]+) listings ')::integer, 1) + 1;
      UPDATE public.notifications
         SET title = CASE WHEN NEW.status = 'live' THEN 'Your listings are live' ELSE 'Listings sent for review' END,
             message = CASE WHEN NEW.status = 'live'
                         THEN v_n || ' listings are live. Buyers can see them now.'
                         ELSE v_n || ' listings are being checked before buyers see them. We''ll tell you when they''re live.'
                       END,
             link = '/declutter?tab=selling',
             created_at = now()
       WHERE id = v_prior;
      RETURN NULL;
    END IF;
    IF NEW.status = 'live' THEN
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        '"' || v_name || '" is live. Buyers can see it now.',
        '/declutter/item/' || NEW.id::text);
    ELSE
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        'We''re checking "' || v_name || '" before buyers see it. We''ll tell you when it''s live.',
        '/declutter?tab=selling');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_listing_submitted_notice: item %: %', NEW.id, SQLERRM;
    PERFORM public.log_cron_defect('declutter_listing_submitted_notice', NEW.id::text, SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listing_submitted_notice() FROM PUBLIC, anon, authenticated;

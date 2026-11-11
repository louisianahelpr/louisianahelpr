-- F484 (whole-app audit 11-10, Worker 6, Suggestion): the rolled-up "Your listings are live" notice (and its email,
-- button "See your listings") said only "10 listings are live. Buyers can see them now." with no list of which items.
--
-- Now: '10 listings are live, including "Lamp", "Rug" and "Chair". Buyers can see them now.' The names are the
-- seller's newest live listings that buyers can see (not seller_hidden; by live_at, else created_at), at most three and never more than the count, so a
-- run of 2 names 2 and never an older listing. The message still starts with the count, which the next listing
-- parses ('^([0-9]+) listings '). A blank title reads "Your item", as the single notice does. The review roll-up
-- ("Listings sent for review") and every other branch are unchanged.
--
-- declutter_listing_submitted_notice is restated VERBATIM from its newest definition (20261030174314), changing only
-- the live summary message (marked CHANGED 20261111200834). Replay-safe: CREATE OR REPLACE keeps the trigger; grants
-- restated as live. Proof: src/test/pglite/listingsLiveNoticeNamesThem.pglite.mjs (red without, green with, 3x).

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
  v_names text;
  v_list text[];
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
      -- CHANGED 20261111200834 (F484): the newest live listings, at most three and never more than the count.
      -- Its own block: a failure here costs only the names, never the roll-up.
      IF NEW.status = 'live' THEN
       BEGIN
        SELECT array_agg('"' || COALESCE(NULLIF(btrim(x.title), ''), 'Your item') || '"' ORDER BY x.at DESC, x.id)
          INTO v_list
          FROM (SELECT i.id, i.title, COALESCE(i.live_at, i.created_at) AS at
                  FROM public.declutter_items i
                 WHERE i.seller_id = NEW.seller_id AND i.status = 'live' AND NOT COALESCE(i.seller_hidden, false)
                 ORDER BY COALESCE(i.live_at, i.created_at) DESC, i.id
                 LIMIT LEAST(v_n, 3)) x;
        v_names := CASE
          WHEN COALESCE(cardinality(v_list), 0) = 0 THEN NULL
          WHEN cardinality(v_list) = 1 THEN v_list[1]
          ELSE array_to_string(v_list[1:cardinality(v_list) - 1], ', ') || ' and ' || v_list[cardinality(v_list)] END;
       EXCEPTION WHEN OTHERS THEN
        v_names := NULL;
        RAISE WARNING 'declutter_listing_submitted_notice: names for item %: %', NEW.id, SQLERRM;
       END;
      END IF;
      UPDATE public.notifications
         SET title = CASE WHEN NEW.status = 'live' THEN 'Your listings are live' ELSE 'Listings sent for review' END,
             message = CASE WHEN NEW.status = 'live'
                         THEN v_n || ' listings are live' || COALESCE(', including ' || v_names, '') || '. Buyers can see them now.'
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

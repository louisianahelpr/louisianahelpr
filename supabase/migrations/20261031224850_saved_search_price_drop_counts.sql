-- BUY-52, count half (buying audit 10-30 #52): a price drop into a saved search's budget never counted in its "N new".
-- saved_search_new_counts counts by live_at only, so a $60 lamp dropped to $40 was never "new" to a "lamp, up to $50"
-- search. (The alert half is 20261031220326, PR #3906; this file never edits it.)
--
-- Now:
--   * declutter_item_price_drops: every price drop on a live listing is written down (when, from what, to what) by
--     saved_search_on_item_price_drop, the function 20261031220326's trigger already calls (the trigger is unchanged).
--     The count reads it: the alert's match rows exist only for searches with alerts on.
--   * declutter_dropped_into_budget(since, top): live listings whose price dropped from OVER `top` (dollars) since
--     `since` and are now within it. No top price: none. Ids only, no past prices leave the database. The count uses
--     it, and Browse opened from a saved search (resultsPath's new= and max=) marks the same ids New.
--   * saved_search_new_counts: a Declutter search's "N new" also takes those listings. Counted once however many drops
--     (the count is of listings).
--
-- RESTATED FROM (newest CREATEs, checked 2026-10-31 17:49 CT): saved_search_on_item_price_drop from
-- 20261031220326_saved_search_price_drop_alerts.sql; saved_search_new_counts from
-- 20261031222115_saved_search_keeps_declutter_filters.sql (BUY-13, the file before this one; it restates origin/main's
-- 20261031023451). One change in each (marked BUY-52). No money moves.
-- REPLAY-SAFE: IF NOT EXISTS; CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

CREATE TABLE IF NOT EXISTS public.declutter_item_price_drops (
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  from_cents integer NOT NULL,
  to_cents integer NOT NULL
);
CREATE INDEX IF NOT EXISTS declutter_item_price_drops_item_at ON public.declutter_item_price_drops (item_id, at);
-- Read only through the definer functions below; no member reads the rows.
ALTER TABLE public.declutter_item_price_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_price_drops FROM PUBLIC, anon, authenticated;

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
GRANT ALL ON TABLE public.declutter_item_price_drops TO service_role;

CREATE OR REPLACE FUNCTION public.saved_search_on_item_price_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- BUY-52 count half: the drop is written down for the "N new" count.
  INSERT INTO public.declutter_item_price_drops (item_id, from_cents, to_cents)
  VALUES (NEW.id, OLD.current_price_cents, NEW.current_price_cents);
  INSERT INTO public.saved_search_item_queue (item_id) VALUES (NEW.id)
  ON CONFLICT (item_id) DO UPDATE SET attempts = 0, retry_after = NULL, queued_at = now();
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.saved_search_on_item_price_drop() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_dropped_into_budget(p_since timestamptz, p_max_budget numeric)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT d.item_id
    FROM public.declutter_item_price_drops d
    JOIN public.declutter_items i ON i.id = d.item_id AND i.status = 'live'
   WHERE p_max_budget IS NOT NULL
     AND p_since IS NOT NULL
     AND d.at > p_since
     AND d.from_cents > p_max_budget * 100
     AND i.current_price_cents <= p_max_budget * 100
     -- A definer any signed-in member can call: the declutter_items SELECT policy (20261020033623) for the caller, as
     -- saved_search_new_counts' Declutter branch applies it, so no id comes back that the caller could not read.
     AND (SELECT public.feature_enabled_for('declutter'))
     AND NOT public.declutter_seller_hidden(i.seller_id)
     AND (NOT i.is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
     AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = (SELECT auth.uid()) AND b.blocked_id = i.seller_id)
                         OR (b.blocker_id = i.seller_id AND b.blocked_id = (SELECT auth.uid())));
$function$;
REVOKE ALL ON FUNCTION public.declutter_dropped_into_budget(timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_dropped_into_budget(timestamptz, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.saved_search_new_counts()
 RETURNS TABLE(search_id uuid, new_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    s.id,
    CASE s.section
      WHEN 'jobs' THEN (
        SELECT count(*)::integer
          FROM public.open_jobs_browse j
         WHERE j.created_at > COALESCE(s.last_seen_at, s.created_at)
           AND j.customer_id IS DISTINCT FROM s.user_id
           AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                            WHERE (b.blocker_id = s.user_id AND b.blocked_id = j.customer_id)
                               OR (b.blocker_id = j.customer_id AND b.blocked_id = s.user_id))
           AND public.saved_search_category_matches(s.category, j.category)
           AND (s.parish IS NULL OR s.parish = j.parish)
           AND (s.max_budget IS NULL OR j.budget <= s.max_budget)
           AND (s.min_budget IS NULL OR j.budget >= s.min_budget)
           AND (s.query IS NULL OR btrim(s.query) = ''
                OR strpos(lower(j.title), lower(btrim(s.query))) > 0
                OR strpos(lower(COALESCE(j.description, '')), lower(btrim(s.query))) > 0)
           AND (s.location_keyword IS NULL OR s.location_keyword ~ '^nearby:'
                OR strpos(lower(COALESCE(j.location, '')), lower(s.location_keyword)) > 0)
           AND (s.radius_miles IS NULL
                OR (p.latitude IS NOT NULL AND p.longitude IS NOT NULL
                    AND j.latitude IS NOT NULL AND j.longitude IS NOT NULL
                    AND public.miles_between(p.latitude, p.longitude, j.latitude, j.longitude) <= s.radius_miles)
                OR ((p.latitude IS NULL OR p.longitude IS NULL OR j.latitude IS NULL OR j.longitude IS NULL)
                    AND p.parish IS NOT NULL AND j.parish IS NOT NULL AND p.parish = j.parish))
      )
      WHEN 'declutter' THEN (
        SELECT count(*)::integer
          FROM public.declutter_items i
         WHERE i.status = 'live'
           -- BUY-52: new since the last look, or dropped into this search's budget since then.
           AND (i.live_at > COALESCE(s.last_seen_at, s.created_at)
                OR i.id IN (SELECT public.declutter_dropped_into_budget(COALESCE(s.last_seen_at, s.created_at), s.max_budget)))
           AND i.seller_id <> s.user_id
           -- The declutter_items SELECT policy (20261020033623), for the caller:
           AND (SELECT public.feature_enabled_for('declutter'))
           AND NOT public.declutter_seller_hidden(i.seller_id)
           AND (NOT i.is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
           AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                            WHERE (b.blocker_id = s.user_id AND b.blocked_id = i.seller_id)
                               OR (b.blocker_id = i.seller_id AND b.blocked_id = s.user_id))
           AND (s.category IS NULL OR s.category = i.category)
           AND (s.max_budget IS NULL OR i.current_price_cents <= s.max_budget * 100)
           AND (s.min_budget IS NULL OR i.current_price_cents >= s.min_budget * 100)
           -- Declutter Browse's rule (DA-1): every word, in the title, description or category, plurals folded.
           AND public.declutter_search_matches(s.query, i.title, i.description, i.category)
           -- BUY-13: Free, porch pickup, price drops and condition, as Declutter Browse applies them.
           AND (NOT s.free_only OR i.current_price_cents = 0)
           AND (NOT s.porch_only OR i.porch_ok)
           AND (NOT s.drops_only OR (i.sale_mode = 'offers' AND NOT i.drops_stopped AND COALESCE(i.drop_pct, 5) > 0))
           AND (cardinality(s.conditions) = 0 OR i.condition_stars = ANY (s.conditions))
           AND (s.radius_miles IS NULL
                OR (COALESCE(s.origin_lat, p.latitude) IS NOT NULL AND COALESCE(s.origin_lng, p.longitude) IS NOT NULL
                    AND public.miles_between(COALESCE(s.origin_lat, p.latitude), COALESCE(s.origin_lng, p.longitude), i.area_lat::numeric, i.area_lng::numeric) <= s.radius_miles))
      )
      ELSE 0
    END
  FROM public.saved_searches s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saved_search_new_counts() TO authenticated;

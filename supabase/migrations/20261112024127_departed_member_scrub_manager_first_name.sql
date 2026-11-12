-- Departed-member scrub, handoff item 3 (lead 11-11): Declutter MANAGER-MODE notices name the other side by first name
-- only (declutter_manager_first_name = the first word of member_display_name: "Ann is managing your Declutter",
-- "Ann listed "Lamp" for you. Review and post it.", "Ann posted ...", "Ann sent ... back", "Ann stopped managing ...";
-- 20261101181005). Neither the full name nor "Ann S." matches those, so after a member deleted their account their
-- first name stayed in their seller's or manager's bell. Prod has 0 manager grants today (measured read-only by the
-- previous lane); this is built so the first one is covered.
--
-- scrub_departed_member_name_from_notifications() restated VERBATIM from 20261112005443_declutter_departed_member_name_leaves_notices.sql
-- (its newest definition; trigger trg_scrub_departed_member_name from 20261103022806 unchanged) with one more step
-- after the loop, marked "CHANGED 20261112024127": the bare first name (whole word, case-sensitive) becomes "a former
-- member" in exactly the places manager-mode templates put it: the start of the title or message (not followed by an
-- initial), "You earned $X from <First>'s sale of" and the handover split "· $X to <First> (10%) · $Y" (20261109224952);
-- only in a Declutter notice (no job_id, link '/declutter%') to a member with a declutter_manager_grants row with the
-- departed member on the other side. The one-word-name early return is unchanged here (the next migration handles one-word names).
-- Replay-safe: CREATE OR REPLACE of the same signature; grants restated as before.
-- Proof: src/test/pglite/departedScrubManagerFirstName.pglite.mjs. Sensitive: privacy (another member's name).

CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full text := btrim(coalesce(OLD.full_name, ''));
  v_name text;
  v_rx text;
  v_first text; -- CHANGED 20261112024127: the first word of member_display_name, as declutter_manager_first_name says it.
  v_esc text;        -- CHANGED 20261112024127: v_first, regex-escaped.
  v_rx_share text;   -- CHANGED 20261112024127: "You earned $X from <First>'s sale of".
  v_rx_split text;   -- CHANGED 20261112024127: "· $X to <First> (10%) · $Y".
BEGIN
  IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL OR v_full !~ '\s' THEN
    RETURN NEW;
  END IF;
  -- Longest first: the full name, then its "First L." form.
  FOREACH v_name IN ARRAY ARRAY[v_full, public.member_display_name(OLD.full_name, NULL)] LOOP
    CONTINUE WHEN v_name IS NULL OR v_name = '';
    v_rx := '\m' || regexp_replace(v_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?!\w)';
    UPDATE public.notifications n
       -- CHANGED 20261112005443: also capitalised after a sentence end ("No money changes hands. A former member ...").
       SET title   = regexp_replace(regexp_replace(regexp_replace(n.title, '^' || v_rx, 'A former member'),
                       '([.!?]\s+)' || v_rx, '\1A former member', 'g'), v_rx, 'a former member', 'g'),
           message = regexp_replace(regexp_replace(regexp_replace(n.message, '^' || v_rx, 'A former member'),
                       '([.!?]\s+)' || v_rx, '\1A former member', 'g'), v_rx, 'a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx)
       -- CHANGED 20261112005443: a job notice tied to the departed member as before, OR (Declutter) a notice with no
       -- job whose link is a Declutter page, sent to someone who traded with the departed member on Declutter.
       AND ((n.job_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.jobs j
                     WHERE j.id = n.job_id AND OLD.user_id IN (j.customer_id, j.helper_id))
         OR EXISTS (SELECT 1 FROM public.applications a
                     WHERE a.job_id = n.job_id AND a.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                     WHERE g.job_id = n.job_id AND g.helper_id = OLD.user_id)
         -- Q2331 review (lh-authz-rls, 11-03): a series Helpr is a party to the series parent through these
         -- rows, not through jobs/applications/group_job_helpers, so "Bea T. gave up <date>" (job_id = the
         -- parent) left her name in the poster's bell. purge_user_data deletes none of them before 4e.
         OR EXISTS (SELECT 1 FROM public.recurring_visit_releases r
                     WHERE r.parent_job_id = n.job_id AND r.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_date_offers o
                     WHERE o.parent_job_id = n.job_id AND o.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.series_visit_holds h
                     WHERE h.parent_job_id = n.job_id AND h.helper_id = OLD.user_id)))
         OR (n.job_id IS NULL
             AND coalesce(n.link, '') LIKE '/declutter%'
             AND (EXISTS (SELECT 1 FROM public.declutter_offers o
                           WHERE (o.buyer_id = OLD.user_id AND o.seller_id = n.user_id)
                              OR (o.seller_id = OLD.user_id AND o.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_swap_offers s
                           WHERE (s.buyer_id = OLD.user_id AND s.seller_id = n.user_id)
                              OR (s.seller_id = OLD.user_id AND s.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                           WHERE (c.buyer_id = OLD.user_id AND c.seller_id = n.user_id)
                              OR (c.seller_id = OLD.user_id AND c.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_orders d
                           WHERE (d.buyer_id = OLD.user_id AND d.seller_id = n.user_id)
                              OR (d.seller_id = OLD.user_id AND d.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_bundle_requests b
                           WHERE (b.buyer_id = OLD.user_id AND b.seller_id = n.user_id)
                              OR (b.seller_id = OLD.user_id AND b.buyer_id = n.user_id))
               OR EXISTS (SELECT 1 FROM public.declutter_free_requests f
                           WHERE (f.requester_id = OLD.user_id AND f.seller_id = n.user_id)
                              OR (f.seller_id = OLD.user_id AND f.requester_id = n.user_id)))))
       AND NOT (coalesce(n.link, '') LIKE '/admin%'
                AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'));
  END LOOP;
  -- CHANGED 20261112024127: Declutter manager-mode notices name the other side by FIRST NAME only ("Ann listed "Lamp" for you",
  -- "Ann is managing your Declutter", "Ann stopped managing ..."; declutter_manager_first_name, 20261101181005), which
  -- neither form above matches. Only these exact places are rewritten, in a Declutter notice (no job, link
  -- '/declutter%') sent to a member who has a declutter_manager_grants row with the departed member on the other side
  -- (seller or manager, any status; purge_user_data deletes no grant before step 4e):
  --   * the first name at the very START of the title or message, not followed by an initial ("Ann O." is someone
  --     else: the departed member's own "Ann S." was already rewritten by the loop above) -> "A former member";
  --   * the manager's share notice "You earned $X from Ann's sale of ..." (20261109224952) -> "from a former member's";
  --   * the seller's handover split "... · $X to Ann (10%) · $Y to you." (20261109224952) -> "to a former member".
  v_first := split_part(coalesce(public.member_display_name(OLD.full_name, NULL), ''), ' ', 1);
  IF v_first <> '' THEN
    v_esc := regexp_replace(v_first, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
    v_rx := '^' || v_esc || '(?!\w)(?! \w\.)';
    v_rx_share := '(You earned \$[0-9.]+ from )' || v_esc || '(?=''s sale of )';
    v_rx_split := '( · \$[0-9.]+ to )' || v_esc || '(?=( \([0-9]+%\))? · \$)';
    UPDATE public.notifications n
       SET title   = regexp_replace(n.title, v_rx, 'A former member'),
           message = regexp_replace(regexp_replace(regexp_replace(n.message, v_rx, 'A former member'),
                       v_rx_share, '\1a former member'), v_rx_split, '\1a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx
            OR coalesce(n.message, '') ~ v_rx_share OR coalesce(n.message, '') ~ v_rx_split)
       AND n.job_id IS NULL
       AND coalesce(n.link, '') LIKE '/declutter%'
       AND EXISTS (SELECT 1 FROM public.declutter_manager_grants g
                    WHERE (g.seller_id = OLD.user_id AND g.manager_id = n.user_id)
                       OR (g.manager_id = OLD.user_id AND g.seller_id = n.user_id));
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated;

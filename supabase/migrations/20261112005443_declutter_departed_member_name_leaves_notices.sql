-- F356 follow-up privacy fix (lead 11-11, with the owner's "name the buyer everywhere"): when a member deletes their
-- account, their name leaves other members' DECLUTTER notices too, not only job notices. Since 20261112003050 /
-- 20261112004748 the seller's offer, bundle, expiry and take_item notices say "Ann S. ...", and the "New trade offer"
-- notice (declutter_offer_swap, 20261111201159) already did; the departed-member scrub (20261103022806, restated in
-- 20261104050109) only rewrote notices with a job_id, and Declutter notices have none, so the name stayed.
--
-- scrub_departed_member_name_from_notifications() restated VERBATIM from 20261104050109_notices_name_the_person.sql
-- (its newest definition; the trigger trg_scrub_departed_member_name from 20261103022806 is unchanged) with one more
-- branch, marked "CHANGED 20261112005443": a notice with NO job_id, whose link is a Declutter page ('/declutter%'), sent
-- to a member who has a Declutter row with the departed member on the other side: declutter_offers,
-- declutter_swap_offers, declutter_cart_items, declutter_orders, declutter_bundle_requests or declutter_free_requests
-- (buyer/seller, requester/seller, either way round). The same rewrite as for job notices: the full name, then its
-- "First L." form, become "A former member" / "a former member"; the departed member's own notices and admin notices
-- are untouched; nothing else in the row changes. Also (both branches): after a sentence end the replacement is
-- capitalised ("No money changes hands. A former member offered ..."), where it read "a former member".
-- Those Declutter rows still exist when the trigger fires: it fires as purge_user_data step 4e sets anonymized_at,
-- and purge_user_data (newest definition 20261006204113) deletes no Declutter table; they go only with the auth user,
-- after (ON DELETE CASCADE).
-- Replay-safe: CREATE OR REPLACE of the same signature; grants restated as in 20261104050109.
-- Proof: src/test/pglite/declutterDepartedNameLeavesNotices.pglite.mjs. Sensitive: privacy (another member's name).

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
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated;

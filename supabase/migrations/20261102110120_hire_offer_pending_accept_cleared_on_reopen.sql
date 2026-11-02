-- Q2641 (found by Builder 174 in the Q2604 PGlite proof, lead 11-02): trg_jobs_clear_accept_pending did not remove a
-- Hire's pending accept (job_accept_pending) when the job reopened (the offer expired, or the poster withdrew it).
-- Its keep-rule is NOT (hire arm OR direct arm). On a reopened job the hire arm is false, and the direct arm compared
-- NEW.offered_to_helper_id (NULL on a Hire's job) with =, which is NULL; NOT (false OR NULL) is NULL, so the DELETE
-- skipped the row. The stale row stayed in job_accept_pending: card-hold-sweep's completePendingAccept re-reads the
-- job and refuses it (nothing was ever charged or hired), but the row was never removed.
--
-- Restated from its newest definition, 20261006204113_job_materials_and_access_notes.sql (prod md5(prosrc)
-- 843844a377c959a18bc2c7f7597a7d15 = that file, read 2026-11-02 shortly before 5:05 AM CT). Only the direct arm's two comparisons
-- change, to IS NOT DISTINCT FROM (null-safe: p.helper_id is NOT NULL, so a NULL column reads false, never NULL). The
-- trigger is unchanged; CREATE OR REPLACE keeps the ACL (postgres, service_role), restated below as live.
-- Proof: src/test/pglite/posterWithdrawsAnOffer.pglite.mjs (Q2641 checks).

CREATE OR REPLACE FUNCTION public.clear_job_accept_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  -- Q1185: a pending accept stays while the row still describes a live offer
  -- for its Helpr: a Hire's offer (accepted, theirs, unconfirmed) or a direct
  -- offer (open, offered to them, pending). Anything else ends it.
  DELETE FROM public.job_accept_pending p
   WHERE p.job_id = NEW.id
     AND NOT (
           (NEW.status::text = 'accepted' AND NEW.helper_id = p.helper_id AND NEW.helper_confirmed_at IS NULL)
        OR (NEW.status::text = 'open' AND NEW.helper_id IS NULL
            AND NEW.offered_to_helper_id IS NOT DISTINCT FROM p.helper_id AND NEW.direct_offer_status IS NOT DISTINCT FROM 'pending'));

  -- A direct offer's yes was given to the terms on screen at the tap: when,
  -- where, what, the pay and the series. If the poster changes them while it
  -- waits on setup, it is never completed on terms the Helpr did not see
  -- (final review #2: the poster moved a pending direct accept's date, start
  -- and place, and Stripe then booked the Helpr on them; Q423's schedule lock
  -- reads helper_id, NULL on a direct offer). The yes ends and the Helpr is
  -- told; the poster was never told of the yes, so their edit is neither
  -- refused nor reported. Direct offers only (the job is open): a Hire's
  -- schedule moves only through the agreed-change RPC, which both sides
  -- accept, and its yes protects the Helpr from the expiry strike (re-review
  -- of the final fixes, must-fix 2 and 3). Coordinates are not terms: only
  -- the geocoders write them, and the Helpr never sees them (must-fix 1).
  IF NEW.status::text = 'open'
     AND (OLD.date_needed, OLD.start_time, OLD.estimated_hours, OLD.is_flexible_schedule,
          OLD.location, OLD.parish, OLD.zip_code,
          OLD.title, OLD.description, OLD.category, OLD.special_requirements, OLD.photos,
          OLD.scope_video_url, OLD.require_photo_proof,
          OLD.budget, OLD.pricing_mode, OLD.is_urgent, OLD.urgent_fee,
          OLD.is_recurring, OLD.recurrence_interval, OLD.recurrence_days, OLD.recurrence_weeks,
          OLD.recurrence_end_date, OLD.series_split_ok, OLD.materials_note)
         IS DISTINCT FROM
         (NEW.date_needed, NEW.start_time, NEW.estimated_hours, NEW.is_flexible_schedule,
          NEW.location, NEW.parish, NEW.zip_code,
          NEW.title, NEW.description, NEW.category, NEW.special_requirements, NEW.photos,
          NEW.scope_video_url, NEW.require_photo_proof,
          NEW.budget, NEW.pricing_mode, NEW.is_urgent, NEW.urgent_fee,
          NEW.is_recurring, NEW.recurrence_interval, NEW.recurrence_days, NEW.recurrence_weeks,
          NEW.recurrence_end_date, NEW.series_split_ok, NEW.materials_note) THEN
    WITH gone AS (
      DELETE FROM public.job_accept_pending p WHERE p.job_id = NEW.id RETURNING p.helper_id
    )
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT g.helper_id,
           'The job changed',
           'The details of "' || COALESCE(NEW.title, 'the job')
             || '" changed after you tapped Accept, so your accept was not completed.'
             -- "still yours" only while it is (re-review should-fix 6)
             || CASE WHEN NEW.direct_offer_expires_at IS NULL OR NEW.direct_offer_expires_at > now()
                     THEN ' The offer is still yours: look at the new details and tap Accept again if they work for you.'
                     ELSE '' END,
           'job_updates',
           '/jobs?job=' || NEW.id::text,
           NEW.id
      FROM gone g;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clear_job_accept_pending() FROM PUBLIC, anon, authenticated;

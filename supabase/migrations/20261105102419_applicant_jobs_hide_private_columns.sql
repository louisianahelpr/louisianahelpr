-- Q2742 HIGH (Builder 3, 2026-11-05): get_jobs_for_my_applications (SECURITY DEFINER, RETURNS SETOF jobs) handed every
-- applicant the whole jobs row of every job they applied to: stripe_session_id, stripe_payment_intent_id,
-- flag_reasons, removal_reason, removed_by, chargeback_evidence_due_by, dispute and proof columns included. Measured on
-- prod 11-05 (read-only): authenticated has column SELECT on 125 of 126 jobs columns but no table SELECT, and the jobs
-- SELECT policies (own job, user_may_see_job_address, targeted direct offer, admin) show an applicant who was not
-- picked no row at all, so for those rows this definer was the only door and it opened every column.
--
-- Now: a caller who is the poster, the hired Helpr, or may see the address (user_may_see_job_address: the picked /
-- crew helpers, the same test the "Selected helpers can view their job" policy uses) still gets the full row, as a
-- direct SELECT would show them. Anyone else gets those columns NULL (arrays empty), the same row shape. Every other
-- column, the WHERE clause and the location masking are byte-for-byte as before.
--
-- Restated from 20261006023437_crew_free_spot_relisted.sql, whose function body md5 8437b6622e4362644b449503bc256a00
-- equals prod's md5(prosrc) (read 2026-11-05 by Builder 3; 1 overload; STABLE SECURITY DEFINER; acl postgres,
-- authenticated, service_role). Replay-safe: CREATE OR REPLACE only; grants restated as live.
--
-- get_my_pending_direct_offers (the other SECURITY DEFINER returning SETOF jobs) now returns only the rows the
-- "Targeted helper can view direct offer" policy shows the offeree (offered_to_helper_id = caller, direct_offer_status
-- 'pending', status 'open', no helper yet); it did not check status or helper, so an offer the poster had since
-- filled still came back whole. Restated from 20261027185146_card_hold_at_post.sql, whose body md5
-- 5bab72435912585866bfd673ea5ba407 equals prod's md5(prosrc) (read 2026-11-05; acl postgres, authenticated,
-- service_role); only the two WHERE lines are new.
--
-- NOT HERE YET (Q2742 part 2, owed): get_my_activity_cores honouring p_job_columns for application_jobs. The client
-- reads application-job columns outside the cores list (date_window_end, series_ended_on, series_split_ok, tax_kind,
-- offered_to_helper_id: grep 11-05), so that cut needs the client list widened first.

CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END,
             -- Offer privacy (20260915045110): the offeree is the poster's and
             -- the offeree's business only.
             'offered_to_helper_id',
             CASE WHEN j.customer_id = v_uid OR j.offered_to_helper_id = v_uid
                  THEN j.offered_to_helper_id ELSE NULL END
           )
           -- Q2742: an applicant who is not a party to the job (not its poster, its hired Helpr or a crew member who
           -- may see its address) gets none of its payment, moderation, dispute or proof columns. jobs RLS shows that
           -- applicant no row at all; this definer is the only door, and it opened every column.
           || CASE WHEN e.ok OR j.customer_id = v_uid OR j.helper_id = v_uid THEN '{}'::jsonb
              ELSE jsonb_build_object(
                'stripe_session_id', NULL,
                'stripe_payment_intent_id', NULL,
                'chargeback_evidence_due_by', NULL,
                'client_request_id', NULL,
                'flag_reasons', '[]'::jsonb,
                'removal_reason', NULL,
                'removed_by', NULL,
                'dispute_reason', NULL,
                'dispute_evidence_urls', '[]'::jsonb,
                'dispute_helper_response', NULL,
                'cancellation_reason', NULL,
                'revision_note', NULL,
                'proof_before_urls', '[]'::jsonb,
                'proof_after_urls', '[]'::jsonb,
                -- lh-authz-rls (lead 11-05): a crew's re-listed spot shows a non-party an ACCEPTED job, so its
                -- dispute, payout, cancellation and arrival state stays the parties' too.
                'disputed_by', NULL,
                'dispute_status', NULL,
                'has_active_dispute', false,
                'dispute_resolved_at', NULL,
                'disputed_at', NULL,
                'payout_scheduled_at', NULL,
                'cancellation_fee_status', NULL,
                'cancelled_by', NULL,
                'helper_arrival_near_miss_ft', NULL,
                'helper_arrival_near_miss_at', NULL
              ) END
         ) AS rec
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
          -- Q1409: a pending applicant to a booked crew's re-listed spot.
          OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0)
          -- A group roster member who is not the lead. NULL-safe as above.
          OR EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = j.id AND g.helper_id = v_uid
             )
        );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_pending_direct_offers()
 RETURNS SETOF jobs
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rec.*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  -- Function-scan lateral, NOT a scalar sub-select: evaluated once per row.
  CROSS JOIN LATERAL jsonb_populate_record(
           NULL::public.jobs,
           to_jsonb(j) || jsonb_build_object(
             'location',
             CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
             'latitude',
             CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
             'longitude',
             CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
           )
         ) AS rec
  WHERE j.offered_to_helper_id = v_uid
    AND j.direct_offer_status = 'pending'
    -- Q2742: the same rows the "Targeted helper can view direct offer" policy shows the offeree.
    AND j.status = 'open'
    AND j.helper_id IS NULL
    -- An offer on a job whose money has not arrived is not an offer yet
    -- (owner, 2026-10-17).
    AND public.job_payment_is_listed(j.payment_status)
  ORDER BY j.created_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_pending_direct_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_direct_offers() TO authenticated, service_role;

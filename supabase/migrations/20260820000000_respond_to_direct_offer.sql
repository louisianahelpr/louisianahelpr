-- respond_to_direct_offer — the missing server half of "a poster offered you
-- this job directly".
--
-- WHAT WAS BROKEN: a direct offer creates NO `applications` row. PostJob stamps
-- `offered_to_helper_id` / `direct_offer_status = 'pending'` on the JOB
-- (src/pages/postjob/jobSubmitHelpers.ts) and stops. The helper's Activity tab
-- therefore fabricates a synthetic application with `id = 'direct-<jobId>'` so
-- the offer has a card to render on — and every control on that card then
-- addressed a row that does not exist:
--
--   * decline_job_offer(p_application_id => 'direct-<uuid>')   → 22P02
--   * reject_other_applications_on_accept(same)                → 22P02
--   * applications.delete().eq("id", 'direct-<uuid>')          → 22P02
--
-- 22P02 is `invalid input syntax for type uuid`, which the client can only
-- render as its generic "give it another try?" toast. There was no accept path
-- at all: the accept handler's only write set `jobs.helper_confirmed_at`, so
-- even on the happy path `helper_id` stayed NULL, the job stayed `open`, and
-- the offer stayed `pending`. A helper handed a job could not take it.
--
-- This RPC is that missing path, and it is deliberately job-keyed rather than
-- application-keyed — there is no application to key on.
--
-- ACCEPT also INSERTs the accepted `applications` row the rest of the system
-- assumes exists. Without it the job disappears from the helper's Activity the
-- moment they accept: the direct-offer query only selects
-- `direct_offer_status = 'pending'`, and the applied-jobs query reads
-- `applications`. Reviews, earnings and the completion flow all join through
-- that row too.
--
-- DECLINE does NOT file a `job_denial` violation. That ladder
-- (decline_job_offer → user_violations → warning at 3, permanent ban at 5)
-- exists for a helper who applied for a job, was selected, and then backed out
-- — they made a commitment and broke it. A direct offer is unsolicited: the
-- helper never asked for this job, and turning down unsolicited work is not
-- misconduct. Banning someone for it would punish exactly the helpers posters
-- seek out most.

CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(
  p_job_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_app_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- The real applications row the synthetic 'direct-<id>' stood in for.
    -- ON CONFLICT covers the helper who somehow also applied to the same job
    -- before the offer landed: promote their existing row instead of
    -- colliding with the (job_id, helper_id) unique index.
    INSERT INTO public.applications (job_id, helper_id, message, status)
    VALUES (p_job_id, auth.uid(), NULL, 'accepted')
    ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
    RETURNING id INTO v_app_id;

    UPDATE public.jobs
       SET status = 'accepted',
           helper_id = auth.uid(),
           direct_offer_status = 'accepted',
           -- The helper accepting IS the confirmation. There is no second
           -- "confirm you'll be there" step on this path — the poster already
           -- chose them, so requiring another tap would strand the job in
           -- accepted-but-unconfirmed forever.
           helper_confirmed_at = v_now,
           response_deadline = NULL,
           direct_offer_expires_at = NULL
     WHERE id = p_job_id;

    RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT customer_id,
         'Offer declined',
         'Your direct offer for "' || title || '" was declined. The job is open to all helpers again.',
         'job_updates',
         '/my-posts'
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;

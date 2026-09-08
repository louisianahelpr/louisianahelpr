-- A hired Helpr could decline and the poster was never told.
--
-- decline_job_offer applies the reliability strike, rejects the application and
-- reopens the job — and writes no notification to the customer. Nothing else
-- covers it either: notify_on_application's rejected branch only fires when
-- OLD.status = 'pending', and this sets the application to 'rejected' from an
-- offer state, so no trigger matches. The client decline flow sends only the
-- admin fan-out, which is itself dead (user_roles is unreadable to a non-admin,
-- so the loop loops zero times and the "warn on failure" guard never fires).
--
-- The result is the one exit a poster is actively waiting on being the only one
-- that says nothing. Every sibling path already notifies:
--   expire_unanswered_offers  -> "Offer expired — job reopened" (both parties)
--   helper_cancel_booking     -> "Your Helpr cancelled"
--   poster_cancel_job         -> tells the helper
-- A poster who picked someone and is waiting on a yes just silently finds the
-- job back in the open pool, with no idea it was declined rather than, say,
-- still pending.
--
-- Copy deliberately mirrors expire_unanswered_offers' poster notification —
-- same shape, same 'job_updates' type, same /my-posts?job= deep link — because
-- from the poster's side the two outcomes are the same event ("your pick fell
-- through, the job is open again") and should not read as two different
-- features. It names the decline rather than implying a timeout, since the
-- distinction is the one thing the poster can act on: a declined offer is worth
-- picking someone else immediately, an expired one may just be a slow reply.
--
-- Deliberately NOT told: who declined or why. The denial ladder already records
-- the strike server-side, and surfacing "X turned you down" invites retaliation
-- in a marketplace where the same two people may match again.
--
-- Body is the live definition (pg_get_functiondef) verbatim, plus the SELECT
-- fetching customer_id and the INSERT below it.
CREATE OR REPLACE FUNCTION public.decline_job_offer(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_customer uuid;
  v_result jsonb;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title, j.customer_id
    INTO v_job_helper, v_job_title, v_customer
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id).
  IF v_job_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  v_result := public.apply_job_denial_consequence(
    v_app_helper, v_job_id,
    'Declined job offer: "' || COALESCE(v_job_title, 'Unknown') || '"');

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  -- ADDED 2026-09-05. Written HERE, in the same transaction as the reopen,
  -- rather than from the client: the client's own admin fan-out for this event
  -- is structurally dead (RLS), and the notifications INSERT policy is
  -- admin/service-role only, so an ordinary helper's browser cannot write this
  -- row at all. A SECURITY DEFINER RPC is the only seat that can.
  -- customer_id is nullable (account deletion anonymises rather than deletes),
  -- and notifications.user_id is NOT NULL — so guard it rather than throwing
  -- inside a decline that has otherwise already succeeded.
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_customer,
      'Offer declined — job reopened',
      'Your Helpr turned down "' || COALESCE(v_job_title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/my-posts?job=' || v_job_id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Direct Offer feature: allow posters to offer a job to a specific saved helper
-- Adds 3 columns + helper RPC + updated browse views

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS offered_to_helper_id uuid,
  ADD COLUMN IF NOT EXISTS direct_offer_status text,
  ADD COLUMN IF NOT EXISTS direct_offer_expires_at timestamptz;

-- Status values: 'pending' | 'accepted' | 'declined' | 'expired' | NULL (no direct offer)
COMMENT ON COLUMN public.jobs.offered_to_helper_id IS 'If set, this job is a direct offer visible only to this helper.';
COMMENT ON COLUMN public.jobs.direct_offer_status IS 'pending | accepted | declined | expired';
COMMENT ON COLUMN public.jobs.direct_offer_expires_at IS 'When the direct offer reverts to a public job if helper has not responded.';

CREATE INDEX IF NOT EXISTS idx_jobs_offered_to_helper
  ON public.jobs (offered_to_helper_id)
  WHERE offered_to_helper_id IS NOT NULL AND direct_offer_status = 'pending';

-- Update open_jobs_browse to hide pending direct offers from helpers who aren't the target
CREATE OR REPLACE VIEW public.open_jobs_browse AS
SELECT id, title, description, category, budget, date_needed, location,
       is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job,
       helpers_needed, estimated_hours, start_time, photos, special_requirements,
       status, created_at, updated_at, boosted_at, boost_expires_at, expires_at,
       recurrence_interval, recurrence_end_date, parent_job_id, payment_status,
       customer_id, offered_to_helper_id, direct_offer_status, direct_offer_expires_at
FROM public.jobs
WHERE status = 'open'::job_status
  AND (
    offered_to_helper_id IS NULL
    OR direct_offer_status IN ('declined','expired')
    OR offered_to_helper_id = auth.uid()
  );

-- Allow targeted helper to view & update a pending direct-offer job (so they can accept it)
DROP POLICY IF EXISTS "Targeted helper can view direct offer" ON public.jobs;
CREATE POLICY "Targeted helper can view direct offer"
  ON public.jobs
  FOR SELECT
  USING (
    offered_to_helper_id IS NOT NULL
    AND offered_to_helper_id = auth.uid()
    AND direct_offer_status = 'pending'
  );

DROP POLICY IF EXISTS "Targeted helper can respond to direct offer" ON public.jobs;
CREATE POLICY "Targeted helper can respond to direct offer"
  ON public.jobs
  FOR UPDATE
  USING (
    offered_to_helper_id = auth.uid()
    AND direct_offer_status = 'pending'
  );

-- Auto-expire direct offers after 24 hours via cron-friendly function
CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
    RETURNING id, customer_id, offered_to_helper_id, title
  )
  SELECT count(*) INTO v_count FROM expired;

  -- Notify posters whose offers expired
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT customer_id,
         'Direct offer expired',
         'Your offer for "' || title || '" was not accepted in time. The job is now visible to all helpers.',
         'job_updates',
         '/my-posts'
    FROM public.jobs
   WHERE direct_offer_status = 'expired'
     AND direct_offer_expires_at < now()
     AND direct_offer_expires_at > now() - interval '5 minutes';

  RETURN v_count;
END;
$$;

-- Notify the targeted helper when a direct offer is created
CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id)
  THEN
    SELECT COALESCE(full_name, 'A poster') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.offered_to_helper_id,
      '🎯 You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/activity?tab=offers'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_helper_on_direct_offer ON public.jobs;
CREATE TRIGGER trg_notify_helper_on_direct_offer
AFTER INSERT OR UPDATE OF offered_to_helper_id ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_direct_offer();

-- RPC for posters to fetch their saved helpers with profile info
CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()
RETURNS TABLE (
  helper_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  parish text,
  skills text,
  hourly_rate numeric,
  saved_at timestamptz,
  completed_jobs_together integer,
  last_job_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fh.helper_id,
    p.full_name,
    p.avatar_url,
    p.bio,
    p.parish,
    p.skills,
    p.hourly_rate,
    fh.created_at AS saved_at,
    COALESCE((
      SELECT count(*)::int
      FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed'
    ), 0) AS completed_jobs_together,
    (SELECT max(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at))
       FROM public.jobs j
      WHERE j.customer_id = fh.customer_id
        AND j.helper_id = fh.helper_id
        AND j.status = 'completed') AS last_job_at
  FROM public.favorite_helpers fh
  JOIN public.profiles p ON p.user_id = fh.helper_id
  WHERE fh.customer_id = auth.uid()
    AND p.approval_status = 'approved'
    AND COALESCE(p.ban_status, 'active') = 'active'
  ORDER BY fh.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_saved_helpers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_direct_offers() TO authenticated, service_role;
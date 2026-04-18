-- ============================================================
-- WAVE 2: Cash keyword layered defense (server-side containment + auto-suspend)
-- ============================================================

-- Add hidden-message + flag-reason columns
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS flagged_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason text;

-- Add auto-suspend column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_suspended_until timestamptz;

-- Drop and recreate the message scanner with layered defense
CREATE OR REPLACE FUNCTION public.scan_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matched boolean := false;
  v_reason text := null;
  v_recent_flag_count integer;
BEGIN
  IF NEW.content ~* '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}' THEN
    v_matched := true; v_reason := 'Email address detected';
  ELSIF NEW.content ~* '(venmo|cashapp|cash app|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin)' THEN
    v_matched := true; v_reason := 'Off-platform payment service mentioned';
  ELSIF NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee|cash only|in cash)' THEN
    v_matched := true; v_reason := 'Off-platform payment intent detected';
  END IF;

  IF v_matched THEN
    -- Containment: hide from recipient
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;

    -- Log fraud flag
    INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
    VALUES (NEW.sender_id, 'off_platform_contact',
      v_reason || ' — message: ' || left(NEW.content, 200),
      NEW.job_id);

    -- Auto-suspend after 2 flags in rolling 24h
    SELECT count(*) INTO v_recent_flag_count
    FROM public.fraud_flags
    WHERE user_id = NEW.sender_id
      AND flag_type = 'off_platform_contact'
      AND created_at > now() - interval '24 hours';

    -- (count includes the row we're about to insert via the prior INSERT; threshold = 2)
    IF v_recent_flag_count >= 2 THEN
      UPDATE public.profiles
      SET auto_suspended_until = now() + interval '7 days'
      WHERE user_id = NEW.sender_id
        AND (auto_suspended_until IS NULL OR auto_suspended_until < now());

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.sender_id, '🚫 Account temporarily suspended',
        'Your account has been auto-suspended for 7 days due to repeated attempts to share off-platform contact info. Contact support if you believe this is an error.',
        'warning', '/support');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger as BEFORE INSERT so we can mutate NEW
DROP TRIGGER IF EXISTS scan_message_content_trigger ON public.messages;
DROP TRIGGER IF EXISTS messages_scan_content ON public.messages;
CREATE TRIGGER messages_scan_content
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.scan_message_content();

-- Hide flagged messages from recipient (sender + admins still see)
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
CREATE POLICY "Users can view their own messages"
ON public.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() = sender_id
  OR (auth.uid() = receiver_id AND COALESCE(flagged_hidden, false) = false)
);

-- ============================================================
-- WAVE 2: Payout batches helper function
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_payout_batches()
RETURNS TABLE(
  helper_id uuid,
  helper_name text,
  helper_email text,
  stripe_account_id text,
  job_count integer,
  total_payout numeric,
  oldest_completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    j.helper_id,
    p.full_name AS helper_name,
    p.email AS helper_email,
    p.stripe_account_id,
    count(*)::int AS job_count,
    sum(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0))::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
  WHERE j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
  GROUP BY j.helper_id, p.full_name, p.email, p.stripe_account_id
  ORDER BY oldest_completed_at ASC;
$$;

-- Only admins can call it
REVOKE ALL ON FUNCTION public.get_payout_batches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated;

-- ============================================================
-- WAVE 2: Helper tiering function (Rising Stars)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  parish text,
  avatar_url text,
  total_reviews integer,
  recent_reviews integer,
  avg_rating numeric,
  recent_avg_rating numeric,
  completed_jobs integer,
  growth_score numeric,
  tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH stats AS (
    SELECT
      p.user_id,
      p.full_name,
      p.parish,
      p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.helper_id = p.user_id)::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
    LEFT JOIN public.jobs j ON j.helper_id = p.user_id
    WHERE p.role = 'helper'
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
    GROUP BY p.user_id, p.full_name, p.parish, p.avatar_url
  )
  SELECT
    user_id, full_name, parish, avatar_url,
    total_reviews, recent_reviews, avg_rating, recent_avg_rating, completed_jobs,
    (recent_reviews * COALESCE(recent_avg_rating, 0))::numeric(10,2) AS growth_score,
    CASE
      WHEN total_reviews >= 25 AND avg_rating >= 4.7 THEN 'Elite'
      WHEN total_reviews >= 10 AND avg_rating >= 4.5 THEN 'Verified'
      WHEN recent_reviews >= 3 AND recent_avg_rating >= 4.5 THEN 'Rising Star'
      WHEN total_reviews >= 1 THEN 'Active'
      ELSE 'New'
    END AS tier
  FROM stats
  WHERE total_reviews > 0 OR completed_jobs > 0
  ORDER BY growth_score DESC, avg_rating DESC, total_reviews DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_helper_tiers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_helper_tiers(integer) TO authenticated;

-- ============================================================
-- WAVE 3: Helper late cancellation penalties + shadowbans
-- ============================================================

-- Track late helper cancellations
CREATE TABLE IF NOT EXISTS public.helper_late_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL,
  job_id uuid NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  minutes_before_start integer,
  reason text
);

CREATE INDEX IF NOT EXISTS idx_helper_late_cancel_helper ON public.helper_late_cancellations(helper_id, cancelled_at DESC);

ALTER TABLE public.helper_late_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Helpers can view own late cancellations"
ON public.helper_late_cancellations FOR SELECT
TO authenticated
USING (auth.uid() = helper_id);

CREATE POLICY "Admins can view all late cancellations"
ON public.helper_late_cancellations FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service + helpers can insert late cancellations"
ON public.helper_late_cancellations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = helper_id OR has_role(auth.uid(), 'admin'::app_role));

-- Shadowban table (24h temporary lockouts)
CREATE TABLE IF NOT EXISTS public.helper_shadowbans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_helper_shadowbans_active ON public.helper_shadowbans(helper_id, expires_at);

ALTER TABLE public.helper_shadowbans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Helpers can view own shadowbans"
ON public.helper_shadowbans FOR SELECT
TO authenticated
USING (auth.uid() = helper_id);

CREATE POLICY "Admins can manage shadowbans"
ON public.helper_shadowbans FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Helper function: is helper currently shadowbanned?
CREATE OR REPLACE FUNCTION public.is_helper_shadowbanned(_helper_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.helper_shadowbans
    WHERE helper_id = _helper_id
      AND expires_at > now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_helper_shadowbanned(uuid) TO authenticated;

-- Block applications from shadowbanned helpers
CREATE OR REPLACE FUNCTION public.block_shadowbanned_applications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_helper_shadowbanned(NEW.helper_id) THEN
    RAISE EXCEPTION 'Your account is temporarily restricted. Please try again later.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_block_shadowbanned ON public.applications;
CREATE TRIGGER applications_block_shadowbanned
BEFORE INSERT ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.block_shadowbanned_applications();
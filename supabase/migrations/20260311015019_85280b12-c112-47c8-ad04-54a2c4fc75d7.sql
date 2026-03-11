
-- User violations table
CREATE TABLE public.user_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  violation_type text NOT NULL, -- 'off_platform', 'no_show', 'other'
  description text,
  job_id uuid REFERENCES public.jobs(id),
  reported_by uuid, -- null if system-detected
  action_taken text NOT NULL DEFAULT 'warning', -- 'warning', 'temp_ban', 'permanent_ban'
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage violations"
  ON public.user_violations FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own violations"
  ON public.user_violations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- User bans table
CREATE TABLE public.user_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ban_type text NOT NULL DEFAULT 'temporary', -- 'temporary', 'permanent'
  reason text NOT NULL,
  banned_by uuid NOT NULL,
  expires_at timestamptz, -- null for permanent
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage bans"
  ON public.user_bans FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own bans"
  ON public.user_bans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Add ban_status to profiles for quick checks
ALTER TABLE public.profiles ADD COLUMN ban_status text DEFAULT 'active';
-- 'active', 'warned', 'temp_banned', 'permanently_banned'

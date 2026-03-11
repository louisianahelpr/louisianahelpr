
-- Real-time job tracking statuses
CREATE TABLE public.job_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned',
  latitude numeric,
  longitude numeric,
  eta_minutes integer,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants can view tracking" ON public.job_tracking FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_tracking.job_id)
  OR auth.uid() = helper_id
  OR has_role(auth.uid(), 'admin')
);
CREATE POLICY "Helpers can update their tracking" ON public.job_tracking FOR UPDATE USING (auth.uid() = helper_id);
CREATE POLICY "Helpers can insert tracking" ON public.job_tracking FOR INSERT WITH CHECK (auth.uid() = helper_id);

-- Enable realtime for job_tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_tracking;

-- Group jobs: allow multiple helper slots
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helpers_needed integer DEFAULT 1;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_group_job boolean DEFAULT false;

-- Group job helpers (many-to-many for accepted helpers)
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'accepted',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(job_id, helper_id)
);
ALTER TABLE public.group_job_helpers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants can view group helpers" ON public.group_job_helpers FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = group_job_helpers.job_id)
  OR auth.uid() = helper_id
);
CREATE POLICY "System can insert group helpers" ON public.group_job_helpers FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = group_job_helpers.job_id)
);
CREATE POLICY "Participants can update group helpers" ON public.group_job_helpers FOR UPDATE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = group_job_helpers.job_id)
  OR auth.uid() = helper_id
);

-- Trusted Helper Circles
CREATE TABLE public.helper_circles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.helper_circles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can manage circles" ON public.helper_circles FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE public.helper_circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.helper_circles(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL,
  category text,
  nickname text,
  added_at timestamptz DEFAULT now(),
  UNIQUE(circle_id, helper_id)
);
ALTER TABLE public.helper_circle_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Circle owners can manage members" ON public.helper_circle_members FOR ALL USING (
  auth.uid() IN (SELECT owner_id FROM public.helper_circles WHERE id = helper_circle_members.circle_id)
) WITH CHECK (
  auth.uid() IN (SELECT owner_id FROM public.helper_circles WHERE id = helper_circle_members.circle_id)
);
CREATE POLICY "Helpers can see circles they belong to" ON public.helper_circle_members FOR SELECT USING (
  auth.uid() = helper_id
);

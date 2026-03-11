
-- 24hr confirmation columns on jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS poster_confirmed_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_confirmed_at timestamptz;

-- Scope agreement items
CREATE TABLE public.job_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_scope_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view scope items for their jobs" ON public.job_scope_items FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_scope_items.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = job_scope_items.job_id)
);
CREATE POLICY "Job owners can insert scope items" ON public.job_scope_items FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_scope_items.job_id)
);
CREATE POLICY "Job owners can delete scope items" ON public.job_scope_items FOR DELETE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_scope_items.job_id)
);
CREATE POLICY "Helpers can update scope items" ON public.job_scope_items FOR UPDATE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_scope_items.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = job_scope_items.job_id)
);

-- Add-on requests
CREATE TABLE public.addon_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  description text NOT NULL,
  additional_cost numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.addon_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants can view addons" ON public.addon_requests FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = addon_requests.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = addon_requests.job_id)
);
CREATE POLICY "Job participants can create addons" ON public.addon_requests FOR INSERT WITH CHECK (
  auth.uid() = requested_by
);
CREATE POLICY "Job owners can update addons" ON public.addon_requests FOR UPDATE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = addon_requests.job_id)
);

-- Job milestones
CREATE TABLE public.job_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  payment_status text DEFAULT 'unpaid',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants can view milestones" ON public.job_milestones FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_milestones.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = job_milestones.job_id)
);
CREATE POLICY "Job owners can manage milestones" ON public.job_milestones FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_milestones.job_id)
);
CREATE POLICY "Job owners can delete milestones" ON public.job_milestones FOR DELETE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_milestones.job_id)
);
CREATE POLICY "Participants can update milestones" ON public.job_milestones FOR UPDATE USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_milestones.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = job_milestones.job_id)
);

-- Job check-ins (safety)
CREATE TABLE public.job_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  type text NOT NULL,
  latitude numeric,
  longitude numeric,
  note text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.job_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants can view checkins" ON public.job_checkins FOR SELECT USING (
  auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_checkins.job_id)
  OR auth.uid() IN (SELECT helper_id FROM public.jobs WHERE id = job_checkins.job_id)
  OR has_role(auth.uid(), 'admin')
);
CREATE POLICY "Users can create their own checkins" ON public.job_checkins FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

-- Retainer agreements
CREATE TABLE public.retainer_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  helper_id uuid NOT NULL,
  category text NOT NULL,
  frequency text NOT NULL,
  budget_per_session numeric NOT NULL,
  discount_percent numeric DEFAULT 10,
  status text NOT NULL DEFAULT 'active',
  next_job_date date,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.retainer_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can view their retainers" ON public.retainer_agreements FOR SELECT USING (
  auth.uid() = customer_id OR auth.uid() = helper_id
);
CREATE POLICY "Customers can create retainers" ON public.retainer_agreements FOR INSERT WITH CHECK (
  auth.uid() = customer_id
);
CREATE POLICY "Participants can update retainers" ON public.retainer_agreements FOR UPDATE USING (
  auth.uid() = customer_id OR auth.uid() = helper_id
);

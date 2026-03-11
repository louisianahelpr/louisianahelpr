
CREATE TABLE public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  tipper_id uuid NOT NULL,
  helper_id uuid NOT NULL,
  amount numeric NOT NULL,
  stripe_session_id text,
  payment_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tips" ON public.tips FOR SELECT USING (auth.uid() = tipper_id OR auth.uid() = helper_id);
CREATE POLICY "Users can insert tips" ON public.tips FOR INSERT WITH CHECK (auth.uid() = tipper_id);
CREATE POLICY "Admins can view all tips" ON public.tips FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

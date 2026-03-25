
-- Admin audit log table
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view audit log" ON public.admin_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert audit log" ON public.admin_audit_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Login history table
CREATE TABLE public.login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own login history" ON public.login_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all login history" ON public.login_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own login" ON public.login_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Server-side budget floor enforcement
CREATE OR REPLACE FUNCTION public.validate_job_budget()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.budget < 15 THEN
    RAISE EXCEPTION 'Minimum budget is $15';
  END IF;
  IF NEW.budget > 5000 THEN
    RAISE EXCEPTION 'Maximum budget is $5000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_job_budget BEFORE INSERT OR UPDATE OF budget ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.validate_job_budget();

-- Dispute velocity check function
CREATE OR REPLACE FUNCTION public.check_dispute_velocity(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*) < 3
  FROM public.jobs
  WHERE disputed_by = p_user_id
    AND disputed_at > now() - interval '30 days';
$$;

-- Server-side message content scanning trigger
CREATE OR REPLACE FUNCTION public.scan_message_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.content ~* '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}'
     OR NEW.content ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}'
     OR NEW.content ~* '(venmo|cashapp|zelle|paypal|apple.pay|google.pay|crypto|bitcoin)'
     OR NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee)'
  THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
    VALUES (NEW.sender_id, 'off_platform_contact', left(NEW.content, 200), NEW.job_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER scan_message_on_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.scan_message_content();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON public.login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created ON public.login_history(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.admin_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_unresolved ON public.fraud_flags(resolved, created_at);

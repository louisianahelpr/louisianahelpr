-- Helper preferred parishes (max 5 enforced via trigger)
CREATE TABLE IF NOT EXISTS public.helper_preferred_parishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL,
  parish text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(helper_id, parish)
);

ALTER TABLE public.helper_preferred_parishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Helpers manage own preferred parishes"
ON public.helper_preferred_parishes
FOR ALL TO authenticated
USING (auth.uid() = helper_id)
WITH CHECK (auth.uid() = helper_id);

CREATE POLICY "Admins view all preferred parishes"
ON public.helper_preferred_parishes
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_helper_preferred_parishes_parish 
ON public.helper_preferred_parishes(parish);

CREATE INDEX IF NOT EXISTS idx_helper_preferred_parishes_helper 
ON public.helper_preferred_parishes(helper_id);

-- Enforce max 5 parishes per helper
CREATE OR REPLACE FUNCTION public.enforce_parish_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.helper_preferred_parishes WHERE helper_id = NEW.helper_id) >= 5 THEN
    RAISE EXCEPTION 'You can select up to 5 home parishes';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_parish_limit_trigger
BEFORE INSERT ON public.helper_preferred_parishes
FOR EACH ROW EXECUTE FUNCTION public.enforce_parish_limit();

-- Trigger: notify helpers when a matching job is posted
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  helper_record RECORD;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
      AND p.role = 'helper'
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND hpp.helper_id <> NEW.customer_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      helper_record.helper_id,
      '🎯 New job in your parish',
      'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"',
      'job_match',
      '/dashboard?job=' || NEW.id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_helpers_on_job_post_trigger ON public.jobs;
CREATE TRIGGER notify_helpers_on_job_post_trigger
AFTER INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_helpers_on_job_post();

-- RPC for monthly earnings export with parish + tax breakdown
CREATE OR REPLACE FUNCTION public.get_helper_earnings_export(
  _helper_id uuid,
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  job_id uuid,
  date_completed date,
  job_title text,
  category text,
  parish text,
  tax_status text,
  gross_budget numeric,
  platform_fee numeric,
  parish_tax_collected numeric,
  net_payout numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() <> _helper_id AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    j.id AS job_id,
    COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) AS date_completed,
    j.title AS job_title,
    j.category::text AS category,
    COALESCE(j.parish, 'Unknown') AS parish,
    CASE WHEN public.is_category_taxable(j.category::text) THEN 'Taxable' ELSE 'Exempt' END AS tax_status,
    j.budget AS gross_budget,
    ROUND(j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0, 2) AS platform_fee,
    COALESCE(j.sales_tax_amount, 0) AS parish_tax_collected,
    ROUND(j.budget - (j.budget * COALESCE(j.helper_fee_percent, 10) / 100.0), 2) AS net_payout
  FROM public.jobs j
  WHERE j.helper_id = _helper_id
    AND j.status = 'completed'
    AND j.payment_status = 'released'
    AND COALESCE(j.poster_completed_at::date, j.helper_completed_at::date, j.updated_at::date) BETWEEN _start_date AND _end_date
  ORDER BY date_completed DESC;
END;
$$;

-- Fix: Set the view to SECURITY INVOKER so it respects the querying user's RLS
ALTER VIEW public.jobs_helper_safe SET (security_invoker = on);

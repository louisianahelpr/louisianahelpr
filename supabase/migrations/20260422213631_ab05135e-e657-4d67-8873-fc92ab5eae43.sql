-- ============================================================
-- error_logs — client-side error reporting (Sentry replacement)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error','fatal')),
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON public.error_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON public.error_logs (severity, created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon) can write their own error log. Cheap & abuse-resistant via DB throttle.
DROP POLICY IF EXISTS "anyone_can_insert_errors" ON public.error_logs;
CREATE POLICY "anyone_can_insert_errors"
  ON public.error_logs FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Only admins can read error logs.
DROP POLICY IF EXISTS "admins_can_read_errors" ON public.error_logs;
CREATE POLICY "admins_can_read_errors"
  ON public.error_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- analytics_events — first-party product analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  event TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  url TEXT,
  referrer TEXT,
  platform TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON public.analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON public.analytics_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON public.analytics_events (created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_insert_analytics" ON public.analytics_events;
CREATE POLICY "anyone_can_insert_analytics"
  ON public.analytics_events FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "admins_can_read_analytics" ON public.analytics_events;
CREATE POLICY "admins_can_read_analytics"
  ON public.analytics_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- legal_acceptances — Terms + Privacy version audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  marketing_opted_in BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_user ON public.legal_acceptances (user_id, created_at DESC);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_insert_own_legal" ON public.legal_acceptances;
CREATE POLICY "users_insert_own_legal"
  ON public.legal_acceptances FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users_read_own_legal" ON public.legal_acceptances;
CREATE POLICY "users_read_own_legal"
  ON public.legal_acceptances FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- push_tokens — APNs / FCM tokens for native push notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  device_id TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_tokens" ON public.push_tokens;
CREATE POLICY "users_manage_own_tokens"
  ON public.push_tokens FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admins_read_tokens" ON public.push_tokens;
CREATE POLICY "admins_read_tokens"
  ON public.push_tokens FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- Daily cleanup: keep 30 days of errors / 90 days of analytics
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_observability_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.error_logs WHERE created_at < now() - INTERVAL '30 days';
  DELETE FROM public.analytics_events WHERE created_at < now() - INTERVAL '90 days';
END;
$$;
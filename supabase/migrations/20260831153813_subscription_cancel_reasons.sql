-- Persist why people cancel their membership.
--
-- The cancel survey has existed since launch and has recorded NOTHING. It
-- called `slack-ops-alert` from the browser with the user's JWT, but that
-- function requires CRON_SECRET / service-role (slack-ops-alert/index.ts:90-102),
-- so every submission returned 401 — and the call sat inside a bare
-- `catch {}` with a fire-and-forget comment, so the failure was invisible.
-- Retention has therefore had zero signal for the entire life of the product.
--
-- A table, not a Slack ping: the reason is data you want to aggregate over
-- months, and Slack is not queryable.

CREATE TABLE IF NOT EXISTS public.subscription_cancel_reasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  tier        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE above is deliberate: a 2026-08-31 audit found ten tables
-- orphan-retaining rows keyed to deleted users (including IP addresses and a
-- live push token). A new table is not going to join that list.

COMMENT ON TABLE public.subscription_cancel_reasons IS
  'One row per cancel-survey answer. Written by the user themselves at cancel time; read by admins for retention analysis.';

CREATE INDEX IF NOT EXISTS subscription_cancel_reasons_created_at_idx
  ON public.subscription_cancel_reasons (created_at DESC);

ALTER TABLE public.subscription_cancel_reasons ENABLE ROW LEVEL SECURITY;

-- A user may record their OWN reason, and read back only their own rows.
-- They may never update or delete one — a retention record the subject can
-- rewrite is worthless.
DROP POLICY IF EXISTS "insert own cancel reason" ON public.subscription_cancel_reasons;
CREATE POLICY "insert own cancel reason"
  ON public.subscription_cancel_reasons
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "read own cancel reason" ON public.subscription_cancel_reasons;
CREATE POLICY "read own cancel reason"
  ON public.subscription_cancel_reasons
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins read everything — that is the point of collecting it.
DROP POLICY IF EXISTS "admins read all cancel reasons" ON public.subscription_cancel_reasons;
CREATE POLICY "admins read all cancel reasons"
  ON public.subscription_cancel_reasons
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No anon grant: this is authenticated-only by construction.
REVOKE ALL ON public.subscription_cancel_reasons FROM anon;
GRANT SELECT, INSERT ON public.subscription_cancel_reasons TO authenticated;
GRANT ALL ON public.subscription_cancel_reasons TO service_role;

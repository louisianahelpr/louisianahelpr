-- Formal revision + dispute tracking tables with strike counter.
--
-- Context: the app already encodes revisions as `jobs.status='revision_requested'`
-- plus a handful of `revision_*` columns, and disputes via the `disputes` table
-- (migration 20260609140000). This migration adds:
--   • job_revisions  — one row per poster-initiated "fix this" request
--   • job_disputes   — one row per filed dispute (links to the existing `disputes`
--                      table logic but provides an alternative access path)
--   • user_strikes   — quality-enforcement strike log
--   • jobs.has_active_dispute / jobs.revision_count  (already exists, guard added)
--
-- Replay-safety:
--   • All DDL is guarded with IF NOT EXISTS or IF to_regprocedure.
--   • Idempotent policy drops + recreates.
--   • `public.jobs`, `auth.users`, `public.disputes` all exist by this ts.

-- ── 1. job_revisions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'resolved')),
  description text NOT NULL,
  photos text[] DEFAULT '{}'::text[],
  helper_response text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Job parties can manage revisions" ON public.job_revisions;
CREATE POLICY "Job parties can manage revisions" ON public.job_revisions
  FOR ALL TO authenticated
  USING (
    auth.uid() = requested_by
    OR auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_id)
    OR auth.uid() IN (SELECT helper_id  FROM public.jobs WHERE id = job_id)
  )
  WITH CHECK (
    auth.uid() = requested_by
    OR auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_id)
    OR auth.uid() IN (SELECT helper_id  FROM public.jobs WHERE id = job_id)
  );

CREATE INDEX IF NOT EXISTS job_revisions_job_id_idx ON public.job_revisions(job_id);

-- ── 2. job_disputes ──────────────────────────────────────────────────
-- Parallel to the existing `public.disputes` table (which holds the
-- formal admin-resolution workflow). job_disputes is the lighter-weight
-- "filed-by-a-user, held-by-admin" record that the new UI creates when
-- a poster taps "Open a dispute". It mirrors status updates from the
-- admin side and both parties can read it.
CREATE TABLE IF NOT EXISTS public.job_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved_poster', 'resolved_helper', 'resolved_split', 'closed')),
  reason text NOT NULL,
  description text,
  photos text[] DEFAULT '{}'::text[],
  resolution_note text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Job parties and admins can view job_disputes" ON public.job_disputes;
CREATE POLICY "Job parties and admins can view job_disputes" ON public.job_disputes
  FOR SELECT TO authenticated
  USING (
    auth.uid() = opened_by
    OR auth.uid() IN (SELECT customer_id FROM public.jobs WHERE id = job_id)
    OR auth.uid() IN (SELECT helper_id  FROM public.jobs WHERE id = job_id)
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Job parties can insert job_disputes" ON public.job_disputes;
CREATE POLICY "Job parties can insert job_disputes" ON public.job_disputes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = opened_by
    AND opened_by IN (
      SELECT customer_id FROM public.jobs WHERE id = job_id
      UNION
      SELECT helper_id  FROM public.jobs WHERE id = job_id
    )
  );

DROP POLICY IF EXISTS "Admin can update job_disputes" ON public.job_disputes;
CREATE POLICY "Admin can update job_disputes" ON public.job_disputes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS job_disputes_job_id_idx ON public.job_disputes(job_id);

-- ── 3. user_strikes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id),
  dispute_id uuid REFERENCES public.job_disputes(id),
  reason text NOT NULL,
  severity integer NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
  issued_by uuid REFERENCES auth.users(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_strikes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own strikes" ON public.user_strikes;
CREATE POLICY "Users can view own strikes" ON public.user_strikes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can manage strikes" ON public.user_strikes;
CREATE POLICY "Admin can manage strikes" ON public.user_strikes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS user_strikes_user_id_idx ON public.user_strikes(user_id);

-- ── 4. Extra jobs columns (guarded) ────────────────────────────────
-- has_active_dispute: denormalised flag so card renders skip a join.
-- revision_count: already added by an earlier migration; guard with
-- IF NOT EXISTS to be safe on a fresh rebuild.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS has_active_dispute boolean NOT NULL DEFAULT false;

-- revision_count may already exist (migration 20260330203504 or later).
-- Use DO block to guard dynamically.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'jobs'
      AND column_name  = 'revision_count'
  ) THEN
    ALTER TABLE public.jobs ADD COLUMN revision_count integer NOT NULL DEFAULT 0;
  END IF;
END;
$$;

-- ============================================================
-- Time Banking: earn credits by completing jobs, spend as
-- discounts when posting your own.
-- ============================================================

-- 1. time_credits ledger ----------------------------------------
CREATE TABLE IF NOT EXISTS public.time_credits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_minutes integer NOT NULL,            -- positive = earn, negative = spend
  credit_type   text NOT NULL,                -- 'job_completed' | 'redeemed'
  job_id        uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  description   text,
  balance_after integer,                      -- snapshot; maintained by app layer
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_credits_user
  ON public.time_credits(user_id, created_at DESC);

-- Row-Level Security
ALTER TABLE public.time_credits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_credits' AND policyname = 'Users can view own credits'
  ) THEN
    CREATE POLICY "Users can view own credits"
      ON public.time_credits FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'time_credits' AND policyname = 'Users can insert own credits'
  ) THEN
    CREATE POLICY "Users can insert own credits"
      ON public.time_credits FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 2. Convenience RPC: total balance in minutes -----------------
CREATE OR REPLACE FUNCTION public.get_time_credit_balance(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(amount_minutes), 0)::integer
  FROM public.time_credits
  WHERE user_id = p_user_id;
$$;

-- 3. scope_video columns on jobs --------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS scope_video_url text,
  ADD COLUMN IF NOT EXISTS scope_video_thumbnail_url text;

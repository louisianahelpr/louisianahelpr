-- ============================================================
-- perf: add missing index on pif_credits.parent_credit_id FK
--
-- Flagged by Supabase performance advisor (2026-07-06).
-- pif_credits.parent_credit_id is a self-referencing FK added by
-- 20260705190000_pif_directed_gift.sql to link leftover-credit
-- rows back to the original credit they split from. Without an
-- index every join or lookup through this FK causes a sequential
-- scan on pif_credits.
--
-- Replay-safe: CREATE INDEX IF NOT EXISTS is idempotent.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pif_credits_parent_credit_id
  ON public.pif_credits (parent_credit_id)
  WHERE parent_credit_id IS NOT NULL;

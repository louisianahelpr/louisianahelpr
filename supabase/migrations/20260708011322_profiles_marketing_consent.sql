-- Marketing / re-engagement email consent — captured at signup as an explicit
-- opt-in (unchecked by default). Every marketing sender MUST filter on this
-- column so users who never opted in never receive promotional mail. Default
-- to false so any row present pre-migration (or created without the value)
-- fails closed to "not consented" — the safer state.
--
-- Consumers:
--   * `supabase/functions/send-marketing-blast/index.ts` — filters recipient
--     query on `marketing_consent = true`
--   * `supabase/functions/engagement-automations/index.ts` — same filter on
--     re-engagement / win-back mail (if that function ships marketing).
-- Transactional mail (auth confirmations, receipts, dispute notices, etc.)
-- is legally exempt from opt-in and does NOT read this column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;

-- Q2459 (finding lh-money-escrow@d540c89302#2): a Declutter delivery tip paid while its Helpr is on a payout hold
-- is pulled back and re-paid like a job tip (Q1222), instead of only paging staff.
--
-- WHAT WAS BROKEN. A delivery tip (helpr_task_tips, 20261028014848) is a destination charge, so Stripe moves it to
-- the Helpr the moment the buyer pays. stripe-webhook's settleDeliveryTip only paged (money_at_risk) when the Helpr
-- was on a payout hold, because tip_hold_redrives.tip_id REFERENCES public.tips(id): the held-tip ledger
-- (_shared/heldTipRepay.ts holdBackPaidTip / redriveHeldTips) could not hold a helpr_task_tips row.
--
-- THE CHANGE. tip_hold_redrives holds both kinds of tip, told apart by tip_source:
--   'job'       tip_id is a public.tips id (every existing row: the column defaults to 'job')
--   'delivery'  tip_id is a public.helpr_task_tips id
-- The single FK on tip_id is replaced by two FKs on stored generated columns (job_tip_id, delivery_tip_id), each
-- set only for its own source, so each kind keeps ON DELETE RESTRICT on its own tip table (the debt record never
-- vanishes with its tip, as 20261004220059 says) and an id that is not in the right table is refused (23503).
-- No new table: a sibling table would be another member-data table for export_my_data; the existing export
-- (to_jsonb of the row, by helper_id) carries the new columns as they are.
--
-- Data: existing rows are all job tips and keep tip_source 'job'. Grants and RLS unchanged (server-only).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; constraints added only when missing; the old FK is dropped by lookup.
-- Proof: src/test/pglite/deliveryTipHoldRedrive.pglite.mjs (applied 3x).

ALTER TABLE public.tip_hold_redrives ADD COLUMN IF NOT EXISTS tip_source text NOT NULL DEFAULT 'job';

DO $$
DECLARE
  v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tip_hold_redrives'::regclass
                  AND conname = 'tip_hold_redrives_tip_source_check') THEN
    ALTER TABLE public.tip_hold_redrives
      ADD CONSTRAINT tip_hold_redrives_tip_source_check CHECK (tip_source IN ('job', 'delivery'));
  END IF;
  -- The old FK: tip_id -> tips(id). Found by what it is, not by its generated name.
  FOR v_name IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public.tip_hold_redrives'::regclass AND c.contype = 'f'
       AND c.confrelid = 'public.tips'::regclass
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = 'public.tip_hold_redrives'::regclass AND a.attname = 'tip_id')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.tip_hold_redrives DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$$;

ALTER TABLE public.tip_hold_redrives
  ADD COLUMN IF NOT EXISTS job_tip_id uuid GENERATED ALWAYS AS (CASE WHEN tip_source = 'job' THEN tip_id END) STORED;
ALTER TABLE public.tip_hold_redrives
  ADD COLUMN IF NOT EXISTS delivery_tip_id uuid GENERATED ALWAYS AS (CASE WHEN tip_source = 'delivery' THEN tip_id END) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tip_hold_redrives'::regclass
                  AND conname = 'tip_hold_redrives_job_tip_id_fkey') THEN
    ALTER TABLE public.tip_hold_redrives ADD CONSTRAINT tip_hold_redrives_job_tip_id_fkey
      FOREIGN KEY (job_tip_id) REFERENCES public.tips(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tip_hold_redrives'::regclass
                  AND conname = 'tip_hold_redrives_delivery_tip_id_fkey') THEN
    ALTER TABLE public.tip_hold_redrives ADD CONSTRAINT tip_hold_redrives_delivery_tip_id_fkey
      FOREIGN KEY (delivery_tip_id) REFERENCES public.helpr_task_tips(id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- An FK column without an index makes every delete on the parent scan this table.
CREATE INDEX IF NOT EXISTS tip_hold_redrives_job_tip_id_idx ON public.tip_hold_redrives (job_tip_id) WHERE job_tip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tip_hold_redrives_delivery_tip_id_idx ON public.tip_hold_redrives (delivery_tip_id) WHERE delivery_tip_id IS NOT NULL;

COMMENT ON COLUMN public.tip_hold_redrives.tip_source IS
  'Q2459: job = tip_id is a public.tips id; delivery = tip_id is a public.helpr_task_tips id (a Declutter delivery tip).';

REVOKE ALL ON TABLE public.tip_hold_redrives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tip_hold_redrives TO service_role;

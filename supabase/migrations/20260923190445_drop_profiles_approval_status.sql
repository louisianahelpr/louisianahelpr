-- Q288: drop profiles.approval_status, inert since Q205b.
--
-- Every signup is auto-approved and bans are automated (owner, 2026-09-23,
-- Q193); the entry gate is a confirmed email (profiles.email_verified).
-- 20260923153703 made 'denied' unrepresentable (CHECK
-- profiles_approval_status_no_denied), and 20260923172405 moved every reader
-- to email_verified, set the default to 'approved' and flipped every 'pending'
-- row to 'approved'. Since then the column holds one constant value and no
-- code, SQL function, policy, view or index reads or writes it
-- (src/test/retiredApprovalReads.test.ts, over the NEWEST definition of every
-- function and every surviving policy/view/index in this directory).
--
-- NOT measured from this lane (no prod access): the Q205b NOTICE count of
-- approved-but-unconfirmed rows, and that no DEPLOYED edge-function version
-- still selects the column. See docs/OPEN.md Q288 for the pre-landing check.
-- The owner confirmed on 2026-09-23 that the app has not launched (no
-- installed builds), so no shipped client selects it.
--
-- Replay-safe: guarded by information_schema, so a replay after the drop (or
-- on a database that never had the column) is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'approval_status'
  ) THEN
    RETURN;
  END IF;

  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.profiles.profiles_approval_status_no_denied
  -- ACK-REASON: the CHECK only constrained approval_status, which is dropped below (Q288, retired by Q205b).
  -- ACK-DATA-LOSS: none; a CHECK holds no data, and the column it constrains is being dropped.
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_approval_status_no_denied;

  ALTER TABLE public.profiles ALTER COLUMN approval_status DROP DEFAULT;

  -- DESTRUCTIVE-DDL-ACK: DROP COLUMN public.profiles.approval_status
  -- ACK-REASON: retired by Q205b (20260923172405); no function, policy, view, index, edge function or client reads it.
  -- ACK-DATA-LOSS: none of meaning; 20260923172405 set every row to 'approved' and the default to 'approved', so it holds one constant.
  ALTER TABLE public.profiles DROP COLUMN approval_status;
END $$;

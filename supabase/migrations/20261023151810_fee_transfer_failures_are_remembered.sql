-- Q2356 (HIGH): a cancellation-fee transfer that failed or was canceled is sent again.
--
-- Before: void-cancelled-payments asked Stripe which cancellation_fee transfers exist in the job's transfer
-- group and treated any one not `reversed` as "already paid". A transfer Stripe reports failed or canceled is
-- not reversed, so the retry found it, marked the ledger row paid, and the Helpr was never paid. A crew share's
-- failed transfer was not even recorded: nothing marked crew_cancellation_fee_shares failed.
--
-- Now each ledger row remembers every transfer of it that failed or was canceled (failed_transfer_ids), the
-- stripe-webhook records it there (note_failed_fee_transfer, for a single fee and for a crew share), and the
-- dedupe never counts a remembered transfer as paid.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.

ALTER TABLE public.cancellation_fee_transfers ADD COLUMN IF NOT EXISTS failed_transfer_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crew_cancellation_fee_shares ADD COLUMN IF NOT EXISTS failed_transfer_ids text[] NOT NULL DEFAULT '{}';

-- Record one failed or canceled fee transfer on its ledger row, once. p_kind: 'fee' (cancellation_fee_transfers,
-- p_row = metadata.fee_transfer_id) or 'share' (crew_cancellation_fee_shares, p_row = metadata.share_id).
-- A crew share also moves to 'failed' (from pending or paid) when this transfer is its current one or it has none,
-- so the hourly run's retry picks it up. Returns the row id it touched, or NULL when no row matched.
CREATE OR REPLACE FUNCTION public.note_failed_fee_transfer(p_kind text, p_row uuid, p_transfer text, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('fee', 'share') OR p_row IS NULL OR p_transfer IS NULL OR btrim(p_transfer) = '' THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'fee' THEN
    UPDATE public.cancellation_fee_transfers
       SET failed_transfer_ids = CASE WHEN p_transfer = ANY(failed_transfer_ids) THEN failed_transfer_ids
                                      ELSE array_append(failed_transfer_ids, p_transfer) END
     WHERE id = p_row
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crew_cancellation_fee_shares
       SET failed_transfer_ids = CASE WHEN p_transfer = ANY(failed_transfer_ids) THEN failed_transfer_ids
                                      ELSE array_append(failed_transfer_ids, p_transfer) END,
           -- (the share table has no failure_reason column; the reason is in the webhook's page)
           status = CASE WHEN status IN ('pending', 'paid') AND (stripe_transfer_id IS NULL OR stripe_transfer_id = p_transfer)
                         THEN 'failed' ELSE status END
     WHERE id = p_row
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.note_failed_fee_transfer(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.note_failed_fee_transfer(text, uuid, text, text) TO service_role;

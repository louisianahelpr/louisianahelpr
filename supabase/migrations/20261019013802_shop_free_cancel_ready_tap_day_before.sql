-- Shops O2: a shop's "ready" tap only ends a buyer's free cancel from the DAY
-- BEFORE the ready date (owner pop-up 2026-10-19 ~01:30Z, Q2155).
--
-- What was wrong: 20261018211820 section 7 closed the 'until_handover' window
-- ("cancel any time before pickup") at the ready date's start or at the shop's
-- ready tap (shop_handovers.ready_at), whichever came first. shops_mark_ready has
-- no date check, so a shop could tap "ready" right after accepting and end the
-- buyer's free cancel days before the ready date.
--
-- The fix (owner's answer): under 'until_handover' a ready tap counts only from
-- the start of the day before the ready date (Louisiana time). The window closes
-- at the EARLIEST of
--   the ready date's start, and
--   the ready tap, but never before the day before begins
--   (greatest(ready_at, start of ready_date - 1 day)).
-- So: no tap -> the ready date's start; a tap on the day before -> at the tap;
-- an early tap (say 3 days before) -> the buyer keeps free cancel until the day
-- before begins. The other presets are unchanged ('until_accept' = the accept,
-- 'until_24h_before_ready' = 24 hours before the ready date begins), and only an
-- ACCEPTED order not yet handed over has a window (any other status is
-- '-infinity'; NULL for no such order or an unknown policy = closed).
--
-- M3 (the cancel of an accepted order) MUST take the order's row lock FIRST
-- (SELECT ... FROM shop_orders WHERE id = ... FOR UPDATE, READ COMMITTED), then
-- call this function in that same transaction, decide free vs. late from that
-- one reading, and RECORD the decision before commit (move the order out of
-- 'accepted', or store free/late on the row). Only after that commit may it
-- call Stripe for the refund: the lock ends at commit, so the recorded status,
-- not the lock, is what stops a later ready tap or handover from changing the
-- answer. shops_mark_ready and shop_complete_handover take the same row lock
-- and act only on an 'accepted' order (lh-money-escrow of a90c008a0, note; of
-- a1890a0fa #3).
--
-- Replay-safe: CREATE OR REPLACE with the same signature and return type; grants
-- restated (service_role only; the buyer reads the preset's words, never this).
-- Applied 3x by src/test/pglite/shopsHandoverPayout.pglite.mjs.

CREATE OR REPLACE FUNCTION public.shop_order_free_cancel_until(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN o.status IS DISTINCT FROM 'accepted' OR o.handed_over_at IS NOT NULL THEN '-infinity'::timestamptz
           ELSE CASE o.cancel_policy
                  WHEN 'until_accept' THEN o.accepted_at
                  WHEN 'until_24h_before_ready' THEN (o.ready_date::timestamp AT TIME ZONE 'America/Chicago') - interval '24 hours'
                  WHEN 'until_handover' THEN least((o.ready_date::timestamp AT TIME ZONE 'America/Chicago'),
                                                   greatest(COALESCE(h.ready_at, 'infinity'::timestamptz),
                                                            ((o.ready_date - 1)::timestamp AT TIME ZONE 'America/Chicago')))
                END
         END
    FROM public.shop_orders o
    LEFT JOIN public.shop_handovers h ON h.order_id = o.id
   WHERE o.id = p_order_id
$fn$;
COMMENT ON FUNCTION public.shop_order_free_cancel_until(uuid) IS
  'Until when a buyer may cancel an accepted shop order for free (O2). until_handover: the ready date''s start, or the shop''s ready tap counted only from the day before (Louisiana time). Call it inside the transaction that holds the order row lock (FOR UPDATE) before refunding, and record free/late on the order (out of accepted) before that commit; call Stripe only after it.';
REVOKE ALL ON FUNCTION public.shop_order_free_cancel_until(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_order_free_cancel_until(uuid) TO service_role;

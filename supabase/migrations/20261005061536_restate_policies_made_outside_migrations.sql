-- Q1233 (docs/OPEN.md): the migrations describe prod's policies again.
--
-- Replaying every CREATE/DROP/ALTER POLICY in the migrations and comparing the
-- names with prod (pg_policies, read 2026-10-05) found four policies changed
-- outside the migrations:
--   public.disputes       live "disputes parties select" (SELECT); the files
--                         still carry "disputes job parties select"
--   public.disputes       live "disputes opener update while open" (UPDATE);
--                         the files still carry "disputes opener update"
--   public.gift_cards     live "Gift cards are party-only" (SELECT); in no file
--   public.notifications  "Service role can insert notifications" (INSERT) is
--                         in the files (20260403180249) but not live
-- This restates each LIVE definition verbatim (roles, command, USING, WITH
-- CHECK as pg_policies prints them), so applying it to prod changes nothing,
-- and a fresh replay now builds the same policy set. Replay-safe: every
-- CREATE is preceded by DROP POLICY IF EXISTS of its own name.
-- Guard: src/test/dataExportCoversEveryUserTable.test.ts ("Q1233: the policy
-- replay equals the live policies") — a two-way name check of the replayed
-- policies against scripts/audit/write-contract.snapshot.json (prod's list).

DROP POLICY IF EXISTS "disputes job parties select" ON public.disputes;
DROP POLICY IF EXISTS "disputes parties select" ON public.disputes;
CREATE POLICY "disputes parties select" ON public.disputes
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = disputes.job_id) AND ((j.customer_id = ( SELECT auth.uid() AS uid)) OR (j.helper_id = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS "disputes opener update" ON public.disputes;
DROP POLICY IF EXISTS "disputes opener update while open" ON public.disputes;
CREATE POLICY "disputes opener update while open" ON public.disputes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((( SELECT auth.uid() AS uid) = opener_id) AND (status = 'open'::text)))
  WITH CHECK (((( SELECT auth.uid() AS uid) = opener_id) AND (status = 'open'::text)));

DROP POLICY IF EXISTS "Gift cards are party-only" ON public.gift_cards;
CREATE POLICY "Gift cards are party-only" ON public.gift_cards
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) = donor_id) OR (( SELECT auth.uid() AS uid) = recipient_id) OR ((recipient_email IS NOT NULL) AND (lower(recipient_email) = lower(( SELECT auth.email() AS email))))));

DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;

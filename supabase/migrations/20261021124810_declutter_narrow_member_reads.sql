-- LANDS ONLY WITH THE NEXT APP STORE BUILD (it raises client_compat_floor() to 2).
--
-- Q2274 / Q2267 (lh-authz-rls review of Wanted replies, blocker #1) and Q2278 (lead ruling 2026-10-21: who asked a
-- Declutter question is never readable by other members, the seller included). Members could read two things they
-- must not:
--   * declutter_offers / declutter_offer_events rows directly (table SELECT + "the two sides read"): a seller who
--     answers a Wanted post ("I have this", 20261021031757) would get the poster's user id from the offer row.
--   * declutter_questions.asker_id on any item (table SELECT + "readable with their item"), while the item page says
--     only "Asked by a neighbor".
-- This takes both away:
--   * declutter_offers and declutter_offer_events: no member table read at all. No app or edge code reads either
--     table (git log -S over src/ and supabase/functions/ on origin/main, 2026-10-21); every read goes through the
--     definer RPCs (declutter_my_offers and the rest), which return no counterparty id. The two "the two sides read"
--     policies stay on purpose: with no grant they let nothing through, and should a read ever be granted again they
--     keep it to the offer's two sides. The events policy looks up declutter_offers as the member, so granting the
--     events read again needs the offers read granted too (else every events read is "permission denied").
--   * declutter_questions: a COLUMN grant without asker_id. The app reads questions through declutter_item_questions
--     (20261021122157, SECURITY INVOKER, no asker_id) and its fallback reads only the granted columns. The row policy
--     is unchanged. The ask/answer RPCs and export_my_data are definers owned by the table owner, so they still read
--     asker_id (the export keeps it only on the caller's own questions, 20261021041946).
-- Why the floor: installed builds before ready/declutter-rework-1021 still select asker_id in the item page's
-- questions read, and would get "permission denied" (schemaBreakBumpsClientFloor). client_compat_floor() 2, with
-- CLIENT_COMPAT_EPOCH 2 in the same change, sends a web tab below it to reload and shows a native app below it
-- "Update Helpr". So this lands only together with the App Store build cut from a main that already has the
-- rework, never while a build is in Apple review (release/app-review-freeze.json, appReviewFreeze.test.ts).
-- One migration, not two: every narrowing migration must raise the floor above the one before it, so two separate
-- narrowing files would need floors 2 and 3.
-- Replay-safe: REVOKE/GRANT repeat; CREATE OR REPLACE.

REVOKE SELECT ON public.declutter_offers FROM anon, authenticated;
REVOKE SELECT ON public.declutter_offer_events FROM anon, authenticated;

REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;

CREATE OR REPLACE FUNCTION public.client_compat_floor()
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$ SELECT 2 $$;
REVOKE ALL ON FUNCTION public.client_compat_floor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_compat_floor() TO anon, authenticated, service_role;

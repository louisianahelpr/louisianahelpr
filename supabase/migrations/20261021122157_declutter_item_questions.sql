-- Q2278 (lead ruling 2026-10-21: who asked a Declutter question is never readable by other members, the seller
-- included; the item page says "Asked by a neighbor"). The app read an item's questions straight from the table and
-- asked for asker_id, which it never shows. Members can still read that column today, and the column cannot be taken
-- away without stranding every installed app that still asks for it (schemaBreakBumpsClientFloor). This gives the app
-- one read that never names the asker, so the column grant can be narrowed later (ready/declutter-narrow-floor2,
-- with client_compat_floor() 2, landing with the next App Store build).
--
-- declutter_item_questions(item): the item's questions, oldest first, without asker_id.
--   * SECURITY INVOKER on purpose: it reads as the caller, so the row policy "declutter questions: readable with their
--     item" (removed_at IS NULL and the caller can read the item, under declutter_items' own policies) decides exactly
--     as it does for the table read today; nothing is re-implemented here. It selects only columns the narrowed grant
--     keeps (id, item_id, question, answer, answered_at, removed_at, created_at), so it works before and after.
--   * Not a SECURITY DEFINER function, so it is not in scripts/ci/definer-exec-allowlist.json: that list is the exact
--     set of client-callable definers (scripts/check-live-privileges.mjs), and an invoker entry would read as stale.
--   * Behind the hidden 'declutter' switch like every Declutter RPC (require_feature first).
--   * removed_at IS NULL is also stated here, so a service-role caller (no RLS) never gets removed questions either.
-- Grants: authenticated and service_role; never anon (the table has no anon grant either).
-- Replay-safe: CREATE OR REPLACE; REVOKE/GRANT repeat.

CREATE OR REPLACE FUNCTION public.declutter_item_questions(p_item_id uuid)
RETURNS TABLE(id uuid, item_id uuid, question text, answer text, answered_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT q.id, q.item_id, q.question, q.answer, q.answered_at, q.created_at
      FROM public.declutter_questions q
     WHERE q.item_id = p_item_id
       AND q.removed_at IS NULL
     ORDER BY q.created_at, q.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_questions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_questions(uuid) TO authenticated, service_role;

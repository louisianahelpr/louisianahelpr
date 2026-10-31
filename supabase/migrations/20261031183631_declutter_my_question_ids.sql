-- AUD31-15 (audit 10-31, "Messages about an item"): the member who asked a question on an item cannot tell their own
-- waiting question from a neighbour's, because the item page's read (declutter_item_questions, 20261021122157) never
-- names the asker (Q2278: who asked is never readable by other members, the seller included) and members have no
-- grant on declutter_questions.asker_id (20261021124810). The page should say "Your question" on the caller's own.
--
-- declutter_my_question_ids(item): the ids of the CALLER's own questions on that item, nothing else.
--   * SECURITY DEFINER because the caller has no column grant on asker_id; it compares asker_id with auth.uid() only
--     and returns question ids the caller can already read on the item page (same removed_at IS NULL rule), so it
--     tells the caller nothing about anyone else: no other asker's id, no count of other askers, and a question the
--     caller did not ask is never in the answer. Signed out (auth.uid() NULL) answers nothing.
--   * The item's visibility is the item page's own read (declutter_item_questions, row policies); this read adds no
--     item data, only "which of these are mine", so it does not re-check the item.
--   * Behind the hidden 'declutter' switch like every Declutter RPC (require_feature first).
--   * Listed in scripts/ci/definer-exec-allowlist.json (client-callable definer).
-- Grants: authenticated and service_role; never anon.
-- Replay-safe: CREATE OR REPLACE; REVOKE/GRANT repeat.

CREATE OR REPLACE FUNCTION public.declutter_my_question_ids(p_item_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT q.id
      FROM public.declutter_questions q
     WHERE q.item_id = p_item_id
       AND q.asker_id = v_uid
       AND q.removed_at IS NULL
     ORDER BY q.created_at, q.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_question_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_question_ids(uuid) TO authenticated, service_role;

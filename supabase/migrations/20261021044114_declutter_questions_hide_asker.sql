-- Q2278 (lead ruling 2026-10-21, privacy first, matching the item page's "Asked by a neighbor"): who asked a Declutter
-- question is never readable by other members, the seller included. Only the asker (through their own data export)
-- and admins (service role / definer paths) can see it.
--
-- Members kept a table-level SELECT on declutter_questions (policy "readable with their item"), so any signed-in member
-- could read asker_id on any item. Now the read is a COLUMN grant without asker_id. Nothing in the app reads asker_id
-- (checked 2026-10-21: the only readers are export_my_data, declutter_ask_question and declutter_answer_question, all
-- SECURITY DEFINER and owned by the table owner); the
-- client's fetchQuestions selects the other columns. The row policy is unchanged. Replay-safe (REVOKE/GRANT repeat).
-- The export side (a seller's Download My Data) is restated in the next export_my_data migration.

REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;

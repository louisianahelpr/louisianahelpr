-- SI-014: RLS policies that call auth.uid() bare are re-evaluated PER ROW
-- (Supabase advisor lint auth_rls_initplan). Wrapping the call as
-- ( SELECT auth.uid() AS uid) makes Postgres evaluate it once per statement as
-- an initplan. The predicate is identical; only the evaluation count changes.
--
-- Generic, from the live catalog: every public policy whose USING / WITH CHECK
-- still contains a bare auth.uid() is re-stated with each bare call wrapped.
-- Already-wrapped calls are shielded first so they are not double-wrapped.
-- Replay-safe: a second run finds nothing bare and does nothing.
-- New policies must be written wrapped (src/test/rlsPoliciesWrapAuthUid.test.ts).

DO $$
DECLARE
  r record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') LIKE '%auth.uid()%'
  LOOP
    v_using := replace(replace(replace(r.qual, '( SELECT auth.uid() AS uid)', '@@WRAPPED@@'), 'auth.uid()', '( SELECT auth.uid() AS uid)'), '@@WRAPPED@@', '( SELECT auth.uid() AS uid)');
    v_check := replace(replace(replace(r.with_check, '( SELECT auth.uid() AS uid)', '@@WRAPPED@@'), 'auth.uid()', '( SELECT auth.uid() AS uid)'), '@@WRAPPED@@', '( SELECT auth.uid() AS uid)');
    v_sql := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_using || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;  -- SI-014 restate wrapped
  END LOOP;
END $$;
-- SI-014 sentinel (the guard's mutation target; no statement)

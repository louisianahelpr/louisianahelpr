-- Wrap every bare auth.uid() / auth.role() / auth.jwt() call inside RLS
-- policy expressions in a (SELECT ...) so PostgreSQL evaluates them once
-- per statement (initPlan) instead of once per row. Closes 158
-- `auth_rls_initplan` warnings flagged by Supabase performance advisor.
--
-- Mechanical transform:  auth.uid()  ->  (SELECT auth.uid())
--                        auth.role() ->  (SELECT auth.role())
--                        auth.jwt()  ->  (SELECT auth.jwt())
--
-- Idempotent: revert any pre-wrapped form first, then apply. Re-running
-- the migration is a no-op.
--
-- Atomic: a single DO block. If any DROP/CREATE fails the whole
-- transaction rolls back, leaving every policy in its original state.
--
-- Safety: only modifies USING / WITH CHECK expressions. Roles, command,
-- permissive flag, and policy name are preserved verbatim. The
-- semantics of each policy are unchanged — auth.uid() returns the same
-- value whether wrapped or not; the wrap just changes the query plan.
--
-- Out of scope: the realtime.messages policy is left alone since it
-- lives in a Supabase-managed schema. Skipped via schemaname filter.

DO $$
DECLARE
  p RECORD;
  new_qual  TEXT;
  new_check TEXT;
  cmd_clause   TEXT;
  to_clause    TEXT;
  using_clause TEXT;
  check_clause TEXT;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL AND (
          qual LIKE '%auth.uid()%'
          OR qual LIKE '%auth.role()%'
          OR qual LIKE '%auth.jwt()%'
        ))
        OR
        (with_check IS NOT NULL AND (
          with_check LIKE '%auth.uid()%'
          OR with_check LIKE '%auth.role()%'
          OR with_check LIKE '%auth.jwt()%'
        ))
      )
  LOOP
    new_qual  := p.qual;
    new_check := p.with_check;

    IF new_qual IS NOT NULL THEN
      -- Revert any pre-wrapped form so re-runs don't double-wrap.
      new_qual := replace(new_qual, '(SELECT auth.uid())',  'auth.uid()');
      new_qual := replace(new_qual, '(SELECT auth.role())', 'auth.role()');
      new_qual := replace(new_qual, '(SELECT auth.jwt())',  'auth.jwt()');
      -- Apply fresh wrap.
      new_qual := replace(new_qual, 'auth.uid()',  '(SELECT auth.uid())');
      new_qual := replace(new_qual, 'auth.role()', '(SELECT auth.role())');
      new_qual := replace(new_qual, 'auth.jwt()',  '(SELECT auth.jwt())');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, '(SELECT auth.uid())',  'auth.uid()');
      new_check := replace(new_check, '(SELECT auth.role())', 'auth.role()');
      new_check := replace(new_check, '(SELECT auth.jwt())',  'auth.jwt()');
      new_check := replace(new_check, 'auth.uid()',  '(SELECT auth.uid())');
      new_check := replace(new_check, 'auth.role()', '(SELECT auth.role())');
      new_check := replace(new_check, 'auth.jwt()',  '(SELECT auth.jwt())');
    END IF;

    cmd_clause := CASE p.cmd
      WHEN 'ALL' THEN 'FOR ALL'
      ELSE 'FOR ' || p.cmd
    END;

    to_clause := 'TO ' || array_to_string(p.roles, ', ');

    -- INSERT cannot have USING; SELECT/DELETE cannot have WITH CHECK.
    using_clause := CASE
      WHEN new_qual IS NOT NULL AND p.cmd <> 'INSERT'
        THEN ' USING (' || new_qual || ')'
      ELSE ''
    END;

    check_clause := CASE
      WHEN new_check IS NOT NULL AND p.cmd IN ('INSERT', 'UPDATE', 'ALL')
        THEN ' WITH CHECK (' || new_check || ')'
      ELSE ''
    END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   p.policyname, p.schemaname, p.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s %s %s%s%s',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      cmd_clause,
      to_clause,
      using_clause,
      check_clause
    );
  END LOOP;
END $$;

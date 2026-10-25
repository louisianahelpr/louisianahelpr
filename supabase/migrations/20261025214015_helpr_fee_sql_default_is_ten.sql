-- The Helpr fee on NEW jobs is 10% + 70c (owner 2026-10-25). The TypeScript
-- rule moved (src/lib/helprFlatFee.ts and supabase/functions/_shared/
-- helprFlatFee.ts: HELPR_FLAT_FEE_PERCENT = 10), and create-payment stamps 10
-- on every job it funds. The SQL copy of the rule kept 5 as its default for a
-- job with no stamped percent: helpr_flat_fee_cents (the Helpr's share in the
-- cancel and ban notices and the earnings export) and get_payout_batches (the
-- admin payout batch screen). A job keeps the percent it was stamped with;
-- only the default for an unstamped percent changes, so no job's money moves.
-- src/test/sqlMoneyReadsFeeStamp.test.ts holds the SQL default equal to the TS one.
--
-- HOW: the mechanism of 20260925143327: pg_get_functiondef(), regexp_replace
-- the one default, EXECUTE. Grants are untouched (CREATE OR REPLACE keeps
-- them). Replay-safe: a missing function is skipped with a WARNING, and a
-- pattern that no longer matches changes nothing.

DO $migrate$
DECLARE
  r        record;
  v_oid    oid;
  v_def    text;
  v_new    text;
  v_any    boolean;
  v_hit    boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (10, 'helpr_flat_fee_cents',
           $p$COALESCE\(p_percent, 5\)$p$,
           $q$COALESCE(p_percent, 10)$q$, ''),
      (20, 'get_payout_batches',
           $p$COALESCE\(j\.helper_fee_percent, 5\)$p$,
           $q$COALESCE(j.helper_fee_percent, 10)$q$, 'g')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY ord
  LOOP
    v_any := false;
    v_hit := false;

    FOR v_oid IN
      SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = r.fn
         AND p.prokind IN ('f', 'p')
    LOOP
      v_any := true;
      v_def := pg_get_functiondef(v_oid);
      v_new := regexp_replace(v_def, r.pat, r.rep, r.flags);
      IF v_new IS DISTINCT FROM v_def THEN
        EXECUTE v_new;
        v_hit := true;
      END IF;
    END LOOP;

    IF NOT v_any THEN
      RAISE WARNING 'helpr fee default %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'helpr fee default %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;

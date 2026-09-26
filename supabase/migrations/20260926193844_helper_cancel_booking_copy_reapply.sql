-- Re-apply 20260925143327's two helper_cancel_booking copy rewrites.
--
-- db-drift-detect (2026-09-26 17:08Z): "prod runs an OLDER migration's body,
-- not 20260925143327's". Measured live the same day: prod's body still says
-- "Message the poster or open a dispute." and "contact the poster or support."
-- while the other ten functions that migration rewrote carry the new copy, so
-- helper_cancel_booking was re-created with its old body after the rewrite ran.
--
-- Same mechanism as 20260925143327 (pg_get_functiondef + regexp_replace +
-- EXECUTE; scripts/lib/functionRewrites.mjs replays it). Replay-safe: an
-- already-rewritten body does not match and nothing executes.

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
      (100, 'helper_cancel_booking',
           $p$Message the poster or open a dispute\.$p$,
           $q$Message the person who posted it or open a dispute.$q$, 'g'),
      (101, 'helper_cancel_booking',
           $p$contact the poster or support\.$p$,
           $q$contact the person who posted it or support.$q$, 'g')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY 1
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
      RAISE WARNING 'role-neutral copy %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'role-neutral copy %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;

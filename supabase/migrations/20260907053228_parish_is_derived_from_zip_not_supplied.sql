-- `profiles.parish` becomes DERIVED. No client supplies it ever again.
--
-- Owner, 2026-09-07: "it shouldn't be parish=null. they are not saying their
-- parish they're saying their zip."
--
-- That is the whole design in one sentence. Parish was a nullable column that
-- somebody had to remember to populate, and the failure mode of "remember to"
-- is silence: the client's lookup was denied by a missing `anon` grant, so the
-- field was simply skipped, no error, and the account was created unreachable.
-- Backfilling repairs the rows that exist and does nothing about the design,
-- so the column stops being an input and becomes a function of `zip_code`.
--
-- Why it matters concretely: `get_ranked_open_jobs` ranks on parish and the
-- helper job-match fan-out matches on `p.parish = NEW.parish`. A NULL parish is
-- a member no notification reaches and no ranking favours. They get a working
-- account and total silence, which is indistinguishable from an empty market.
--
-- Depends on 20260907051306, which completed `louisiana_zip_parishes` from 252
-- of Louisiana's ZIP codes to all 720. A trigger is only as good as the table
-- behind it, and against the old sample this one would have derived NULL for
-- two thirds of the state.
--
-- ══ The ladder: ZIP, then city, then loud ══════════════════════════════════
--
--   1. ZIP  → parish   authoritative. A ZIP maps to exactly one parish here.
--   2. city → parish   fallback, and explicitly weaker: it is an inference from
--                      a name the member typed, not a postal fact.
--   3. NULL            and it RAISEs a WARNING rather than passing quietly.
--
-- Rung 2 exists because measuring the first fix showed it had not moved the
-- number. Most accounts have no ZIP at all — they have a CITY, sitting unused
-- in `profiles.location`, while `parishForCity()` had existed in
-- `src/lib/parishes.ts` the whole time. The rung is the SQL counterpart of that
-- function, including its refusal to guess (see `get_parish_for_city` below).
--
-- `parish_source` records WHICH rung answered, because "Orleans because your
-- ZIP is 70112" and "Orleans because you typed New Orleans" are not the same
-- claim and a later consumer will want to tell them apart. It also makes the
-- ladder auditable: `SELECT parish_source, count(*) FROM profiles GROUP BY 1`
-- is the health check that the old design had no way to express.
--
-- ══ Three decisions the owner asked for reasoning on, not assumptions ══════
--
-- **1. Does the trigger ignore a client-supplied parish? YES, outright.**
-- `parish` and `parish_source` are both in the trigger's `UPDATE OF` list, so
-- writing to them is itself what fires the recompute — a client that sends
-- `parish` has it overwritten by the derivation in the same statement. This is
-- deliberately stronger than "the server prefers its own lookup": there is no
-- code path, from any role, that can put a parish on a profile that its ZIP or
-- city does not support. `complete-signup/index.ts:518` currently PREFERS a
-- client-supplied parish over its own server lookup; that becomes inert rather
-- than wrong, but it should be deleted, and the client should stop sending the
-- field — flagged rather than changed here because those files belong to
-- another lane this pass.
--
-- **2. What happens when a ZIP does not resolve? Accept and be loud.** Not
-- reject. Rejecting a ZIP at signup means an out-of-state member — someone
-- moving to Louisiana next month, a poster who lives across the Texas line and
-- owns property here — cannot create an account at all, and that is a worse
-- product than a member with no parish. What was wrong before was never the
-- NULL; it was that the NULL was SILENT. So all three signals fire: the person
-- sees an inline warning on the ZIP field, the client writes an `error_logs`
-- row (`parishLookup.unknownZip`), and rung 3 below RAISEs a WARNING into the
-- Postgres log. The bar the owner set — nobody ends up invisible to the feed
-- without anyone knowing — is met by knowing, not by refusing.
--
-- **3. Should `parish` still be a stored column? YES, and it is a cache, so
-- the drift has to be designed out rather than hoped away.** Resolving at read
-- time was the alternative and it loses on two concrete counts: the fan-out
-- trigger's predicate is `p.parish = NEW.parish`, which with a derived value
-- becomes a function call per candidate row and cannot use `idx_profiles_parish`;
-- and `get_ranked_open_jobs` ranks on it, so every ranked read would pay the
-- join. The drift risk is real and is answered structurally, not by discipline:
-- the value is recomputed from scratch on every write that could change it, the
-- derivation lives in ONE function rather than at each call site, and this
-- migration's backfill is a re-runnable repair that reconciles the whole table
-- against the source of truth. Fixing a wrong parish means fixing the ROW in
-- `louisiana_zip_parishes` — one edit that then flows to every affected member —
-- which is why there is deliberately no per-profile manual override to drift.

-- ── Rung 2: the SQL counterpart of parishForCity() ─────────────────────────
--
-- DERIVED from `louisiana_zip_parishes` rather than stored in a second table,
-- so it cannot drift from the ZIP data: a city belongs to the parish of its
-- ZIPs, by construction.
--
-- The `HAVING count(DISTINCT parish) = 1` is the load-bearing half and it is
-- the same refusal `parishForCity()` makes in TypeScript. Border towns exist,
-- and the completed table contains a real one: "New Orleans" is the USPS city
-- for five JEFFERSON parish ZIPs (70121 Harahan, 70123 Elmwood and three
-- PO-box ZIPs) as well as for all 56 Orleans ones. Resolving that name to
-- Orleans would file every Harahan resident in the wrong parish on the strength
-- of their mailing address. Answering NULL — falling through to rung 3, which
-- is loud — is correct; guessing is not.
--
-- `split_part(..., ',', 1)` because `profiles.location` is free text and holds
-- "Baton Rouge, LA" as often as "Delcambre".
CREATE OR REPLACE FUNCTION public.get_parish_for_city(p_city text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH norm AS (
    SELECT lower(btrim(split_part(coalesce(p_city, ''), ',', 1))) AS city
  )
  SELECT max(t.parish)
    FROM public.louisiana_zip_parishes t, norm
   WHERE norm.city <> ''
     AND lower(t.city) = norm.city
  HAVING count(DISTINCT t.parish) = 1;
$$;

-- Only the trigger calls this. Naming anon and authenticated explicitly is not
-- belt-and-braces: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every
-- new public function to anon, authenticated and service_role INDIVIDUALLY, so
-- `REVOKE ... FROM PUBLIC` alone drops the implicit world grant and leaves all
-- three intact — a REVOKE that reads as least privilege and achieves nothing.
REVOKE ALL ON FUNCTION public.get_parish_for_city(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_parish_for_city(text) IS
  'Rung 2 of the parish ladder: infers a parish from a free-text city, or '
  'returns NULL rather than guessing when the name spans more than one parish. '
  'Weaker than get_parish_for_zip and recorded as such in profiles.parish_source. '
  'Internal to derive_profile_parish(); not granted to anon or authenticated.';

-- ── Which rung answered ────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS parish_source text;

COMMENT ON COLUMN public.profiles.parish_source IS
  'Which rung of the parish ladder produced profiles.parish: ''zip'' '
  '(authoritative — the member''s ZIP maps to exactly one parish) or ''city'' '
  '(an inference from free-text location, weaker, and overridden the moment a '
  'resolvable ZIP arrives). NULL exactly when parish is NULL. Written only by '
  'derive_profile_parish(); never supplied by a client.';

COMMENT ON COLUMN public.profiles.parish IS
  'DERIVED from zip_code (or, failing that, location) by derive_profile_parish() '
  '— never supplied by a client, and overwritten if one tries. See '
  'profiles.parish_source for which rung answered. To correct a wrong parish, '
  'fix the row in louisiana_zip_parishes and re-run this migration''s backfill; '
  'there is deliberately no per-profile override.';

-- ── The derivation ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.derive_profile_parish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parish text;
BEGIN
  -- Rung 1: ZIP. Authoritative.
  v_parish := public.get_parish_for_zip(NEW.zip_code);
  IF v_parish IS NOT NULL THEN
    NEW.parish := v_parish;
    NEW.parish_source := 'zip';
    RETURN NEW;
  END IF;

  -- Rung 2: city. An inference, and marked as one.
  v_parish := public.get_parish_for_city(NEW.location);
  IF v_parish IS NOT NULL THEN
    NEW.parish := v_parish;
    NEW.parish_source := 'city';
    RETURN NEW;
  END IF;

  -- Rung 3. Nulling rather than keeping the previous value is deliberate: if a
  -- member changes their ZIP to one nothing can place, the old parish is no
  -- longer supported by any evidence, and leaving it would quietly hold them in
  -- a market they may have left.
  NEW.parish := NULL;
  NEW.parish_source := NULL;

  -- LOUD, but only when the member actually supplied something we failed to
  -- place. A profile with no ZIP and no city has not failed a lookup; it has
  -- not attempted one, and warning on every save of an empty profile would bury
  -- the signal that matters under the one that does not.
  IF coalesce(btrim(NEW.zip_code), '') <> '' OR coalesce(btrim(NEW.location), '') <> '' THEN
    RAISE WARNING 'parish_underivable: profile=% zip=% city=% — this member is invisible to parish job matching',
      NEW.id, coalesce(NEW.zip_code, '<null>'), coalesce(NEW.location, '<null>');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.derive_profile_parish() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.derive_profile_parish() IS
  'BEFORE INSERT OR UPDATE trigger making profiles.parish a function of '
  'zip_code (rung 1) then location (rung 2), and NULL plus a RAISE WARNING '
  'otherwise (rung 3). parish and parish_source are in the trigger''s UPDATE OF '
  'list, so writing to them is itself what fires the recompute — that is what '
  'makes a client-supplied parish impossible rather than merely discouraged.';

-- Trigger NAME chosen for its sort order, not for readability alone. Postgres
-- fires BEFORE-row triggers in alphabetical order by trigger name, and
-- `profiles` already carries five: enforce_banned_profile_text_lock,
-- tr_preserve_first_consent, tr_prevent_self_escalation,
-- trg_auto_pending_credentials, update_profiles_updated_at. `trg_derive_...`
-- sorts after every trigger that REWRITES a NEW column and before
-- update_profiles_updated_at, so this derivation reads post-guard values rather
-- than a caller's pre-guard ones. (The banned-text lock resets only full_name
-- and bio today, so there is no interaction to lose — but a guard that resets a
-- column is exactly how an ordering bypass gets created later, so the ordering
-- is asserted in the PGlite probe rather than assumed.)
DROP TRIGGER IF EXISTS trg_derive_profile_parish ON public.profiles;
CREATE TRIGGER trg_derive_profile_parish
  BEFORE INSERT OR UPDATE OF zip_code, location, parish, parish_source
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_profile_parish();

-- ── Backfill, all three rungs, explicitly ──────────────────────────────────
--
-- Written out rather than leaning on `SET zip_code = zip_code` to fire the
-- trigger, so the intent survives someone later reading only this statement.
-- The trigger fires on it anyway (parish is in its UPDATE OF list) and
-- recomputes the identical values, which is the point: the backfill and the
-- steady-state derivation cannot disagree, because the second overwrites the
-- first with the same function.
--
-- It reconciles the WHOLE table against the source of truth rather than only
-- filling NULLs, so it is also the repair tool for a `louisiana_zip_parishes`
-- row that was wrong and has since been fixed — re-running this migration
-- re-places every member the correction affects.
--
-- The `IS DISTINCT FROM` predicate is not cosmetic. An unconditional
-- `UPDATE public.profiles` is a full-table rewrite that `check-destructive-ddl`
-- blocks on sight, and rightly: this project has no restorable backup. Touching
-- only the rows whose derived value actually differs makes the statement
-- honest, keeps the second run a no-op, and avoids firing every other BEFORE
-- trigger on `profiles` for rows nothing changed about.
UPDATE public.profiles p
   SET parish        = d.parish,
       parish_source = d.parish_source
  FROM (
    SELECT id,
           COALESCE(public.get_parish_for_zip(zip_code),
                    public.get_parish_for_city(location)) AS parish,
           CASE
             WHEN public.get_parish_for_zip(zip_code)  IS NOT NULL THEN 'zip'
             WHEN public.get_parish_for_city(location) IS NOT NULL THEN 'city'
             ELSE NULL
           END AS parish_source
      FROM public.profiles
  ) d
 WHERE p.id = d.id
   AND (p.parish        IS DISTINCT FROM d.parish
     OR p.parish_source IS DISTINCT FROM d.parish_source);

-- `jobs.parish` gets the backfill but deliberately NOT a trigger. A job's
-- parish is its tax and market jurisdiction LOCKED AT CREATION — re-deriving it
-- whenever a row is touched would let a later edit silently move a job between
-- markets after bids exist. Rung 2 is also wrong here: `jobs.location` is a
-- street address, not a city name.
UPDATE public.jobs j
   SET parish = public.get_parish_for_zip(j.zip_code)
 WHERE j.parish IS NULL
   AND j.zip_code IS NOT NULL
   AND btrim(j.zip_code) <> ''
   AND public.get_parish_for_zip(j.zip_code) IS NOT NULL;

-- ── The invariant, added after the backfill has established it ─────────────
--
-- parish and parish_source are set together or not at all. NOT VALID + VALIDATE
-- so the table is not exclusively locked for the scan.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_parish_source_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_parish_source_valid CHECK (
    (parish IS NULL AND parish_source IS NULL)
    OR (parish IS NOT NULL AND parish_source IN ('zip', 'city'))
  ) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_parish_source_valid;

-- ── Prove the ladder, rather than trusting it ──────────────────────────────
DO $$
DECLARE
  v_null_parish int;
  v_bad int;
BEGIN
  -- Rung 1 and rung 2 answer, and rung 2 refuses the ambiguous name.
  IF public.get_parish_for_zip('70528') IS DISTINCT FROM 'Vermilion' THEN
    RAISE EXCEPTION 'rung 1 broken: 70528 did not resolve to Vermilion';
  END IF;
  IF public.get_parish_for_city('Delcambre') IS DISTINCT FROM 'Vermilion' THEN
    RAISE EXCEPTION 'rung 2 broken: Delcambre did not resolve to Vermilion';
  END IF;
  IF public.get_parish_for_city('Baton Rouge, LA') IS DISTINCT FROM 'East Baton Rouge' THEN
    RAISE EXCEPTION 'rung 2 broken: it does not strip the ", LA" suffix';
  END IF;
  IF public.get_parish_for_city('New Orleans') IS NOT NULL THEN
    RAISE EXCEPTION 'rung 2 guessed on New Orleans, which spans Orleans and Jefferson';
  END IF;
  IF public.get_parish_for_city('Nacogdoches') IS NOT NULL THEN
    RAISE EXCEPTION 'rung 2 answered for a city that is not in Louisiana';
  END IF;

  -- The invariant holds across the whole table.
  SELECT count(*) INTO v_bad FROM public.profiles
   WHERE (parish IS NULL) <> (parish_source IS NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% profiles have parish and parish_source out of step', v_bad;
  END IF;

  -- Nobody who supplied a placeable ZIP or city is left without a parish.
  SELECT count(*) INTO v_null_parish FROM public.profiles
   WHERE parish IS NULL
     AND (public.get_parish_for_zip(zip_code) IS NOT NULL
          OR public.get_parish_for_city(location) IS NOT NULL);
  IF v_null_parish > 0 THEN
    RAISE EXCEPTION '% profiles are derivable but still NULL — the backfill did not run', v_null_parish;
  END IF;
END $$;

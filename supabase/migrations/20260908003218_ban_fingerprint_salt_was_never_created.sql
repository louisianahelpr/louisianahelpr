-- The salt guard in 20260908002148 was a no-op, and it deployed green.
--
-- That migration creates `ban_fingerprint_salt` in Vault behind
-- `IF to_regprocedure('vault.create_secret(text,text,text)') IS NULL THEN
-- RETURN`. Prod's signature is FOUR arguments —
-- `create_secret(new_secret text, new_name text, new_description text,
-- new_key_id uuid)` — read from `pg_proc` after the deploy, so the regprocedure
-- lookup returned NULL and the block returned before creating anything.
--
-- Measured, not inferred: `SELECT count(*) FROM vault.secrets WHERE name =
-- 'ban_fingerprint_salt'` came back 0 on prod immediately after a green
-- db-deploy. Every fingerprint written from that moment would have used
-- `ban_fingerprint_salt()`'s documented replay constant — i.e. an UNSALTED
-- hash in all but name, exactly the brute-forceable shape the salt exists to
-- prevent, with a NOTICE nobody reads as the only signal.
--
-- Two things go wrong at once here and both are worth naming, because the
-- guard read as correct in review:
--   · an existence check on the wrong SIGNATURE fails open in the silent
--     direction — `to_regprocedure` is exact-arity, and a defaulted trailing
--     parameter does not make the shorter form resolvable;
--   · the whole DO block ends in `EXCEPTION WHEN OTHERS ... RAISE NOTICE`, so
--     even a real failure could not have gone red.
--
-- Nothing needs re-hashing. Prod had zero rows in `retained_bans` and zero
-- accounts in any banned state when 002148 applied, so no fingerprint was ever
-- written against the replay constant. If that had not been true this
-- migration would have had to clear the affected keys rather than silently
-- start salting.

DO $$
DECLARE
  v_exists boolean;
  v_secret text;
BEGIN
  -- Name only. Whatever arity this project's Vault ships, the three leading
  -- parameters are (secret, name, description) and the rest are defaulted.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'vault' AND p.proname = 'create_secret'
  ) THEN
    -- PGlite / CI replay: no vault extension at all.
    RAISE NOTICE 'ban_fingerprint_salt: no vault.create_secret in this database — skipping';
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)'
    INTO v_exists USING 'ban_fingerprint_salt';

  IF v_exists THEN
    RETURN;
  END IF;

  -- 256 bits from two v4 UUIDs plus the clock, hashed. `gen_random_bytes` was
  -- the obvious source and is deliberately NOT used: it lives in pgcrypto,
  -- whose presence is one more thing this migration would be silently
  -- depending on. `gen_random_uuid()` is core in PG13+.
  v_secret := encode(
    sha256((gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text)::bytea),
    'hex'
  );

  EXECUTE 'SELECT vault.create_secret($1, $2, $3)'
    USING v_secret,
          'ban_fingerprint_salt',
          'Peppers retained_bans.phone_sha256 / identity_sha256 and '
          'profiles.identity_sha256. Rotating this un-bans every fingerprinted '
          'account — treat as permanent.';

  -- Fail LOUDLY if it still is not there. The whole point of this migration is
  -- that the previous version of it could not go red.
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)'
    INTO v_exists USING 'ban_fingerprint_salt';
  IF NOT v_exists THEN
    RAISE EXCEPTION 'ban_fingerprint_salt was not created — retained-ban fingerprints would be unsalted';
  END IF;
END;
$$;

-- Belt and braces on the read side: make it impossible for the salt to be
-- silently absent in an environment that HAS a vault. The replay constant is
-- for databases with no vault schema at all, not for a prod whose secret
-- failed to materialise.
CREATE OR REPLACE FUNCTION public.ban_fingerprint_salt()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE
  v_salt      text;
  v_has_vault boolean;
BEGIN
  v_has_vault := EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault');

  IF v_has_vault THEN
    BEGIN
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
        INTO v_salt USING 'ban_fingerprint_salt';
    EXCEPTION WHEN OTHERS THEN
      v_salt := NULL;
    END;

    IF v_salt IS NULL OR btrim(v_salt) = '' THEN
      -- Refuse rather than quietly returning an unsalted-equivalent constant.
      -- Every caller of this is inside an exception handler that treats a
      -- failure as "could not answer the ban question", which fails CLOSED at
      -- the IDV webhook and merely skips the check at signup — both better
      -- than writing hashes nobody can reproduce.
      RAISE EXCEPTION 'ban_fingerprint_salt: vault secret is missing — refusing to emit unsalted fingerprints';
    END IF;

    RETURN v_salt;
  END IF;

  -- No vault schema: a PGlite / CI replay. The constant keeps the fingerprint
  -- functions testable and never runs in prod.
  RAISE NOTICE 'ban_fingerprint_salt: no vault schema — using replay constant';
  RETURN 'lh-ban-fingerprint-replay-salt-v1';
END;
$$;

COMMENT ON FUNCTION public.ban_fingerprint_salt() IS
  'The pepper for retained-ban fingerprints, from Vault. Raises rather than '
  'falling back when a vault-bearing database has no secret — an unsalted '
  'fingerprint is worse than no fingerprint. Never rotate: every stored hash '
  'is keyed on it.';

REVOKE ALL ON FUNCTION public.ban_fingerprint_salt() FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.ban_fingerprint_salt() FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ban_fingerprint_salt() TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

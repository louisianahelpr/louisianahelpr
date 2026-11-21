-- Secret Santa: the organizer can cancel a draw, so a redraw never leaves two live draws (holiday audit C2, 11-20).
--
-- WHAT WAS BROKEN: the organizer's private links lived only in page memory. A reload (common after switching to
-- Messages to send one) lost them, and the only way back was a new draw. That made new matches while the links
-- already sent from the first draw kept working: the group ended up with two conflicting draws, and nothing on the
-- server could turn the first one off (secret_santa_create returns the tokens; only their SHA-256 is stored).
--
-- WHY THIS FIXES IT: the drawer now keeps the organizer's last draw on their device (lh-santa-last) and, before a
-- redraw, warns and calls secret_santa_cancel(code, tokens). Only the organizer holds EVERY person's token (each
-- person's link carries just their own), so the function deletes the group only when the caller presents the full
-- set: one token per person, every one matching a stored token_hash in that group. Any other request (a wrong
-- token, a missing one, a single person's own link, an expired group) changes nothing and returns false. The
-- group's people go with it (ON DELETE CASCADE), so every old link then shows "This link doesn't work anymore".
-- No account, email or phone is read or kept; no new table.
--
-- Ban gate: anon-callable by design, like secret_santa_create (the drawer is signed out); it only deletes a group
-- the caller fully holds, posts nothing and moves no money (scripts/ci/ban-gate-coverage.sql exemption).
--
-- REPLAY-SAFE: CREATE OR REPLACE; REVOKE FROM PUBLIC, anon, authenticated then GRANT. Guarded on the tables
-- (20261120062334) existing. Proof: src/test/pglite/giftGuideSecretSanta.pglite.mjs (applied 3x).

DO $guard$
BEGIN
  IF to_regclass('public.secret_santa_groups') IS NULL OR to_regclass('public.secret_santa_people') IS NULL THEN
    RAISE EXCEPTION 'secret_santa tables missing: apply 20261120062334 first';
  END IF;
END
$guard$;

-- True when the group was deleted (the caller presented every person's token); false otherwise.
CREATE OR REPLACE FUNCTION public.secret_santa_cancel(p_code text, p_tokens text[])
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_size integer;
  v_given integer := COALESCE(array_length(p_tokens, 1), 0);
  v_matched integer;
  v_rows integer;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-f0-9]{10}$' OR v_given < 3 OR v_given > 30 THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_tokens) t WHERE t IS NULL OR t !~ '^[a-f0-9]{64}$') THEN
    RETURN false;
  END IF;
  SELECT g.size INTO v_size FROM public.secret_santa_groups g WHERE g.code = p_code AND g.expires_at > now() FOR UPDATE;
  IF v_size IS NULL OR v_size <> v_given THEN
    RETURN false;
  END IF;
  -- Every person's token, each once: the distinct hashes given that match this group's people must be all of them.
  SELECT count(*) INTO v_matched
    FROM public.secret_santa_people me
   WHERE me.group_code = p_code
     AND me.token_hash IN (SELECT DISTINCT encode(sha256(convert_to(t, 'UTF8')), 'hex') FROM unnest(p_tokens) t);
  IF v_matched <> v_size THEN
    RETURN false;
  END IF;
  DELETE FROM public.secret_santa_groups WHERE code = p_code;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.secret_santa_cancel(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_santa_cancel(text, text[]) TO anon, authenticated, service_role;

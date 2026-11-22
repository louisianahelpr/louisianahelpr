-- Gift guides: delete a wish list, or stop a shared link (holiday audit 1121, Medium: "No way to delete a wish list or
-- stop a shared link" - neither the app nor the server could delete a gift_wish_lists row; a guest's shared link stayed
-- live for 90 days and an account's list stayed until the account was deleted).
--   * gift_wish_list_delete() -> boolean   authenticated: deletes the caller's own synced list (user_id = auth.uid()),
--     so its link stops working at once. True when a row was deleted. Nothing else is touched.
--   * gift_wish_list_claim(p_code, p_token) -> boolean   anon + authenticated: the browser that just made a SNAPSHOT
--     (user_id NULL) stores the SHA-256 of a random 64-hex token it keeps on the device, so it can stop that link later.
--     Only once per snapshot, only within 60 seconds of the snapshot being made (the browser claims at once; lh-authz-rls review: a shorter window for anyone who saw the code) (the code is known only to the browser
--     that made it until it is shared), never for an account's own row. True when stored.
--   * gift_wish_list_unshare(p_code, p_token) -> boolean   anon + authenticated: deletes a snapshot whose claimed token
--     hash matches. False for a wrong token, an unclaimed snapshot or an account's row (the account uses delete).
--   * gift_wish_list_owners: code (cascade-deleted with its list) + token_hash. RLS on, no policy, no client privilege.
--     No account id, address or token is stored (only its hash).
-- The 4 leftover is_seed test lists from the holiday audit were made before this, so they hold no claim; see the report.
-- MONEY: none. REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, REVOKE/GRANT.
-- Proof: src/test/pglite/giftWishListDelete.pglite.mjs (applied 3x).

CREATE TABLE IF NOT EXISTS public.gift_wish_list_owners (
  code text PRIMARY KEY REFERENCES public.gift_wish_lists(code) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gift_wish_list_owners IS
  'Gift guides (20261122024017): the SHA-256 of the token the browser that made a shared snapshot keeps, so it can stop that link (gift_wish_list_unshare). Read/written only via the gift_wish_list_* functions.';
ALTER TABLE public.gift_wish_list_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gift_wish_list_owners FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gift_wish_list_owners TO service_role;
-- Every public table keeps the unconfirmed-email gate (Q807; db-smoke; lh-authz-rls review).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.gift_wish_list_delete()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.gift_wish_lists w WHERE w.user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_delete() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_wish_list_claim(p_code text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_rows int;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{12}$' OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.gift_wish_list_owners (code, token_hash)
  SELECT w.code, encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    FROM public.gift_wish_lists w
   WHERE w.code = p_code AND w.user_id IS NULL AND w.created_at > now() - interval '60 seconds'
  ON CONFLICT (code) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_claim(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_claim(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_wish_list_unshare(p_code text, p_token text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_rows int;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{12}$' OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.gift_wish_lists w
   USING public.gift_wish_list_owners o
   WHERE w.code = p_code AND w.user_id IS NULL
     AND o.code = w.code AND o.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_wish_list_unshare(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_wish_list_unshare(text, text) TO anon, authenticated, service_role;

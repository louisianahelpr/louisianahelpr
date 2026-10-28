-- Declutter: Claude writes a NEW listing from its photos (owner 2026-10-28:
-- "claude did not help with the listing so idk how to get it to do the
-- listing for me").
--
-- What was broken: "Fill in from my photos" (row 32) only showed once the
-- photos were on a SAVED draft, and a new listing is first saved on step 4,
-- so a new seller never saw it. The fix sends the photos still held on the
-- device in the request body, the way the moving-out room scan already does
-- (declutter-ai-draft mode 'draft' with `photos` and no itemId). The photos
-- are only passed to the model; nothing is stored, nothing is saved.
--
-- Without a draft there is no "is this the caller's own draft" check to gate
-- the model's cost on, so this adds the selling gates as their own callable
-- check, the same as declutter_assert_can_scan_room without the moving-out
-- switch: the 'declutter' switch, a banned account, 3 strikes, under 18.
-- The edge function calls it with the CALLER's token (never an id from the
-- body), before it spends anything; it also keeps its per-minute limit and
-- adds an hourly one.
--
-- REPLAY-SAFE: CREATE OR REPLACE, then REVOKE/GRANT. Applied 3x in PGlite
-- (src/test/pglite/declutterAiDraftFromPhotos.pglite.mjs).

CREATE OR REPLACE FUNCTION public.declutter_assert_can_draft_from_photos()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not signed in, 3 strikes, under 18: the selling gates.
  PERFORM public.declutter_assert_member(true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_assert_can_draft_from_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_assert_can_draft_from_photos() TO authenticated, service_role;

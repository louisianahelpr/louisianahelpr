-- L5 (share-profile audit 11-05): public_profile_by_handle's comment said the answer never carries "the user id", but
-- photo_url does. A member's own photo is a public avatars-bucket URL, avatars/<user id>/avatar.jpg (measured
-- 2026-11-05 on /u/lexi-l: .../storage/v1/object/public/avatars/<her user id>/avatar.jpg), and the Recent work photos
-- (20261105165059) live in the same bucket under the same folder. The user id is already public (/book/<id> and
-- /user/<id> links, get_safe_profiles for anon), so this is not a leak; the comment was untrue.
--
-- Decision: fix the comment, not the path. Serving avatars by handle would need a new proxy for every avatar the app
-- shows and would break no one's privacy that the /book and /user links do not already; existing avatars keep working.
-- Only the COMMENT changes (no function body), so the live definition stays whatever the newest migration made it.
--
-- REPLAY-SAFE: COMMENT ON is idempotent, and it runs only while the function exists.
DO $$
BEGIN
  IF to_regprocedure('public.public_profile_by_handle(text)') IS NOT NULL THEN
    COMMENT ON FUNCTION public.public_profile_by_handle(text) IS
      'LEAD-PROFILE-LINK: the public /u/<handle> profile (anon included): public name, photo, member since, public '
      'stats, live Declutter listings (card fields), own open jobs (town only, never the address), Helpr work '
      '(jobs done, categories, public reviews), public open Wanted posts. Never contacts, addresses, coordinates, '
      'test data, expired or cancelled jobs. No user_id field, but photo_url and the Recent work photos are public '
      'avatars-bucket URLs whose folder is the user id (already public through /book and /user links). NULL for an '
      'unknown, hidden or test member.';
  END IF;
END
$$;

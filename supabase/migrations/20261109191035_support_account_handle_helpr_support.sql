-- F067 (owner UI audit 11-09; lead go-ahead 11-09: "the support account is our own, so go ahead"): the official
-- Helpr support account (profiles.id 9d8cb28b-d5c5-4b7e-9368-38996dcdf1fe, user 7f65ef12-1d3d-439b-b0a7-f42ce8bc176d,
-- full name "Admin", an admin) was reached at
-- /u/neighbor, the generic fallback handle every name with no usable letters gets. It becomes /u/helpr-support.
--
-- OLD LINKS KEEP WORKING: trg_profile_handle_retire (20261101034834) retires "neighbor" for THIS account on the
-- update, so public_profile_by_handle('neighbor') opens this account's page and moves to the new handle, and no one
-- else can ever take "neighbor" (rpc_ensure_my_handle skips a retired handle: a name with no usable letters gets
-- "neighbor-2" and on, 20261104142602). Read on prod 11-09: "helpr-support" free (no profile, not retired),
-- profile_handle_problem('helpr-support') is NULL, "neighbor" not yet retired.
--
-- Our own account only, by id AND its current handle, so a replay (or a later handle change in Settings) is a no-op.
-- The handle columns are server-owned (trg_profile_handle_server_owned): a migration is server context, and the
-- transaction-local app.profile_handle_rpc flag is set too, the same one the two handle RPCs use.
-- handle_changed_at stays as it is: this is our rename, not the member's one change.

-- RESERVED FIRST (review 11-09, lh-authz-rls notes): 'helpr-support' and every 'helpr-…' handle read as the app's own
-- staff, so no member can pick or be given one (profile_handle_problem is the one rule for a picked AND a default
-- handle). Read on prod 11-09: no profile and no retired handle starts with 'helpr'. Restated from its only
-- definition (20261101034834) with the one added clause; everything else verbatim.
CREATE OR REPLACE FUNCTION public.profile_handle_problem(p_handle text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN h IS NULL OR h !~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$' OR length(h) NOT BETWEEN 3 AND 30 THEN 'handle_invalid'
    WHEN h = ANY (ARRAY['admin', 'administrator', 'support', 'help', 'helpr', 'helprs', 'louisianahelpr',
                        'settings', 'profile', 'jobs', 'job', 'declutter', 'messages', 'account', 'login',
                        'signup', 'sign-up', 'official', 'team', 'staff', 'moderator', 'security', 'api',
                        'null', 'undefined', 'me', 'you', 'user', 'users', 'member', 'members'])
         OR h LIKE 'louisianahelpr%' OR h LIKE 'admin%' OR h LIKE 'helpr-%' THEN 'handle_reserved'
    WHEN length(regexp_replace(h, '[^0-9]', '', 'g')) >= 7 THEN 'handle_has_contact'
  END
    FROM (SELECT p_handle AS h) x
$function$;

REVOKE ALL ON FUNCTION public.profile_handle_problem(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_handle_problem(text) TO authenticated, service_role;

SELECT set_config('app.profile_handle_rpc', '1', true);

UPDATE public.profiles
   SET handle = 'helpr-support'
 WHERE id = '9d8cb28b-d5c5-4b7e-9368-38996dcdf1fe'
   AND user_id = '7f65ef12-1d3d-439b-b0a7-f42ce8bc176d'
   AND handle = 'neighbor'
   AND NOT EXISTS (SELECT 1 FROM public.profiles o WHERE o.handle = 'helpr-support')
   AND NOT EXISTS (SELECT 1 FROM public.profile_handles_retired r
                    WHERE r.handle = 'helpr-support' AND r.user_id IS DISTINCT FROM '7f65ef12-1d3d-439b-b0a7-f42ce8bc176d'::uuid);

SELECT set_config('app.profile_handle_rpc', '', true);

-- Say so in the deploy log when the rename did not happen and is not already done (review 11-09): never a silent no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE user_id = '7f65ef12-1d3d-439b-b0a7-f42ce8bc176d' AND handle = 'helpr-support') THEN
    RAISE WARNING 'F067: the support account is not on helpr-support (handle now: %)',
      (SELECT handle FROM public.profiles WHERE user_id = '7f65ef12-1d3d-439b-b0a7-f42ce8bc176d');
  END IF;
END $$;

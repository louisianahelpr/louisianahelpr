-- Q2788 (landing audit L003 follow-up): a signed-out visitor's ID wording (the legal short versions, /safety, the
-- landing's trust card) must follow the identity_check switch, not a constant in the client. feature_enabled_for()
-- is signed-in only (it reads auth.uid()), and features_open_to_everyone() answers only the three section switches
-- (lead review 2026-10-19: other rollouts stay private). This answers ONE public fact, as a boolean: is the
-- identity_check switch open to everyone. Nothing about testers, admins, who is in which audience, or any other
-- switch; no arguments, no row data. Whether ID checks are on for everyone is already stated on the public legal
-- pages, so the answer reveals nothing the site does not say.
CREATE OR REPLACE FUNCTION public.identity_check_on_for_everyone()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_switches
    WHERE key = 'identity_check'
      AND audience = 'everyone'
  );
$function$;

COMMENT ON FUNCTION public.identity_check_on_for_everyone() IS
  'Whether the identity_check switch is open to everyone, for the public ID wording (Q2788). Reveals nothing about other switches, testers or admins.';

REVOKE ALL ON FUNCTION public.identity_check_on_for_everyone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_check_on_for_everyone() TO anon, authenticated, service_role;

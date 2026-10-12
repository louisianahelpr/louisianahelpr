-- Three policy helpers answered about ANY user id when a signed-in account
-- called them directly over /rest/v1/rpc (found by Q1284's class check; the
-- item is Q1328 in docs/OPEN.md):
--
--   * has_role(uuid, app_role) said whether any id is an admin;
--   * user_may_see_job_address(uuid, uuid) said whether any id is the hired,
--     offered or rostered Helpr on a job (offered_to_helper_id is withheld
--     from `authenticated` for exactly that reason);
--   * group_member_slot(uuid, uuid) returned any id's crew slot on any job
--     (lh-authz-rls proved it live on 2026-10-05: a poster who is not on seed
--     crew def709bf read 0 rows from group_job_helpers but got two members'
--     slots from this function).
--
-- They must stay EXECUTE-able by `authenticated` (RLS policies call them),
-- but nothing required the id to be the caller. Each one now answers only:
--
--   has_role                 the caller's own id, a server context (service
--                            role, cron), a trigger body (pg_trigger_depth,
--                            the are_users_blocked pattern), or a caller who
--                            is an admin. Every other id gets false.
--   user_may_see_job_address the caller's own id or a server context. Every
--                            SQL caller passes auth.uid() (the jobs SELECT
--                            policy, get_jobs_for_my_applications,
--                            get_my_pending_direct_offers) or runs as
--                            service_role (export_my_data).
--   group_member_slot        the caller's own id, a server context, or the
--                            job's poster (who already sees the roster under
--                            group_job_helpers' RLS). Callers: the member
--                            RPCs (auth.uid()), rpc_poster_confirm_member_arrival
--                            (the poster) and the reviews INSERT policy (the
--                            poster about a member, or a member about self).
--
-- Every SQL caller that passes another person's id was listed from prod on
-- 2026-10-12 (every public function body and every pg_policies row that calls
-- one of the three, with the first/second argument read). Only one breaks
-- under the scoping, and it is restated here:
--
--   send_team_reply: a member replying in their "Louisiana Helpr Team" thread
--   looked up which earlier sender still holds the admin role with
--   has_role(m.sender_id, ...). It is SECURITY DEFINER, so it now reads
--   public.user_roles directly (as the owner) instead of asking has_role on
--   the member's behalf. Body otherwise verbatim from
--   20261011161100_team_thread_direct_messages.sql.
--
-- enforce_block_on_message_insert (SECURITY INVOKER trigger) also passes the
-- other party's id (has_role(NEW.receiver_id, ...) when the member writes to
-- staff); it runs inside a trigger, which the pg_trigger_depth() arm keeps
-- answering, so it is unchanged and stays INVOKER.
--
-- Edge functions call has_role through service-role clients with the caller's
-- own id (both arms hold). Nothing in src/ calls any of the three.
--
-- Replay-safe: CREATE OR REPLACE of functions every earlier migration already
-- defines; grants restated (REVOKE FROM PUBLIC, anon; GRANT to authenticated,
-- service_role), unchanged from prod.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       _user_id IS NOT DISTINCT FROM auth.uid()
       OR public.is_server_context()
       OR pg_trigger_depth() > 0
       OR EXISTS (
         SELECT 1 FROM public.user_roles c
         WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role
       )
     )
     AND EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id AND role = _role
     )
$function$;

CREATE OR REPLACE FUNCTION public.user_may_see_job_address(_job_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
    AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context())
    AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (
          j.customer_id = _user_id
          OR j.helper_id = _user_id
          OR (
            j.offered_to_helper_id = _user_id
            AND j.direct_offer_status = 'pending'
            AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at > now())
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = _job_id AND g.helper_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = _job_id AND a.helper_id = _user_id AND a.status = 'accepted'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.group_member_slot(_job_id uuid, _user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT g.id
  FROM public.group_job_helpers g
  WHERE g.job_id = _job_id
    AND _user_id IS NOT NULL
    AND g.helper_id = _user_id
    AND (
      _user_id IS NOT DISTINCT FROM auth.uid()
      OR public.is_server_context()
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.customer_id = auth.uid())
    )
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.send_team_reply(
  p_content text,
  p_client_id uuid DEFAULT NULL
)
 RETURNS public.messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me      uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_admin   uuid;
  v_row     public.messages;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22001';
  END IF;

  -- The caller's OWN thread only, and only once staff opened it: the reply
  -- goes to the admin who wrote last there and still holds the role. The
  -- role is read from user_roles directly: has_role answers a member only
  -- about themselves.
  SELECT m.sender_id INTO v_admin
    FROM public.messages m
   WHERE m.team_thread_user_id = v_me
     AND m.sender_id <> v_me
     AND EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.user_id = m.sender_id AND r.role = 'admin'::public.app_role)
   ORDER BY m.created_at DESC
   LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'no_team_thread' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages (job_id, team_thread_user_id, sender_id, receiver_id, content, client_id)
  VALUES (NULL, v_me, v_me, v_admin, v_content, p_client_id)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.group_member_slot(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_team_reply(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_may_see_job_address(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.group_member_slot(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_team_reply(text, uuid) TO authenticated, service_role;

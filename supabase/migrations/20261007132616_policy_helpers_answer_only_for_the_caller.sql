-- Q1328: three policy helpers answered about ANY user id when an authenticated
-- client called them directly over PostgREST.
--
--   has_role(uuid, app_role)              said whether any id is an admin;
--   user_may_see_job_address(uuid, uuid)  said whether any id is the hired or
--                                         offered Helpr on a job (the reason
--                                         offered_to_helper_id is withheld from
--                                         authenticated);
--   group_member_slot(uuid, uuid)         said whether any id is on a crew
--                                         (lh-authz-rls proved it live
--                                         2026-10-05: poster 96c9899e, not on
--                                         seed crew def709bf, read two members'
--                                         slots through it).
--
-- Policies call them with auth.uid(), so authenticated keeps EXECUTE. What
-- changes is that each now answers only when the id asked about IS the caller,
-- or the caller is the server (is_server_context: cron, service role), or the
-- caller is an admin. Anything else gets false / NULL, the same answer as "not
-- an admin / not on this job / not on this crew".
--
-- group_member_slot also answers for the job's POSTER, because two callers ask
-- about someone else on the poster's behalf (inventory read live 2026-10-07:
-- every pg_proc body in every non-system schema, every pg_policies
-- qual/with_check, every view; no view calls any of the three):
--   * rpc_poster_confirm_member_arrival(_job_id, _helper_id) checks the caller
--     is the poster first, then asks group_member_slot(_job_id, _helper_id);
--   * the reviews INSERT policy "Users can create reviews for eligible jobs"
--     asks j.customer_id = auth.uid() AND group_member_slot(j.id, reviewee_id).
-- Every other caller passes auth.uid() (directly or through a variable
-- assigned from it), except export_my_data(p_user_id) and
-- lift_ban_settlement_review(p_admin_id), which only service_role may EXECUTE,
-- so they run in server context.
--
-- Bodies are the live pg_get_functiondef (2026-10-07) with only the scope
-- added. A NULL comparison (anonymous caller) falls to false, never NULL:
-- callers write IF NOT has_role(...), where a NULL would read as "admin".
--
-- REPLAY-SAFETY: CREATE OR REPLACE of functions that exist from 2026-03 and
-- 2026-09 migrations onward; grants restated by role name.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN COALESCE(
           _user_id = auth.uid()
           OR public.is_server_context()
           OR EXISTS (SELECT 1 FROM public.user_roles r
                       WHERE r.user_id = auth.uid() AND r.role = 'admin'::public.app_role),
           false)
      THEN EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role
      )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.user_may_see_job_address(_job_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
    AND COALESCE(
          _user_id = auth.uid()
          OR public.is_server_context()
          OR EXISTS (SELECT 1 FROM public.user_roles r
                      WHERE r.user_id = auth.uid() AND r.role = 'admin'::public.app_role),
          false)
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
    AND COALESCE(
          _user_id = auth.uid()
          OR public.is_server_context()
          OR EXISTS (SELECT 1 FROM public.jobs j
                      WHERE j.id = _job_id AND j.customer_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.user_roles r
                      WHERE r.user_id = auth.uid() AND r.role = 'admin'::public.app_role),
          false)
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_may_see_job_address(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.group_member_slot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_may_see_job_address(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.group_member_slot(uuid, uuid) TO authenticated, service_role;

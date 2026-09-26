-- Q348 (Q345 item 5): are_users_blocked(x, y) answered for ANY pair.
--
-- The function is SECURITY DEFINER and EXECUTE-granted to authenticated
-- (pg_proc.proacl on prod, 2026-09-26: {postgres, service_role,
-- authenticated}), so any signed-in user could call it by RPC for two third
-- parties and learn whether one had blocked the other.
--
-- It cannot simply be revoked from authenticated: three RLS policies call it
-- as the invoking role. Every caller was enumerated LIVE (pg_proc.prosrc and
-- pg_policies, 2026-09-26), and each already passes the caller as one of the
-- pair, or runs with no JWT:
--   policy applications "Helpers can create applications"   (helper_id = auth.uid(), ...)
--   policy applications "Job owners can view applications"  (helper_id, auth.uid())
--   policy jobs "Customers can create jobs"                 (customer_id = auth.uid(), offered_to_helper_id)
--   enforce_block_on_message_insert  (sender_id, receiver_id): a TRIGGER. A
--       client insert has sender_id = auth.uid() (messages INSERT policy), but
--       insert_job_status_system_message (SECURITY DEFINER, AFTER UPDATE OF
--       status ON jobs) inserts system messages FROM the poster TO each thread
--       participant while auth.uid() is whoever changed the status: the hired
--       Helpr, a crew member, an admin. Neither of the pair.
--   enforce_application_job_state    (NEW.helper_id, customer): a TRIGGER;
--       applications INSERT policy pins helper_id = auth.uid()
--   get_my_saved_helpers             (fh.customer_id, ...) WHERE fh.customer_id = auth.uid()
--   accept_application / accept_group_application (helper, poster) after
--       not_authorized pins poster = auth.uid()
--   respond_to_direct_offer          (auth.uid(), poster)
--   can_send_message_to_in_job       (auth.uid(), receiver)
-- The rule: answer when auth.uid() is one of the pair, in a server context
-- (service role, cron, migrations: no JWT), or inside a trigger
-- (pg_trigger_depth() > 0). The trigger arm is what keeps the system-message
-- chain above exact: without it the block trigger's `IF are_users_blocked(...)`
-- saw NULL for a third-party actor and let a message cross a block (lh-authz-rls
-- review of this migration, F1). Trigger arguments come from the row being
-- written, never from a client's RPC call; a direct RPC call always runs at
-- trigger depth 0. So no caller needed changing and no definer-only variant was
-- needed. Anyone else gets NULL,
-- the same for every pair, so it tells a third party nothing. NULL rather than
-- a raise: a planner may evaluate a policy's or a WHERE's call before the
-- cheaper `auth.uid() = x` conjunct on rows that conjunct would discard, and a
-- raise there would fail a legitimate query. In a policy or WHERE, NULL
-- behaves as not-true (WITH CHECK refuses, `NOT NULL` hides the row), so a
-- non-party can never be let through by it either.
--
-- Guard: src/test/areUsersBlockedPartyOnly.test.ts (newest definition keeps
-- the party rule; proacl) + behavioural scripts/probes/are-users-blocked-party.pglite.mjs.
-- Replay-safe: CREATE OR REPLACE with an unchanged signature, then the grants.

CREATE OR REPLACE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false)
      OR public.is_server_context()
      OR pg_trigger_depth() > 0
    THEN EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.are_users_blocked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated, service_role;

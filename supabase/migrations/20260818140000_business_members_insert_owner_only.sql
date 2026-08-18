-- SEC-002 (HIGH): close the self-service "become a member of any business" hole.
--
-- THE HOLE
-- --------
-- `20260425233224_ddac4ad3-…sql` created the INSERT policy on
-- public.business_members as:
--
--   WITH CHECK ( is_business_owner(business_id, auth.uid())
--                OR (role = 'owner' AND user_id = auth.uid()) )
--
-- The second clause puts NO constraint on `business_id`. Any authenticated
-- user who learns a business UUID could POST to /rest/v1/business_members
-- with {"business_id":"<victim>","user_id":"<self>","role":"owner",
-- "status":"active"} and the row was accepted. That makes
-- `is_business_member(<victim>, <attacker>)` true, which is the predicate
-- guarding:
--   • business_webhooks  — including `secret`, stored in PLAINTEXT
--                          (20260609180000_business_features.sql), so the
--                          attacker can forge signed webhook deliveries
--   • business_api_keys  — sha256-hashed, so metadata/roster only
--   • job_templates and every business_id-scoped job
-- The forged row also slips the 5-seat cap, because
-- enforce_business_member_limit() returns early when NEW.role = 'owner'.
--
-- Verified live on prod (inside a rolled-back transaction) BEFORE this fix:
-- inserting that exact payload as `authenticated` with a non-owner JWT was
-- ACCEPTED, and is_business_member() flipped to true. is_business_owner()
-- stayed false, because it reads businesses.owner_id rather than the
-- membership role — so the forged row conferred MEMBER reach, not owner
-- reach, through RLS.
--
-- THE FIX
-- -------
-- Drop the unconstrained clause. Only the real owner of that specific
-- business (businesses.owner_id) may insert membership rows.
--
-- WHY THIS DOES NOT BREAK BUSINESS CREATION
-- -----------------------------------------
-- The founding owner row is not written by the client — it is written by the
-- AFTER INSERT trigger `trg_add_owner_as_member` on public.businesses, whose
-- function `public.add_owner_as_member()` is SECURITY DEFINER owned by
-- `postgres`. Verified against the live catalog:
--   • add_owner_as_member.prosecdef = true, proowner = postgres
--   • postgres.rolbypassrls = true
--   • business_members.relowner = postgres, relforcerowsecurity = false
-- Either fact alone exempts that INSERT from RLS (owner-of-table without
-- FORCE RLS, and BYPASSRLS), so the trigger is unaffected by this policy.
-- Both client business-creation paths (src/pages/Signup.tsx and
-- src/components/business/BusinessNoAccountState.tsx) insert only into
-- `businesses` and rely on that trigger; a repo-wide grep found no code path
-- — client, edge function, or script — that inserts a role='owner' row into
-- business_members directly.
--
-- No legitimate flow regresses: every client INSERT into business_members
-- (BusinessTeam invite, BulkInviteDialog) sends role='member', which only
-- ever satisfied the is_business_owner clause anyway.
--
-- Replay-safe: public.business_members and public.is_business_owner are both
-- created by 20260425233224, which sorts earlier, so both objects always
-- exist by the time this file runs in a from-scratch rebuild. `TO
-- authenticated` and the (select auth.uid()) wrapper match what
-- 20260505235500 / 20260505235000 already left on this policy in production,
-- so this is a semantic change only — no role or initplan regression.

DROP POLICY IF EXISTS "Owner can invite members" ON public.business_members;

CREATE POLICY "Owner can invite members"
ON public.business_members FOR INSERT
TO authenticated
WITH CHECK ( public.is_business_owner(business_id, (select auth.uid())) );

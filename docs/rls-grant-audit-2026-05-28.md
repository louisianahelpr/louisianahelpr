# RLS / grant audit — 2026-05-28

Triggered by the two `has_role` / `is_business_member` / `mask_job_location`
regressions that landed today (PR #355 + PR #358). Root cause both times:
the originating `CREATE FUNCTION` migration never wrote an explicit
`GRANT EXECUTE … TO authenticated`, so the function relied on the default
PUBLIC `EXECUTE`. Something later — almost certainly a Supabase advisor
pass against "Function is overly permissive" — stripped that PUBLIC grant
in the production DB. Migrations replay fine on a fresh rebuild (default
grant intact); only production diverges, so the regression is invisible
until a user hits a 42501.

This audit finds every other function in the same trap before it surfaces
as a user-facing error.

## Summary

- **113 functions inspected** (unique signatures across all migrations;
  45 of those are pure trigger functions reached only via row-changes,
  intentionally locked down by `20260505190000_security_revoke_internal_function_execute.sql`).
- **4 functions invoked from an RLS `USING` / `WITH CHECK` clause or a
  view's projection** — `has_role`, `is_business_member`, `is_business_owner`,
  `mask_job_location`. All four are already covered by today's PR #355 +
  PR #358 grants. **Zero remaining RLS-invoked functions lack a grant.**
- **84 functions lack an explicit `GRANT EXECUTE`** overall; most are
  trigger-only or only called from the service-role context (cron, edge
  functions, internal `SECURITY DEFINER` callers) and don't need one.
- **12 PostgREST-callable RPCs invoked directly from React client code
  lack an explicit grant.** These are the remaining at-risk surface — any
  one of them can hit the same advisor-stripped-default regression that
  PR #355 / PR #358 fixed. Production currently works only because PUBLIC
  EXECUTE has not yet been stripped from them. Listed in priority order
  below.

Numbers at a glance: **113 inspected · 4 RLS-invoked · 12 client-RPC
latent risks (all currently relying on default PUBLIC EXECUTE).**

## Methodology

1. Parsed every `.sql` in `supabase/migrations/` for `CREATE [OR REPLACE]
   FUNCTION public.<name>(<args>)`. Tracked the first definition
   (file:line of CREATE) and every redefinition.
2. Parsed every `GRANT EXECUTE ON FUNCTION public.<name>(...) TO <role>`
   in the same set. A function is "granted" if any migration (the original
   or a later one) issues an explicit grant — exact-signature or
   loose-by-name.
3. Extracted every `CREATE POLICY` body (USING + WITH CHECK clauses) and
   every `CREATE [OR REPLACE] VIEW` body. For each function name, checked
   whether a policy or view body calls it.
4. Grep'd `src/**` for `supabase.rpc("<name>")` to get the client-RPC
   surface, and `supabase.from("<table>")` to identify which RLS-protected
   tables the client touches.
5. Cross-referenced: a function is at-risk if it is reachable via RLS, a
   non-`SECURITY DEFINER` view, or a direct PostgREST RPC AND lacks an
   explicit `GRANT EXECUTE`.

Pure trigger functions (returning `trigger`/`event_trigger` and only used
by `CREATE TRIGGER … EXECUTE FUNCTION fn()`) were excluded — they fire on
row-changes without needing `EXECUTE` on the function itself, and the
74-function lockdown in `20260505190000_security_revoke_internal_function_execute.sql`
is intentional and correct.

## Latent regression risks (priority order)

### high — `public.get_safe_profiles(uuid[])`

- File:line of CREATE — `supabase/migrations/20260312230949_0e4c3b84-fbdc-4c6c-9917-572203730f25.sql:29`
  (redefined at `20260323033605_3d3cf380-f700-44af-b9cf-d3d5d1f13c15.sql`,
  `20260418060713`, `20260420213658`, `20260420233706`).
- Invoked from RLS / views — none.
- Client paths — **15 call sites**, includes:
  - `src/components/profile/PublicReviewWall.tsx:240` (every profile view
    of a helper with reviews)
  - `src/components/ReviewPanel.tsx:418` (every job-completion review
    surface)
  - `src/components/messaging/*` (message thread author hydration)
  - several other read paths that hydrate reviewer/author names + avatars.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO authenticated;
  ```
- Severity rationale — **high**. If PUBLIC EXECUTE is stripped, every
  signed-in user opening a helper profile, a review panel, or a message
  thread hits 42501. This is the broadest user-facing reach of any of the
  12 — and on top of that, `PublicReviewWall` is reachable from the
  marketing / pre-signup landing helper-detail page, so the failure mode
  extends past the authenticated UI into the public conversion funnel.

### high — `public.are_users_blocked(uuid, uuid)`

- File:line of CREATE — `supabase/migrations/20260418053532_0929a432-481c-4ba7-a2e8-37532ea31c1b.sql:38`.
- Invoked from RLS / views — none.
- Client paths — `src/lib/userBlocks.ts:29` (called from messaging /
  application flows to suppress interactions between blocked users).
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated;
  ```
- Severity rationale — **high**. The current implementation in
  `areUsersBlocked()` swallows the error and returns `false`, so a 42501
  would silently let a previously-blocked user message / apply through
  again. That is a security regression in the safety surface, not just a
  UI error — strictly worse than a visible 42501.

### medium — `public.get_parish_for_zip(text)`

- File:line of CREATE — `supabase/migrations/20260418042714_4ba9bea1-f204-429a-bda3-b6edd663f3c5.sql:35`.
- Client paths — `src/lib/parishLookup.ts:15`, called from
  `ProfileEditForm` when a user types a ZIP. Only post-auth.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_parish_for_zip(text) TO authenticated;
  ```
- Severity rationale — **medium**. Profile-edit ZIP→parish autofill
  breaks; user can still save but with a wrong/missing parish, which
  feeds the parish-targeted notifications.

### medium — `public.get_parish_activity(integer)`

- File:line of CREATE — `supabase/migrations/20260418193437_ee450c91-91b1-4cbd-b396-c859808ee7df.sql:2`.
- Client paths — `src/hooks/useHelprActivity.ts:57` (post-job
  CheckoutStep, shows "N helpers active in your parish") and
  `src/components/admin/AdminParishActivity.tsx:21`.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_parish_activity(integer) TO authenticated;
  ```
- Severity rationale — **medium**. The hook degrades silently on RPC
  failure (`setActivity(null)`), so a 42501 hides the social-proof
  signal on the post-job checkout — soft conversion impact, not a hard
  break.

### medium — `public.get_my_business_verification()`

- File:line of CREATE — `supabase/migrations/20260425235407_ea778f7d-6a47-46ee-adf8-6cb423ecf7b1.sql:151`.
- Client paths — `src/components/business/BusinessVerificationCard.tsx:48`
  (the verification-status card on the business profile).
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_my_business_verification() TO authenticated;
  ```
- Severity rationale — **medium**. Only business-account holders are
  exposed; non-business users never load the surface.

### medium — `public.get_pending_invite_for_email(text)`

- File:line of CREATE — `supabase/migrations/20260425233224_ddac4ad3-1b57-4894-8e61-01a1f99be4b8.sql:95`.
- Client paths — `src/pages/Signup.tsx:390` (post-account-creation,
  auto-accept any pending business invite for the new user's email).
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_pending_invite_for_email(text) TO authenticated;
  ```
- Severity rationale — **medium**. Called once per signup. Failure
  silently drops the invite-auto-accept; the team owner has to manually
  re-invite. Inconvenient, not a hard break.

### medium — `public.process_referral(text, uuid)`

- File:line of CREATE — `supabase/migrations/20260311021613_6dcd83c0-fafb-4eb6-8627-5f5f08f57359.sql:57`
  (redefined at `20260311032939_575fe549-a5df-4d7c-8485-19756c30a84b.sql:43`).
- Client paths — `src/pages/Signup.tsx:371`, called when the user
  provided a referral code at signup. Authenticated by then.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid) TO authenticated;
  ```
- Severity rationale — **medium**. Call is wrapped in `try/catch` and
  the failure is `report()`'d to Sentry, but the referral credit is
  silently lost — direct $ impact to the referrer.

### low — `public.get_helper_earnings_export(uuid, date, date)`

- File:line of CREATE — `supabase/migrations/20260418081253_3e1d793f-5d9d-4e88-8471-3da4c3c085d7.sql:92`.
- Client paths — `src/components/EarningsExport.tsx:112` (helper's CSV
  export of own earnings).
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated;
  ```
- Severity rationale — **low**. Only used by a helper exporting their
  own earnings; one user at a time.

### low — `public.get_pending_business_verifications()`

- File:line of CREATE — `supabase/migrations/20260425235407_ea778f7d-6a47-46ee-adf8-6cb423ecf7b1.sql:118`.
- Client paths — `src/components/admin/AdminBusinessVerificationQueue.tsx:55`.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_pending_business_verifications() TO authenticated;
  ```
- Severity rationale — **low**. Admin-only; function body filters with
  `has_role(auth.uid(), 'admin')`. Maps the same risk shape as PR #355
  but the blast radius is just the admin reviewer.

### low — `public.get_pending_credentials()`

- File:line of CREATE — `supabase/migrations/20260425234515_5a733d68-8044-40ed-8d63-a8f46fac1d45.sql:196`.
- Client paths — `src/components/admin/AdminCredentialQueue.tsx:45`.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated;
  ```
- Severity rationale — **low**. Admin-only, same shape as above.

### low — `public.review_business_verification(uuid, text, text)`

- File:line of CREATE — `supabase/migrations/20260425235407_ea778f7d-6a47-46ee-adf8-6cb423ecf7b1.sql:65`.
- Client paths — `src/components/admin/AdminBusinessVerificationQueue.tsx:70`.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.review_business_verification(uuid, text, text) TO authenticated;
  ```
- Severity rationale — **low**. Admin-only review-decision RPC. Pair
  with `get_pending_business_verifications` — granting one without the
  other leaves a half-functional queue.

### low — `public.review_credential(uuid, text, text, text)`

- File:line of CREATE — `supabase/migrations/20260425234515_5a733d68-8044-40ed-8d63-a8f46fac1d45.sql:122`.
- Client paths — `src/components/admin/AdminCredentialQueue.tsx:61`.
- Proposed grant:
  ```sql
  GRANT EXECUTE ON FUNCTION public.review_credential(uuid, text, text, text) TO authenticated;
  ```
- Severity rationale — **low**. Admin-only credential-decision RPC.
  Same pairing concern as above with `get_pending_credentials`.

## Bulk fix recommendation

A single follow-up migration. Style mirrors
`supabase/migrations/20260528154945_grant_execute_has_role_to_authenticated.sql`
— every grant guarded by `to_regprocedure(...)` so a from-scratch
rebuild that runs this before the originating CREATE is a harmless skip
rather than an aborting error, and re-runs after the grants are in
place are no-ops. Suggested filename:
`<timestamp>_grant_execute_client_rpcs_audit_2026_05_28.sql`.

Proposed body (do not write this file as part of this PR — sanity-check
first, then land it in a separate PR followed by a manual
`supabase db push`):

```sql
-- Restore explicit EXECUTE on every public.<rpc>(...) called directly
-- from React client code via supabase.rpc("<rpc>"). Same regression shape
-- as PR #355 (has_role) and PR #358 (jobs RLS helpers) — the originating
-- CREATE FUNCTION migrations relied on the default PUBLIC EXECUTE that a
-- Supabase advisor pass later stripped in production. This migration
-- inoculates every remaining client-callable RPC against the same trap.
--
-- All grants are to `authenticated` only — every call site is reached
-- post-auth (Signup.tsx calls happen after the new user is signed in,
-- so the JWT role is already `authenticated`).
--
-- Idempotent and replay-safe: to_regprocedure-guarded so a from-scratch
-- rebuild that runs this before the originating CREATE statements is a
-- harmless skip rather than an aborting error. Re-runs are no-ops.

DO $$
BEGIN
  -- High-reach: every signed-in profile/review/message surface.
  IF to_regprocedure('public.get_safe_profiles(uuid[])') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO authenticated;
  END IF;

  -- High-reach: blocked-user safety check; silent failure = security regression.
  IF to_regprocedure('public.are_users_blocked(uuid, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.are_users_blocked(uuid, uuid) TO authenticated;
  END IF;

  -- Profile-edit ZIP→parish autofill.
  IF to_regprocedure('public.get_parish_for_zip(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_parish_for_zip(text) TO authenticated;
  END IF;

  -- Post-job "helpers active in your parish" social proof.
  IF to_regprocedure('public.get_parish_activity(integer)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_parish_activity(integer) TO authenticated;
  END IF;

  -- Business profile verification-status card.
  IF to_regprocedure('public.get_my_business_verification()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_my_business_verification() TO authenticated;
  END IF;

  -- Signup: auto-accept pending business invite for the new user's email.
  IF to_regprocedure('public.get_pending_invite_for_email(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_invite_for_email(text) TO authenticated;
  END IF;

  -- Signup: apply a referral code.
  IF to_regprocedure('public.process_referral(text, uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid) TO authenticated;
  END IF;

  -- Helper-only: CSV earnings export.
  IF to_regprocedure('public.get_helper_earnings_export(uuid, date, date)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated;
  END IF;

  -- Admin review queues — body already gates on has_role(auth.uid(),'admin').
  IF to_regprocedure('public.get_pending_business_verifications()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_business_verifications() TO authenticated;
  END IF;

  IF to_regprocedure('public.get_pending_credentials()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated;
  END IF;

  IF to_regprocedure('public.review_business_verification(uuid, text, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.review_business_verification(uuid, text, text) TO authenticated;
  END IF;

  IF to_regprocedure('public.review_credential(uuid, text, text, text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.review_credential(uuid, text, text, text) TO authenticated;
  END IF;
END $$;
```

## Notes for the human reviewer

- **Why not also `anon`?** Every client call site for these 12 RPCs runs
  post-auth, even the signup-flow ones (Signup.tsx calls `process_referral`
  and `get_pending_invite_for_email` *after* the new account is created,
  so the JWT role is `authenticated`). Granting to `anon` would widen the
  exposure surface without unlocking a real call site. If a future
  marketing surface starts calling one of these unauthenticated, that's a
  separate decision.
- **Why not 4 sibling migrations grouped by reach?** One bulk migration
  keeps the audit trail in one place — the same way PR #358 grouped the
  three jobs-RLS helpers. The DO block also keeps the grants atomic if
  any single one fails.
- **Production push order.** Land the migration on `main`, then run
  `supabase db push` against production. Until that push, production
  remains in its current state — same as today.
- **What this audit does NOT cover.** Functions reached only from edge
  functions / cron / `service_role` are out of scope — those don't go
  through PostgREST and aren't subject to the advisor-strip regression.
  Storage bucket policies and `auth.*` schema grants are also out of
  scope; this is a `public.*` function audit only.
- **Defense-in-depth follow-up.** Worth considering, but separate from
  this PR: a Supabase Preview check that fails the migration if any new
  `CREATE FUNCTION public.<name>(...)` doesn't either grant or revoke
  explicitly. That converts the trap into a build-time error and
  prevents PR #355 / PR #358 / this audit from being needed in the
  future. Sketch:
  ```sh
  # In CI, after `supabase db push --dry-run`:
  # SELECT proname FROM pg_proc p
  # JOIN pg_namespace n ON n.oid = p.pronamespace
  # WHERE n.nspname = 'public'
  #   AND NOT EXISTS (
  #     SELECT 1 FROM information_schema.role_routine_grants
  #     WHERE specific_schema = 'public'
  #       AND specific_name LIKE proname || '%'
  #       AND grantee IN ('authenticated','anon','PUBLIC')
  #   );
  ```
  Any row in that result is an unguarded function and should red the
  build.

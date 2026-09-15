-- Remove excess `anon` (and PUBLIC) privileges that only RLS was standing in
-- front of. Two holes from the 2026-09-15 authz hole hunt, both defense-in-
-- depth, both the same shape as the open_jobs_browse CRITICAL closed hours
-- earlier (an excess grant on a high-value relation, held shut by one policy
-- whose evaluation order is load-bearing):
--
--   * H-004 — anon holds UPDATE, INSERT, REFERENCES, DELETE on public.jobs
--     (read from live prod 2026-09-14; note the ABSENT SELECT). The jobs lock
--     triggers all open with `IF auth.uid() IS NULL … RETURN NEW`, so for an
--     anonymous writer the whole lock ladder is a no-op and RLS is the only
--     gate. Not exploitable today (the INSERT policy also fails on
--     `auth.uid() = customer_id`, and the DELETE policy is TO authenticated),
--     but one future `GRANT EXECUTE … TO anon` or one permissive policy wide.
--     anon browses through the open_jobs_browse VIEW, never base jobs, so anon
--     needs ZERO privileges here.
--
--   * AUTHZ-02 — anon (and PUBLIC) hold table-level SELECT on admin / money /
--     trust tables that have no legitimate anon read path (admin-only,
--     service-only or self-only). RLS returns 0 rows to anon today, so nothing
--     leaks — but the privilege is the second line of defence, and a single
--     `USING (true)` or a security_invoker=false view over one of them turns it
--     into full anonymous exposure of moderation, fraud, payout and login data.
--
-- WHY REVOKE ALL (not an enumerated list) on jobs: `REVOKE ALL` names no
-- version-specific privilege keyword. The 2026-09-15 open_jobs_browse fix wrote
-- `REVOKE … MAINTAIN` (PG17+) and the PG15 db-deploy replay gate refused it, so
-- a CRITICAL fix silently did not deploy (src/test/migrationPrivilegeKeywords
-- .test.ts guards that keyword class now). REVOKE ALL sidesteps the trap and is
-- future-proof against any privilege prod's default privileges hand out.
--
-- authenticated is UNTOUCHED: it holds its own explicit grants
-- (`GRANT SELECT, INSERT, REFERENCES, DELETE, UPDATE ON public.jobs TO
-- authenticated`; explicit SELECT on each sensitive table), and revoking from
-- anon / PUBLIC never removes another role's explicit grant. service_role and
-- SECURITY DEFINER functions run as postgres and bypass both layers, so every
-- edge function and RPC keeps working. This is grants only — the jobs
-- state/dispute triggers are owned by another branch and not touched here.
--
-- Verify by object state, not by this migration landing: after deploy,
-- has_table_privilege('anon', 'public.jobs', 'INSERT') must be false, and
-- has_table_privilege('anon', 'public.<sensitive>', 'SELECT') false for each
-- table below; guest browse via open_jobs_browse must still return rows. The
-- live catalog check scripts/check-anon-table-grants.mjs enforces the whole
-- class going forward (default privileges re-open the grant on any CREATE
-- TABLE / recreation, so a one-off REVOKE cannot replace the check).
--
-- REPLAY-SAFE: every REVOKE is guarded behind to_regclass, so a from-scratch
-- rebuild that has not yet created a table simply skips it; REVOKE of a
-- privilege a role does not hold is a no-op, so re-running is harmless.

-- ── 1. public.jobs — strip every anon / PUBLIC privilege (H-004) ─────────────
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    REVOKE ALL ON public.jobs FROM anon;
    REVOKE ALL ON public.jobs FROM PUBLIC;
  END IF;
END $$;

-- ── 2. Admin / money / trust tables — strip ALL anon / PUBLIC privileges ─────
-- (AUTHZ-02, plus the write half.) Each was proven on prod 2026-09-15 to return
-- HTTP 200 (privilege present, RLS filtered to 0 rows) to an anon GET, and has
-- NO signed-out read path in src/ (admin screens, self-scoped hooks, or
-- service-role RPCs only). None takes an anon WRITE either — the inserts that
-- exist (reports, login_history, push_tokens, tips, referrals) all require a
-- session — so REVOKE ALL is behaviour-preserving and closes the write door
-- too (prod's default privileges hand anon arwdxm on every table). Guest-facing
-- reads go through open_jobs_browse and get_safe_profiles, neither listed here.
-- `FROM anon` is named explicitly because `FROM PUBLIC` alone leaves Supabase's
-- explicit `anon=r` grant (house rule). authenticated keeps its explicit grants.
DO $$
DECLARE
  t text;
  -- Source-derived: no anon read AND no anon write path.
  tables text[] := ARRAY[
    'admin_audit_log',      -- admin: AdminAuditLog.tsx / adminAudit.ts (admin insert)
    'fraud_flags',          -- admin: AdminFraudDashboard / adminHealth
    'user_bans',            -- admin + AccountBanned.tsx (enabled on user?.id; anon -> /login)
    'payout_transfers',     -- money: admin + self earnings/payment tabs (authed)
    'instant_payouts',      -- money: service_role only; no src .from() at all
    'reports',              -- trust: admin reads; inserts require a session
    'login_history',        -- admin + self SecurityTab; insert after login
    'helper_verifications', -- admin: UserVerificationHistory
    'gift_cards',           -- money: redeemed via RPC; no src .from() at all
    'referral_codes',       -- admin + self (.eq user_id); signup passes code to an RPC
    'tips',                 -- money: admin + self-scoped hooks
    'push_tokens'           -- admin counts + self upsert/delete (after login)
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    END IF;
  END LOOP;
END $$;

-- ── 3. Telemetry tables — strip anon SELECT/UPDATE/DELETE, KEEP anon INSERT ──
-- analytics_events and error_logs are the two exceptions: the signed-out app
-- legitimately writes them (src/lib/analytics.ts, src/lib/errorLogger.ts, both
-- fire before login), backed by a permissive INSERT policy
-- (`anyone_can_insert_analytics` / `anyone_can_insert_errors`). So anon keeps
-- INSERT and only INSERT; SELECT is admin-only (`admins_can_read_*`) and
-- UPDATE/DELETE have no anon path at all. Revoking those three closes the read
-- door (AUTHZ-02) and the policy-less write door without touching the telemetry
-- pipeline. REFERENCES/TRUNCATE are not client-reachable via PostgREST and are
-- left as-is.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['analytics_events', 'error_logs'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT, UPDATE, DELETE ON public.%I FROM anon', t);
      EXECUTE format('REVOKE SELECT, UPDATE, DELETE ON public.%I FROM PUBLIC', t);
    END IF;
  END LOOP;
END $$;

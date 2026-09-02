# lh-admin-moderation — lane report

Agent: `lh-admin-moderation` (teammate `lane-admin`)
Worktree: `~/.lh-audit/admin` @ `origin/main` (b170609a)
Live target: prod `fncmgoasalhdgfwzhsqa` — ref confirmed by `supabase secrets list --project-ref fncmgoasalhdgfwzhsqa`, not the staging ref in `supabase/.temp/project-ref`
Date: 2026-09-02

## What I fixed

**Nothing.** I ran the whole sweep in `permissionMode: plan`; the harness blocks
edits to `src/`, `supabase/` and `ios/`, and the orchestrator has not released
this lane into the FIX phase. Seven findings are filed with reproductions; the
proposed fixes are in "Proposed fixes, held" below and are ready to submit as a
plan the moment `VERDICT.md` lands.

One thing I *did* change, and it is not a fix: I created and then deleted a
throwaway prod test account, and cleaned up the two rows its deletion left
behind. Prod is left exactly as I found it — see "Prod side effects" at the end.

## Headline

The admin console is the most defensively-written surface I have read in this
codebase, and most of my starting hypotheses were wrong. **Every admin RPC and
every admin edge function correctly refuses a non-admin token — proven by
execution — 16 HTTP statuses in `~/.lh-audit/admin-authz-probe.txt`, not by
reading** (§1 below). The interesting failures are not authorization; they are the paths where an admin is *supposed* to be told
something and is not.

- 7 findings: 1 HIGH, 3 MEDIUM, 3 LOW. No launch blockers.
- 4 leads retracted before filing, three of them from my own brief.
- 2 corrections the rest of the fleet needs (§5).

## 1. Verified working — every admin endpoint is server-authorized

**This is the claim my brief said was unauditable, and it is now a fact.**

The stated blocker was that `prevent_admin_role_self_grant()` makes admin
self-provisioning impossible, so nobody could audit the admin surface. That is
true — and irrelevant to this question. Proving an endpoint *refuses* a
non-admin needs a non-admin token, not an admin one.

I created a throwaway account (`helpr-audit-adminlane@mailinator.com`), minted a
real JWT for it, and called every admin RPC and edge function with it. Every
target id was the sentinel `00000000-0000-4000-8000-000000000000`, so a check
that failed open would have landed on "not found" rather than damage.

Probe `scratchpad/lane-admin-authz-probe.mjs`, output `~/.lh-audit/admin-authz-probe.txt`, verbatim:

```
=== ADMIN RPCs CALLED WITH A NON-ADMIN JWT ===
200  admin_support_queue                        []
400  admin_delete_review                        {"code":"P0001","message":"admin only"}
400  rpc_decide_dispute                         {"code":"P0001","message":"admin only"}
400  review_credential                          {"code":"P0001","message":"Only admins may review credentials"}
403  check_dispute_velocity                     {"code":"42501","message":"permission denied for function"}
403  settle_dispute_record                      {"code":"42501","message":"permission denied for function"}
403  apply_job_denial_consequence               {"code":"42501","message":"permission denied for function"}
400  apply_cancellation_violation_consequence   {"code":"P0001","message":"job_not_found"}
403  is_helper_shadowbanned                     {"code":"42501","message":"permission denied for function"}
403  sweep_expired_auto_bans                    {"code":"42501","message":"permission denied for function"}

=== ADMIN EDGE FUNCTIONS CALLED WITH A NON-ADMIN JWT ===
403  admin-user-actions          {"error":"Forbidden"}
403  admin-delete-user           {"error":"Forbidden: admin only"}
403  admin-update-email          {"error":"Forbidden"}
403  admin-resend-verification   {"error":"Forbidden"}
403  admin-test-push             {"error":"Forbidden"}
401  execute-dispute-split       {"error":"admin role required"}

=== RLS TABLE READS AS A NON-ADMIN ===
200  admin_audit_log []   200  user_bans []   200  user_strikes []
200  user_violations [own rows only]          200  helper_shadowbans []
200  disputes []          200  payment_refunds []   200  reports []
200  verification_exceptions []
```

Three notes on reading that table:

- `admin_support_queue` returning `200 []` (probe line 2) is correct and deliberate — the
  function embeds `AND public.has_role(auth.uid(),'admin')` in its WHERE clause
  so a non-admin gets no rows rather than an error.
- `apply_cancellation_violation_consequence` returning `job_not_found` is
  correct — it is a *user*-facing RPC that authorizes on job ownership, not an
  admin one. My brief listed it under the admin consequence ladder; that was a
  miscategorisation.
- The `403 permission denied` set is a second, independent layer: those four
  functions are not `GRANT EXECUTE`d to `authenticated` at all, so PostgREST
  refuses before any function body runs. Defence in depth, verified against prod
  `information_schema.routine_privileges` — grants are `postgres, service_role` only.

`admin_audit_log` RLS is also correct and stronger than I expected: INSERT and
SELECT both require `has_role(auth.uid(),'admin')`, and there is **no UPDATE and
no DELETE policy at all**, so the log is append-only to every non-owner role.

## 2. Findings

| id | sev | one line |
|---|---|---|
| AM-001 | HIGH | A past-deadline dispute the auto-resolver cannot settle is silently abandoned with escrow held — no admin reminder, no defect record, no queue surfacing |
| AM-002 | MEDIUM | Chargeback evidence is never collected or submitted; the evidence due-date is stored nowhere and there is no chargeback surface in `/admin` |
| AM-003 | MEDIUM | Moderation records survive account deletion carrying the user's verbatim message text; `purge_user_data()` covers 27 tables but none of the four ladder tables |
| AM-006 | MEDIUM | `auto_restrict_repeat_violators()` swallows every error — a suspension that fails to apply leaves the violator active with no trace |
| AM-004 | LOW | `/admin?view=audit` is 44% non-admin noise (89 of 202 rows are signup role grants) |
| AM-005 | LOW | A removed feature (`broadcasts`) still has a live admin view, and it holds the console's only unguarded zero-row delete |
| AM-007 | LOW | `enforce_audit_log_self_attribution()` is a no-op on the service-role path — every admin edge function's audit write bypasses it |

### AM-001 is the one worth acting on

`auto-resolve-disputes/index.ts` handles three outcomes for a dispute past its
72h deadline. Two of them notify an admin. One does not:

- `escalated` → `remindAdmins(...)` at `:250`. ✅
- a split stuck mid-execution → `remindAdmins(...)` at `:512`. ✅
- **no payment intent (`:279`) or PI not `succeeded` (`:284`) → bare
  `console.error` + `continue`.** No `remindAdmins`, no `defects.record`.

And the comment at `:535` says:

> `"No payment intent" and "PI not succeeded" are deliberately NOT defects — both leave the dispute for an admin, which is the designed behaviour.`

Nothing tells the admin. The dispute keeps `jobs.status='disputed'` and
`payment_status='escrow'` forever; both parties see a frozen job; the only
record is a `console.error` in edge logs nobody queries. This is the standard's
"a comment asserting an invariant the code contradicts" pattern.

The branch is demonstrably live. Two prod jobs sit in exactly this state,
10–11 days past their deadlines, and `cron.job_run_details` shows the cron
(`21 */6 * * *`, active) succeeding four times a day throughout — so the
`continue` at `:279` has fired on them roughly forty times with no signal.

**Both instances are `is_seed=true` with a NULL payment intent, so no real money
is frozen today.** I say that explicitly because the same query without that
check reads like a launch blocker and is not one. The defect is the branch, not
these two rows.

## 3. Retracted before filing — four leads that did not survive contact

Recorded in full because the protocol asks for it and because three came from
my own brief.

1. **"`approve_pending_job` / `reject_pending_job` are in scope."** They do not
   exist in prod. `pg_proc` has no function by either name. Neither does
   `review_business_verification` (consistent with the B2B removal in §6d).
2. **"Account approval, denial and bans write no audit row."** I built this off
   a prod census: 37 approved profiles, zero `approve_user` rows in
   `admin_audit_log`. It looked airtight. It is wrong — `complete-signup`
   auto-approves at signup (`index.ts:470`), so those 37 never went through the
   admin queue. The admin paths *do* log, via `logAdminAction()` in
   `src/lib/adminAudit.ts`: `approve_user`, `deny_user`, `ban_user`,
   `impersonate_user_start`, `payout_*` and 15 more call sites. Zero rows means
   never exercised, not never logged.
3. **"`settle_dispute_record` and `apply_job_denial_consequence` have no
   authorization check, so any authenticated user can forge a dispute
   attribution or inflict a reliability strike on a stranger."** The function
   bodies genuinely have no `has_role` check — but neither is granted to
   `authenticated`. `information_schema.routine_privileges` shows
   `postgres, service_role` only, and the live probe returns
   `42501 permission denied`. Reachability, not the function body, was the
   thing to check.
4. **"The report and dispute queues have no SLA or aging."** Both do.
   `AdminReports.tsx:65` defines `SLA_BREACH_HOURS = 24`, sorts the pending
   queue oldest-first so breaches surface at the top, renders an "Nd overdue"
   badge, and records `sla_breached` in the resolution audit details.
   `AdminDisputes.tsx` buckets by age with a 48h stale / 120h chargeback
   priority sort and an explicit age filter.

   Related, and also retracted: prod has 4 pending reports, two of them 71 days
   old. Every one is a test filing by the owner's own account with gibberish
   description text (`"fghjkl.kkmmn"`, `"Ghihjkhnjhnj"`) against seed users. It
   is not a neglected real-user queue.

## 4. Proposed fixes, held pending the FIX phase

- **AM-001** — in `auto-resolve-disputes/index.ts`, replace the two bare
  `continue`s with a `remindAdmins(...)` call reusing the dedupe machinery
  already in the file (one reminder per admin per link per window), linking to
  `/admin?view=disputes&job=<id>`, and add `defects.record(...)` so the run's
  own result reports it. Delete or correct the `:535` comment. Money-adjacent →
  must go through `lh-money-escrow` + `lh-silent-failure` REVIEW-ONLY first.
- **AM-006** — add `PERFORM public.log_cron_defect(...)` to the exception
  handler, matching `sweep_expired_auto_bans`. Migration via
  `npm run migration:new`, replay-safe, proven with 3 consecutive PGlite
  applies. Data-model adjacent → `lh-authz-rls` REVIEW-ONLY.
- **AM-002** — persist `dispute.evidence_details.due_by` on the job (or a
  `chargebacks` row) so a deadline can be queried and reminded on; check the
  three admin notification inserts and surface a failure; decide whether a
  chargeback queue belongs in `/admin`. The evidence-submission question is a
  product call for the owner, not a lane decision.
- **AM-003** — extend `purge_user_data()` with the same keep-the-row-drop-the-
  identity treatment already applied to `reports` and `legal_acceptances`, and
  strip the quoted message text from `user_violations.description`. **Overlaps
  `lane-account-lifecycle` — relayed to the orchestrator rather than claimed.**
- **AM-005** (`src/components/admin/AdminBroadcasts.tsx:165`) — removal work owned by `lh-schema-integrity` (table) and the
  orchestrator (the `Admin.tsx` view entry). Not mine to edit.
- **AM-004, AM-007** — documentation/severity corrections, no code change
  proposed.

## 5. Two corrections the fleet needs

**Slack ops alerting is NOT dead — there are two Slack paths and only one is
down.** My brief said "SLACK_API_KEY is unset, so slack-ops-alert discards
everything including DISPUTE PAGING." Half right, and the half that is wrong
matters:

- `_shared/slack-alerts.ts` → `postSlackOpsAlert()` prefers **`SLACK_WEBHOOK_URL`**
  and only falls back to the Lovable gateway. `SLACK_WEBHOOK_URL` **is set in
  prod** (`supabase secrets list --project-ref fncmgoasalhdgfwzhsqa`, updated
  2026-08-19). This is the path used by all 20 importers, including every
  `stripe-webhook` handler — chargebacks, payout failures, transfer reversals,
  subscription events. **ALIVE.**
- The `slack-ops-alert` **edge function** posts to `https://slack.com/api` and
  reads `SLACK_API_KEY`, which is **not** set. This is the path the ~17 SQL cron
  watchers `net.http_post` to. **DEAD.**

So AM-002's chargeback alert does reach Slack. The SQL watchers do not.

**The admin surface is 24 views, not 9 and not 30.** `SURFACE.md` says 24 and it
is right; my brief said "9 `?view=` variants" and the blocker note said 30 — source `src/pages/Admin.tsx:63-75`.
`VIEW_LABELS` in `src/pages/Admin.tsx:63-75` is the authoritative list and is
self-maintaining — `isRealView()` derives from it, so a stale deep link to a
deleted view (`parishtax`, `geography`) coerces to home rather than
half-rendering.

## 6. Coverage

**Enumerated before grading.** All 24 admin views from `VIEW_LABELS`: home,
analytics, people, jobs, settings, disputes, broadcasts, notifications,
notiflogs, reports, support, referrals, subscriptions, fraud, audit, health,
export, payouts, tiers, marketing, idvreview, credentials, exceptions,
banreview.

| surface | how covered |
|---|---|
| 5 admin edge functions + `execute-dispute-split` | live non-admin probe (§1) + full source read of each auth path |
| 13 admin/moderation RPCs | live non-admin probe + `pg_get_functiondef` from prod for each |
| `admin_audit_log` | prod schema, RLS policies, both triggers, full action census, 27 client call sites |
| Approval / job / credential / exception queues | prod row counts + ages; SLA and aging logic read in source |
| Dispute resolution end to end | `rpc_decide_dispute`, `settle_dispute_record`, `auto-resolve-disputes`, `execute-dispute-split` auth path; live state of both open prod disputes; cron run history |
| Chargebacks | both `charge.dispute.*` handlers read in full; `payment_refunds` schema + RLS + prod count (0) |
| Bans / strikes / ladder | `auto_restrict_repeat_violators`, `sweep_expired_auto_bans`, all three `apply_*_consequence`, `apply_consequence_ladder` grants, prod ban/shadowban counts, cron history |
| Zero-row writes | all 41 `.update`/`.delete`/`.upsert`/`.rpc` call sites under `src/components/admin/**` + `Admin.tsx`, delegated sweep, line-cited |
| Account-deletion residue | reproduced live end to end |

### UNVERIFIED — could not reach

1. **The 24 admin views were never RENDERED.** No screenshots, no measured
   layout, no interactive verification of a single admin control. Reason:
   `prevent_admin_role_self_grant()` admits `admin` role writes only from
   `service_role`, and granting myself the role in prod is outside this lane's
   standing constraints ("TEST ACCOUNTS ONLY", and elevating a test row to admin
   in the live project is a decision for the owner, not for me).
   **What I need to finish it:** either (a) the owner grants `admin` to one
   clearly-marked test account for the duration of the audit, or (b) approval to
   `INSERT INTO user_roles (user_id, role) VALUES ('<test uuid>','admin')` in
   prod via the service-role key I already hold locally, which the trigger does
   permit. Either unblocks the whole visual and interactive half of this lane in
   one step. `lh-route-walker` was blocked on exactly this, so the two lanes
   unblock together.
2. **No dispute was driven end to end in test mode.** Standing constraint: no
   live Stripe. There is no test-mode escrow fixture I could reach without
   creating one, and creating one needs the money lane's fixtures. So
   "does the split execute for the exact amounts decided, does escrow move once
   and only once" is answered from source and from the idempotency guards
   (`WHERE status='open'`, `execution_status='executed'` as terminal), **not by
   execution.** I did not find a double-settle path; I also did not prove there
   isn't one.
3. **`admin-test-push` delivery.** Refusal to a non-admin is proven; actual push
   delivery needs a device.
4. **`?tab=warnings`** (co-owned with `lh-trust-safety`) — the server-side
   ladder behind it is covered; the rendered tab is not, same reason as (1).

## 7. Out-of-scope conclusions (PROTOCOL §6)

- **Certificate pinning / RASP** — not assessed here; belongs to
  `lh-build-release`. Nothing in the admin surface changes that calculus.
- **Role-gating** — correctly not applicable. There is no role system for
  posters vs helpers. `admin` is a genuine privilege boundary and is the thing I
  tested, which is the per-record authorization §6 points at, not "role bleed".
- **B2B admin views** — `business_verify` and `business_accounts` appear in my
  brief and in older docs. They are **not** in `VIEW_LABELS`; the B2B tier is
  removed per §6d and its admin views are already gone. No finding.

## Prod side effects — full disclosure

I created auth user `889f903f-5233-4a44-ab33-6fa54ce08941`
(`helpr-audit-adminlane@mailinator.com`) for the authorization probe.

One probe call — `apply_message_violation_consequence`, a user-facing RPC, not
an admin one — wrote a real `user_violations` row against that test account and
sent it one notification. That was the ladder behaving exactly as designed
(rung 1 = notify, no status change; `ban_status` stayed `active`), and it is
where AM-003 came from.

I then deleted the account, found that the violation and notification rows
survived (AM-003), and deleted both. Final state, from prod `execute_sql`:

```
auth_user 0 · profile 0 · user_roles 0 · user_violations 0 · notifications 0
orphan_user_violations 0 · orphan_user_strikes 0 · orphan_user_bans 0
orphan_helper_shadowbans 0 · orphan_notifications 0
```

No other prod row was written. No Stripe call of any kind was made.

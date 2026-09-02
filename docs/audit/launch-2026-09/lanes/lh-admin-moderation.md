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
target id was the sentinel `00000000-0000-4000-8000-000000000000` — **which
bounds the blast radius only for the functions that take an id, and I wrongly
claimed it bounded all of them; see §1a before reusing this probe.**

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

- `admin_support_queue` returning `200 []` (probe line 2) is **not a pass** — I
  first read it as "correct and deliberate", because the function does embed
  `AND public.has_role(auth.uid(),'admin')` in its WHERE clause so a non-admin
  gets no rows rather than an error. But prod holds zero `reported_type='support'`
  rows, so an admin would see `[]` too and the test distinguishes nothing.
  Corrected below and filed as AM-010.
- `apply_cancellation_violation_consequence` returning `job_not_found` is
  correct — it is a *user*-facing RPC that authorizes on job ownership, not an
  admin one. My brief listed it under the admin consequence ladder; that was a
  miscategorisation.
- The `403 permission denied` set is a second, independent layer: those four
  functions are not `GRANT EXECUTE`d to `authenticated` at all, so PostgREST
  refuses before any function body runs. Defence in depth, verified against prod
  `information_schema.routine_privileges` — grants are `postgres, service_role` only.

**The table reads needed a second step to mean anything, and the orchestrator
supplied it.** All ten returned `200 []`, which alone is ambiguous — RLS working,
or an empty table. Row counts as `service_role` settle it:

| table | rows | non-admin saw |
|---|---|---|
| `admin_audit_log` | 202 | `[]` — RLS enforcing |
| `user_violations` | 13 | its **own 1 row** — RLS *scoping*, not blocking |
| `reports` | 5 | `[]` — RLS enforcing |
| `user_strikes` | 3 | `[]` — RLS enforcing |
| `disputes` | 2 | `[]` — RLS enforcing |
| `user_bans` | 1 | `[]` — RLS enforcing |
| `helper_credentials`, `helper_shadowbans`, `payment_refunds`, `verification_exceptions` | **0** | `[]` — **UNTESTED, not a pass** |

`user_violations` is the strongest cell: the caller saw exactly its own row out
of 13, which proves the policy scopes per-user rather than merely denying. The
four empty tables prove nothing and are recorded as untested.

The same caveat retro-actively demotes one RPC result. **`admin_support_queue`
returning `200 []` is a VACUOUS pass** — prod holds zero rows with
`reported_type='support'`, so an admin would get `[]` too. Its embedded
`AND has_role(auth.uid(),'admin')` is correct by construction but has not been
shown to bite at runtime. Filed as AM-010, correcting my own earlier evidence.

`admin_audit_log` RLS is otherwise correct and stronger than I expected: INSERT
and SELECT both require `has_role(auth.uid(),'admin')`, and there is **no UPDATE
and no DELETE policy at all**, so the log is append-only to every non-owner role.

Two further notes the run surfaced:

- **One probe target mutated.** `apply_message_violation_consequence` returned
  `200 {"action":"warning","prior_count":0}` and wrote a real `user_violations`
  row. It is a *user*-facing RPC and my including it in an "admin endpoints"
  list was a miscategorisation. It cannot be aimed at anyone else — the
  signature is `(p_description text, p_content text)` with no user id and the
  body binds `v_user := auth.uid()` — so the blast radius is the caller only.
  It is also where AM-003 and AM-009 came from.
- **`apply_cancellation_violation_consequence` authorizes AFTER the lookup.** It
  does `SELECT ... FROM jobs WHERE id = p_job_id`, raises `job_not_found` if
  absent, and only then checks `customer_id = auth.uid()`. A real job belonging
  to someone else still returns `not_authorized`, so it is not an authorization
  hole — but the two distinct errors are a job-existence oracle for an arbitrary
  uuid. Noted, not filed: `jobs` ids are not secrets and the browse feed
  enumerates them anyway.

## 1a. A correction to my own probe — I got the safety argument wrong

I told the orchestrator the probe was safe because "every target id in it is the
sentinel UUID, so if an authz check DOES fail open the call lands on 'not found'
and mutates nothing." **That was false for two of the entries, and the
orchestrator caught it before running.**

`sweep_expired_auto_bans` **takes no arguments.** There is no id to make a
sentinel of. It is SECURITY DEFINER and its body does
`UPDATE profiles SET ban_status='active', auto_suspended_until=NULL` for up to
200 rows. Had it been reachable, my "harmless" probe would have **lifted real
suspensions off real accounts.** The blast radius was not "not found" — it was
the entire currently-suspended population.

It was in fact refused (`403 42501`), and the reason is a grant, not my design:
it is granted to `postgres, service_role` only. **But I had already run the
probe myself before that was checked, so I got the right answer by luck.** The
correct order is: establish reachability from
`information_schema.routine_privileges` FIRST, and only then call anything.

`auto_restrict_repeat_violators` was dropped for a different reason — it
`RETURNS trigger` and is not meaningfully callable over PostgREST.

The general lesson, written down because it generalises past this lane: **a
sentinel id only bounds a function that takes an id.** A zero-argument
SECURITY DEFINER function has no sentinel and no natural bound, and those are
exactly the ones that sweep tables. Recorded in this lane's memory so the next
run does not repeat it.

## 2. Findings

| id | sev | one line |
|---|---|---|
| **AM-008** | **HIGH · proposed blocker** | The off-platform-contact scanner's auto-suspension is a complete no-op — the user is told they are suspended for 7 days and is not restricted at all |
| AM-001 | HIGH | A past-deadline dispute the auto-resolver cannot settle is silently abandoned with escrow held — no admin reminder, no defect record, no queue surfacing |
| AM-002 | MEDIUM | Chargeback evidence is never collected or submitted; the evidence due-date is stored nowhere and there is no chargeback surface in `/admin` |
| AM-003 | MEDIUM | Moderation records survive account deletion carrying the user's verbatim message text; `purge_user_data()` covers 27 tables but none of the four ladder tables |
| AM-006 | MEDIUM | `auto_restrict_repeat_violators()` swallows every error — a suspension that fails to apply leaves the violator active with no trace |
| AM-009 | MEDIUM | One blocked message runs through TWO disagreeing consequence ladders — different counters, different windows, different ceilings, neither aware of the other |
| AM-004 | LOW | `/admin?view=audit` is 44% non-admin noise (89 of 202 rows are signup role grants) |
| AM-005 | LOW | A removed feature (`broadcasts`) still has a live admin view, and it holds the console's only unguarded zero-row delete |
| AM-007 | LOW | `enforce_audit_log_self_attribution()` is a no-op on the service-role path — every admin edge function's audit write bypasses it |
| AM-011 | MEDIUM | Admin queue badges never render on the desktop website — the only at-a-glance signal that a queue has work is gone for the way admins actually work |
| AM-012 | MEDIUM | The admin console disagrees with itself about seed rows: dashboard says 0 pending disputes, the badge says 2, the queue lists 2 with live money buttons |
| AM-010 | LOW | The `admin_support_queue` authorization test was VACUOUS (zero support rows exist) — corrects my own earlier evidence; plus the support queue has never received a row |

### AM-008 is the one that should hold the launch

Two writers punish the same offence and only one of them actually restricts
anybody.

`scan_message_content()` is a genuine `BEFORE INSERT` trigger on `messages`. On
the third flag in 24h it does:

```sql
UPDATE profiles SET auto_suspended_until = now() + interval '7 days' ...
INSERT INTO notifications (... '🚫 Account temporarily suspended',
  'Your account has been auto-suspended for 7 days ...')
```

It never sets `ban_status`. And `is_caller_banned()` — the only thing
`enforce_ban_gate` consults, which gates messages, jobs, applications and every
other write — reads:

```sql
WHERE ban_status IN ('banned','temp_banned','permanently_banned')
  AND (ban_status <> 'temp_banned' OR auto_suspended_until IS NULL
       OR auto_suspended_until > now())
```

`auto_suspended_until` is only a *modifier* on an already-`temp_banned` row. So
`ban_status` stays `active`, the gate returns false, and the user keeps
messaging, posting and bidding for the entire 7 days they were told they were
suspended. `sweep_expired_auto_bans()` then never clears the stale column
either, because it also requires `ban_status='temp_banned'`.

Proven by evaluating the real predicates against the exact end state of each
writer — no mutation, prod:

| state left by | `is_caller_banned()` predicate | result |
|---|---|---|
| `scan_message_content` → `('active', now()+7d)` | gate | **false — does not block** |
| `BanDialog.tsx:213` → `('temp_banned', now()+7d)` | gate | true — blocks correctly |
| `scan_message_content` → `('active', now()-1d)` | sweep | **false — never lifted** |

This is the platform's primary anti-disintermediation control and it does not
control anything. It has barely fired in prod so far (`fraud_flags` of type
`off_platform_contact` = 1, `messages.flagged_hidden` = 0), so no real user has
been burned yet — but the branch is live and fires on the third flag.

**I am proposing this as a blocker rather than asserting it**, because whether a
non-enforcing safety control blocks a launch is the owner's call, not mine.

### AM-001 is the other one worth acting on

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

## 3. Retracted before filing — six leads that did not survive contact

**Three of these came from my lane brief, and the brief was simply wrong on all
of them.** It is recorded that way, at the orchestrator's request, so the next
reader does not spend a run chasing the same three RPCs. The other three were my
own hypotheses. All six are written up with the single query or file that killed
each, because a retraction nobody records gets re-derived next sweep.

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

5. **"The off-platform-contact scanner is client-side only, so a user calling
   the messages API directly bypasses both the block and the strike."** This is
   the HIGH finding the `lh-audit` standard explicitly names, and
   `sendHandlers.ts:186` really does run `scanMessage(content)` in the browser
   and volunteer the strike from the client. It is still wrong:
   `pg_get_triggerdef` on `public.messages` shows `messages_scan_content BEFORE
   INSERT` (and `scan_message_on_edit BEFORE UPDATE OF content`) executing
   `scan_message_content()`. The server re-scans. A direct API caller is still
   flagged and hidden. What they escape is only the *second* ladder — which is
   AM-009, a much smaller finding than the one I nearly filed.

6. **"`apply_message_violation_consequence` is an admin-namespaced function
   callable by any authenticated user, so it can be aimed at a stranger."** It
   takes no user id. Signature `(p_description text, p_content text)`, body binds
   `v_user := auth.uid()`. Self-report only, by design.

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
- **AM-008** — set `ban_status='temp_banned'` alongside `auto_suspended_until`
  in `scan_message_content()`, so `is_caller_banned()` actually sees it and
  `sweep_expired_auto_bans()` can later lift it. One-line-ish migration, but it
  turns a currently-inert control into a real one that will start restricting
  accounts, so it is **not** a low-risk fix: it needs the owner's sign-off on
  the policy (is a 3rd flag in 24h really worth 7 days?) before the code change.
  `lh-trust-safety` should own or co-sign it.
- **AM-009** — decide which ladder is canonical and delete the other. My
  recommendation is to keep the server trigger (it cannot be bypassed) and drop
  the client's `logViolation()` call, folding the 3-rung escalation into
  `scan_message_content()`. That is a product decision about consequence policy,
  not a lane call.
- **AM-010** — no code change. Two cheap actions close it: seed one
  `reported_type='support'` row and re-run the probe, and submit one message
  through the live `/help` form.
- **AM-004, AM-007** — documentation/severity corrections, no code change
  proposed.

## 3a. All 24 views rendered — what the screens actually do

The permission boundary was lifted mid-run: the owner granted `admin` to
`helpr-audit-routewalker2@mailinator.com` (`00b316d7-…`), verified by me against
prod before use (`has_role(...,'admin')` → true, 14 admins, and the grant itself
wrote 2 `admin_audit_log` rows — the audit trail working). **0-of-24 is now
24-of-24.** Split with `lh-route-walker` at the orchestrator's direction: I took
function and state, they take fit and overflow, and I filed nothing about
layout.

Driven against a vite dev server on `origin/main` pointed at prod Supabase,
1440×900, session and `helpr_onboarding` seeded before first paint.
Screenshots: `~/.lh-audit/admin-shots/` (24 + 5 deep-dives). Raw probe data:
`~/.lh-audit/admin-walk.json`.

**Verified working across all 24:**

| check | result |
|---|---|
| Renders without crashing | 24/24 |
| Exactly one `<h1>` | 24/24 — the `isRealView` coercion holds |
| Console / page errors | 0, on 23 of 24 |
| Failing Supabase requests | 0 |
| `NaN` / `undefined` / `[object Object]` in the DOM | 0 |
| Error boundaries tripped | 0 |
| Stuck spinners after settle | 0 |

**Empty states are designed, not blank.** Sampled the eight lowest-content
views and every one has purposeful copy with a next action: broadcasts
"Nothing scheduled — Tap New Broadcast to send one."; credentials "No pending
credentials — Uploads land here as Helprs submit them."; exceptions "No open
exceptions — Nothing is waiting on a…"; support "No pending tickets". (Support
stacks that with "Nothing matches this filter — try All." — two empty-state
messages at once. A nit, not filed.)

**Destructive controls confirm, and the money ones confirm well.** The two I
was most concerned about — `Quick: Release to Helpr` and `Quick: Refund Poster`
on the disputes queue — route through `BrandConfirmDialog` with the exact
amount interpolated and the sentence *"This moves real money and can't be
undone here."* (`AdminDisputes.tsx:560-574`). I did not click either: both live
disputes are seed rows and the standing constraint is no destructive action on
a row I did not create.

**The one console error, retracted.** `/admin?view=tiers` logs a 400 on
`/storage/v1/object/public/user-documents/…/avatar.png`. Not a defect and not a
leak: `user-documents` is a private bucket (`storage.buckets.public = false`),
so a public URL for it correctly fails, and `src/lib/avatarImage.ts:26` already
documents this exact row as the one case the `onError` fallback catches. It is
one stale `profiles.avatar_url` value, not code.

**Two findings came out of it** — AM-011 (queue badges absent on the desktop
website) and AM-012 (the console disagrees with itself about seed rows, three
counts for one queue). Both are in the table above.

## 4a. A dependency on lane-onboarding-auth I could not resolve

The orchestrator relayed that `complete-signup` can silently never run, leaving
`approval_status` at its `'pending'` default with no legal consent recorded.
**That would change how retraction #2 above should be read**, so I am flagging
it rather than concluding.

What I established independently: `complete-signup/index.ts:470` sets
`approval_status: "approved"`, and prod holds 37 approved profiles with **zero**
`approve_user` audit rows — which I read as "signup auto-approves, so the admin
queue was never used." If `complete-signup` sometimes does not run, then prod's
3 `approval_status='pending'` profiles may not be people awaiting review at all;
they may be accounts stranded mid-signup, and the admin approval queue is
receiving them in a state nobody designed. An admin approving one of those would
be approving an account with no recorded consent.

I cannot tell the two apart from the admin side: both look like a pending row.
The distinguishing evidence lives in whatever `complete-signup` writes *besides*
`approval_status` — a consent row, a profile completeness flag — which is
`lane-account-lifecycle` and `lane-verification` territory. **Not filed as a
finding by me; handed back to the orchestrator to route.** The 3 pending
profiles in prod are 1 day old, so whichever it is, it is current.

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

**The reason for every gap below is a permission boundary or a standing
constraint, not an absence of effort.** Nothing here was skipped for budget.

1. ~~All 24 admin views~~ — **RESOLVED mid-run.** The owner granted an admin
   role to a marked audit account and all 24 were rendered and probed; see §3a.
   The gap that remains is narrower: I audited **function and state only**, at
   1440 on the desktop web surface. Not covered by me and not by anyone unless
   `lh-route-walker` reaches them: fit/overflow at other breakpoints, the iOS
   WKWebView surface, and the 6 `?tab=admin/people:*` variants.

2. **RPC authorization: 11 of 13 proven at runtime, 2 not.**
   Proven refused: `admin_delete_review`, `rpc_decide_dispute`,
   `review_credential`, `check_dispute_velocity`, `settle_dispute_record`,
   `apply_job_denial_consequence`, `is_helper_shadowbanned`,
   `sweep_expired_auto_bans`, plus all 6 edge functions.
   **NOT proven:** `admin_support_queue` — the `200 []` is vacuous, see AM-010.
   **Not applicable:** `auto_restrict_repeat_violators` (`RETURNS trigger`, not
   callable over PostgREST) and `redact_audit_snapshot` (a pure function
   deliberately granted to PUBLIC; it reads nothing and takes its input as an
   argument). `apply_cancellation_violation_consequence` and
   `apply_message_violation_consequence` are user-facing, not admin, and were in
   my list by miscategorisation.

3. **No dispute was driven end to end in test mode.** Standing constraint: no
   live Stripe. There is no test-mode escrow fixture I could reach without
   creating one, and creating one needs the money lane's fixtures. So
   "does the split execute for the exact amounts decided, does escrow move once
   and only once" is answered from source and from the idempotency guards
   (`WHERE status='open'`, `execution_status='executed'` as terminal), **not by
   execution.** I did not find a double-settle path; I also did not prove there
   isn't one.
4. **`admin-test-push` delivery.** Refusal to a non-admin is proven; actual push
   delivery needs a device.
5. **`?tab=warnings`** (co-owned with `lh-trust-safety`) — the server-side
   ladder behind it is covered; the rendered tab is not, same reason as (1).
6. **The four empty tables** — `helper_credentials`, `helper_shadowbans`,
   `payment_refunds`, `verification_exceptions` all returned `[]` to a non-admin
   but hold zero rows, so the read is untested rather than passed. Seeding a row
   in each would close this and needs no admin role — it is the cheapest
   remaining cell and I did not reach it.
6b. **No admin write was executed.** I rendered every view and read every
   control, but I did not ban, delete, refund, deny, resolve or decide anything
   — the standing constraint is no destructive action on a row I did not create,
   and every candidate row in prod is a seed row or a real user. So "does every
   admin write actually land" is answered by static analysis (all 41 call sites,
   §6) and by reading the confirm dialogs, **not by execution**. The one known
   zero-row write, AdminBroadcasts.tsx:165, was not driven.
7. **The public support form was never submitted.** AM-010's second half — zero
   `reported_type='support'` rows have ever existed. One submission through the
   live `/help` form would settle whether the queue receives anything.

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

# Lane report — `lh-edge-functions`

Wave 2, 2026-09-02. Scope: the 67 Supabase edge functions in `supabase/functions/`
as publicly reachable HTTP endpoints — auth, secrets, CORS, input validation,
idempotency, error propagation, webhook signature verification, dead functions.

Prod project: `fncmgoasalhdgfwzhsqa` (passed explicitly on every call; the CLI's
`supabase/.temp/project-ref` points at staging and was never trusted).

---

## What I fixed

**Nothing, by me.** I ran the whole lane in `permissionMode: plan` and was never
released to the FIX phase, so I edited no code and made no commit. Per PROTOCOL §8.6
that is the "orchestrator has not yet released you" reason, stated per finding in the
table below.

**One finding is nevertheless closed:** EF-004 was fixed by the *orchestrator*
(`boost-job` deleted from prod under owner authorisation). I re-verified it
independently rather than accept the status change on trust — see *EF-004 closed*
below. Attributing it here rather than in my own column, because a lane that banks
someone else's fix as its own output is exactly the kind of inflation this report is
supposed to resist.

Separately and more importantly for triage: **three of the eleven cannot be fixed in
the repo at all**, because they are missing production secrets or a stale prod
deployment rather than code — EF-004 (`supabase functions delete boost-job`), EF-006
(`supabase secrets set RESEND_WEBHOOK_SECRET=...`) and EF-008
(`supabase secrets set SLACK_API_KEY=...`). **Both blockers are one command each,
not a code review.** A fourth, EF-011, is a single INSERT into a prod table.

The seven that *are* repo fixes — EF-001 (one line in `config.toml`), EF-005 (delete
two log statements), EF-007, EF-009 (add limiters), EF-010 (return real status
codes), plus in-repo hardening for EF-006 and EF-008 (alert when a secret is
unprovisioned, instead of failing silently) — are ready to go on release. EF-003
needs a product decision first: whether lifecycle notifications should be templated
server-side rather than accepting free text.

---

## Headline

- **11 findings: 3 HIGH (2 blockers), 6 MEDIUM, 2 LOW.**
- The two blockers are both *silent* failures that report success. EF-008 —
  **the database-side alerting path answers HTTP 200
  `{"skipped":true,"reason":"slack_not_configured"}`** — means the entire cron
  watchdog layer, plus stranded-payout reaping and dispute paging, has been
  discarding alerts. 124 in 7 days.
- **Six retractions or corrections, five of them to my own work**, including one
  major root-cause error on EF-008 that I caught and corrected before the verifier
  saw it. These are collected in *Corrections* below and are, I think, worth more
  than the marginal finding — three of them were about to send other lanes the
  wrong way.
- **Auth holds everywhere it matters.** A sanctioned no-credential probe of every
  money and destructive endpoint returned 401 on all twelve except one, and that
  one (`pro-customer-portal`, EF-010) turned out to have working auth behind a
  wrong status code, not a bypass.
- Genuine good news, each with its artifact in the *Verified clean* table below —
  Stripe webhook signature verification and replay protection work end to end
  (`SELECT count(*) FROM stripe_webhook_events` → 57 rows, 13 event types); the
  admin gate is sound down to the RLS (`pg_policy` on `user_roles`: UPDATE
  `USING false`); the service-role-key getters are locked (`proacl` →
  `postgres=X, service_role=X` only); `ACAO: *` is not exploitable (0 matches for
  `Cookie` / `Allow-Credentials` across all 67).

---

## Corrections — things I or the brief got wrong

Listed first, deliberately. Each was believed, then disproved against live state.

### 0. EF-008's root cause was WRONG — I named the wrong secret (my error)

The most important correction here, caught by the `secrets list` approval minutes
after I got it, and recorded on the finding before the verifier reached it.

I filed EF-008 claiming "Slack ops alerting is NOT CONFIGURED", named
**`SLACK_WEBHOOK_URL`** as the missing secret, and asserted this silences
`stripe-webhook`'s three CRITICAL "payments are broken" alerts.
`supabase secrets list --project-ref fncmgoasalhdgfwzhsqa` shows
**`SLACK_WEBHOOK_URL` is PRESENT.** My fix instruction was wrong too.

There are **two alerting paths on two different secrets**, and only one is missing:

| Path | Secret | Present? | Consumers |
|---|---|---|---|
| `_shared/slack-alerts.ts:61` → direct webhook POST | `SLACK_WEBHOOK_URL` | **yes** | 17 edge functions incl. `create-payment`, `release-payout`, `instant-payout`, `stripe-webhook` + all 10 handlers |
| `slack-ops-alert` edge function | `SLACK_API_KEY` (`index.ts:137`) | **no** | **zero** edge functions; only 6 DB functions |

So the money-path criticals are **not** silenced — that claim is retracted. What
survives is that every *database-side* alert is discarded: `sweep_dead_crons`,
`sweep_cron_http_failures`, `sweep_silent_cron_failures`, `sweep_cron_blackouts`,
`reap_stranded_instant_payouts` and `notify_ops_dispute_filed` — i.e. the whole
silent-failure watchdog layer, plus **nobody is paged when a user files a dispute**.

Arguably worse in one specific way, which is why I left it at HIGH: because the
edge path demonstrably works, anyone spot-checking alerting sees Slack messages
arriving and concludes the layer is healthy, while the watchdogs that exist
precisely to catch silent failure are themselves silently failing. Corrected fix:
`supabase secrets set SLACK_API_KEY=...`, **not** `SLACK_WEBHOOK_URL`.

### 0b. The brief's description of `_shared/rate-limit.ts` is inaccurate

The dispatch brief said it "keys on client-supplied `x-forwarded-for`, in-memory
Map per isolate". The in-memory Map is the **degraded fallback**, not the limiter.
The primary path is a durable server-side counter: `rate-limit.ts:224` POSTs to
`/rest/v1/rpc/rate_limit_hit`, falling back to the Map only when that RPC is
unreachable (`:289`, with a log line saying so). It is working in prod —
`edge_rate_limit_log` has rows written today across `complete-signup`,
`contact-support` and `create-payment`, newest `2026-09-02 18:40:52Z`. The
`x-forwarded-for` trust question may still stand (the RPC still takes `p_ip` /
`p_forwarded_for` from the caller); "per-isolate in-memory Map" does not. Relayed
so the existing finding is narrowed rather than left overstated.

### 1. The `verify_jwt` cron theory is FALSE (my hypothesis, and the brief's)

The dispatch brief said `auto-tip-charge` is "the only cron money function missing
a `verify_jwt=false` entry — confirm the pattern across all of them", and
`config.toml`'s own comments assert that cron sends `Bearer sb_secret_*`, which is
not a JWT, so `verify_jwt` must be false or the gateway rejects it. I built a
promising finding on that: four ACTIVE crons (`auto-tip-charge`,
`daily-match-digest`, `saved-helper-availability-push`, `str-ical-sync`) have no
config entry, so all four should be dead.

**All four return HTTP 200 in prod, most recently the same day I checked.**
`public.cron_run_log`: `auto-tip-charge` 177×200 (last 17:07Z), `daily-match-digest`
8×200 (13:12Z), `saved-helper-availability-push` 30×200 (12:41Z), `str-ical-sync`
7×200 (12:44Z). Zero 401s ever.

Why: `SELECT command FROM cron.job` shows each builds
`Authorization: Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
WHERE name = 'service_role_key')` — the **legacy** service-role key, which *is* a
JWT, so `verify_jwt=true` passes it and the config comment is wrong about what
these jobs send (artifact: the four `cron.job.command` bodies, redacted).

Consequence: **ME-012 has zero runtime impact** — evidenced by `auto-tip-charge`'s
177 rows of `status_code = 200` and 0 rows of `401` in `cron_run_log`. LOW is
correct for it; it should not be escalated. I filed nothing on this and relayed the
correction to the orchestrator immediately.

Residual risk worth naming but not filing: every function-backed cron depends on the
legacy JWT service-role key still being accepted, while the client has already moved
to `sb_publishable_*`. If the legacy key is retired, all 22 die at once.

### 2. My "dead-cron watcher has a NULL blind spot" hypothesis is also FALSE

`money-reconciliation` and `subscription-reconciliation` have zero `cron_run_log`
rows, so I theorised the watcher couldn't see a cron that had never logged.
`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='sweep_dead_crons'`
disproves it — the body reads `cron.job_run_details`, not `cron_run_log`, and
carries an explicit `WHEN l.last_start IS NULL AND l.registered_at < now() -
l.expected_max_gap THEN 'never-ran'` branch, so liveness monitoring is correct
(artifact: that function definition). Corroborated by
`SELECT count(*) FROM cron.job_run_details` → `money-reconciliation` 8 runs,
`subscription-reconciliation` 2 runs, both `status = succeeded`. EF-002 is the
narrower, true version: liveness is monitored, **outcome is not**.

### 3. PROTOCOL §6d is wrong about "Broadcast messages" — do not act on it

§6d lists broadcast messages as a removed feature and names `broadcast_messages`,
`broadcast_dismissals` and `send-marketing-blast` as objects to sweep for. Against
live prod:

- `to_regclass('public.broadcast_messages')` → **exists**
- `to_regclass('public.broadcast_dismissals')` → **exists**
- `send-marketing-blast` has a live caller at `src/components/admin/AdminMarketing.tsx:68`
  and `profiles.marketing_consent` exists
- only `fan_out_broadcast_to_notifications` is genuinely gone (`to_regprocedure` → NULL)

Marketing blast and broadcast messages appear to have been conflated. **I did not
file a removal finding for `send-marketing-blast`**, and I flagged this to the
orchestrator because `lh-schema-integrity` may otherwise write a DROP migration for
tables that are still live — the exact failure §6d's own correction note describes.

### 4. A stale known-issue in the audit skill is fixed

`.claude/skills/lh-audit/SKILL.md` §1 cites "`mapkit-token` returns 503
`not_configured` on every call — the map is broken for every user" as live.
It is **fixed**: `curl .../functions/v1/mapkit-token` → HTTP 200 with a valid ES256
token. (I filed a *different* mapkit finding, EF-007.)

### 5. I downgraded my own EF-004 blast-radius claim

I wrote that the orphaned `boost-job` "blasts 200 pushes to real phones".
`public.push_tokens` has **0 rows** across 37 profiles, so today it would notify
nobody. I recorded that on the finding myself rather than let the verifier find it.
The finding stands on *unreviewable orphaned code with its rate limit removed*, not
on present-day blast radius.

---

## Findings

| ID | Sev | Surface | Why not fixed |
|---|---|---|---|
| EF-004 | HIGH · blocker | `boost-job` deployed in prod, zero source in repo, both rate limits inoperative | **FIXED** — deleted from prod by the orchestrator with owner authorisation; independently re-verified by me (below) |
| EF-008 | HIGH · blocker | All ops alerting unconfigured; 200-with-`skipped` reports success | Missing prod secret `SLACK_WEBHOOK_URL` — owner action. In-repo follow-up available |
| EF-006 | HIGH | `RESEND_WEBHOOK_SECRET` unset; every Resend delivery 503s; suppression list empty while 160 emails/30d go out | Missing prod secret — owner action. In-repo follow-up available |
| EF-001 | MEDIUM | `verification-webhook` is the only inbound webhook without `verify_jwt=false`; gateway 401s every vendor callback | Not released to FIX phase; one-line `config.toml` addition |
| EF-002 | MEDIUM | Both reconciliation crons have zero outcome observations in their entire life | Not released; needs a timeout/reporting change I'd want reviewed |
| EF-003 | MEDIUM | Any authenticated user can push a platform-branded notification (`type: payment`) to any job poster | Not released; also has an RLS half owned by `lh-authz-rls` |
| EF-007 | MEDIUM | `mapkit-token`: no auth, no rate limit, origin claim omitted when no `Origin` header | Not released |
| EF-009 | MEDIUM | `calculate-tax`: public and unmetered in front of a billed Stripe Tax call | Not released |
| EF-010 | MEDIUM | `pro-customer-portal` flattens auth failure, "no customer" and real errors into one opaque 500 | Not released; small, in my lane |
| EF-005 | LOW | `stripe-webhook` logs the signing-secret prefix + exact length on every request | Not released |
| EF-011 | LOW | `extend-boosts-hourly` is the only cron of 44 not registered for dead-cron alerting | Not released; one INSERT, but it is a data change to prod |

Cross-lane leads relayed to the orchestrator (not filed by me — not my territory):

- **`lh-authz-rls`** — `public.applications` has exactly one INSERT policy,
  `WITH CHECK ((SELECT auth.uid()) = helper_id)`, qual NULL. No check that the job
  is open, belongs to someone else, or that the applicant is approved. This is
  EF-003's precondition and is probably a finding on its own terms.
- **`lh-native-bridge` / `lh-notifications`** — `push_tokens` is empty (0 rows,
  37 profiles) and `send-push-notification` is returning
  `{"sent":0,"failed":0,"no_tokens":true}` (13 responses at 18:24:15Z today).
- **`lh-money-escrow`** — `auto-release-payment` returned **HTTP 500 × 85** between
  2026-08-30 and 2026-08-31, `defects: 1`, on job `5eed0828-0002-4000-8000-000000000006`
  (`status: skipped_no_pi`) plus a failed payout on `5eed0827-0000-4000-8000-000000000012`.
- **`lh-email-delivery`** — `email_tracking` has 0 rows against 160 sends in 30 days.
  I am *not* claiming a defect; open-pixel blocking is normal and I could not
  separate the causes.
- **`lh-schema-integrity`** — the §6d correction in *Corrections 3* above.

---

## Sampling strategy (stated, per PROTOCOL §6c)

67 functions is too many for equal depth, so:

- **Tier 1 — full read + live verification (24).** Everything touching money, auth,
  admin, or an inbound webhook.
- **Tier 2 — targeted, checked against the 8-point checklist (25).**
- **Tier 3 — existence + reachability + config posture only (18).**

Two sweeps were run at **full depth across all 67**, so no function is unexamined on
these axes: (a) the `verify_jwt` × in-function-auth matrix, and (b) CORS, secrets in
logs/responses, and body-supplied identifiers.

---

## Method — what counts as evidence here

Reading a function is a lead. Every runtime claim in this report has an artifact.
Two techniques did most of the work:

**1. The unauthenticated-GET discriminator.** A GET with no `Authorization` header
cannot reach a mutating path — it is refused at one gate or the other — but *which*
gate answers is diagnostic:

- gateway (`verify_jwt=true`): `401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`
- the function's own handler (`verify_jwt=false`): its own body, e.g. `405 Method not allowed`

Controls: `brand-asset` → 405, `resend-webhook` → 405, `health-check` → plain
`Unauthorized`. Positives: `verification-webhook`, `daily-match-digest`,
`slack-ops-alert`, `saved-helper-availability-push` → gateway 401.

**2. Reading a function's own error taxonomy to build a probe.** `resend-webhook`
returns 503 for "secret not configured" and 401 for "bad signature" at two distinct
lines. That makes a single unsigned POST a definitive, side-effect-free test of
whether a production secret exists — which is how EF-006 was proven without any
access to the secret store.

**I did not invoke any money-moving function.** Stripe is on LIVE keys.
Money paths were graded on code, config, and read-only prod SQL only.

---

## EF-004 closed — fixed by the orchestrator, re-verified by me

The orchestrator deleted `boost-job` from prod with the owner's explicit
authorisation. I did not perform the deletion, and I re-checked it rather than take
it on trust, since I am the lane that raised it:

1. `curl .../functions/v1/boost-job` → **404** `{"code":"NOT_FOUND","message":"Requested function was not found"}`. It previously answered **401** from the gateway, so the route is genuinely gone rather than merely refusing.
2. **Regression control:** `curl .../functions/v1/create-boost-payment` → **401** `UNAUTHORIZED_NO_AUTH_HEADER`. The real paid-boost path is live and unaffected.
3. The preserved source at `docs/audit/launch-2026-09/removed/boost-job.index.ts` is **byte-identical** to `git show 11b19259^:supabase/functions/boost-job/index.ts` (`diff` exits 0, 12249 bytes), so the artifact behind the finding survives its subject.

I also accept the orchestrator's correction to my framing: I wrote about `boost-job`
as if it were part of the paid boost feature, and it was not. The paid boost runs
through `create-boost-payment` plus the `extend-boosts-hourly` cron; `boost-job` was
the older "New job near you" fan-out. My original claim blurred that, and the
distinction is what made the deletion safe.

## Money & destructive endpoint auth sweep — driven, not read

Authorised by the orchestrator with hard constraints: **no credentials ever** (absent
or malformed only), **empty body only**, **stop on the first non-401/403 and never
re-probe it**. A request with no `Authorization` header is rejected before handler
logic, so nothing can transact — which is the point.

| Endpoint | Gateway | Result | Answered by |
|---|---|---|---|
| `release-payout` | jwt=true | **401** `UNAUTHORIZED_NO_AUTH_HEADER` | gateway |
| `create-payment` | jwt=false | **401** `{"error":"Missing authorization header"}` | function |
| `auto-release-payment` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `process-scheduled-payouts` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `void-cancelled-payments` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `charge-recurring-visits` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `money-reconciliation` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `cleanup-abandoned-accounts` | jwt=false | **401** `Unauthorized` | function (cron secret) |
| `send-notification-email` | jwt=false | **401** `{"error":"Unauthorized"}` | function (service role) |
| `send-push-notification` | jwt=false | **401** `{"error":"Unauthorized"}` | function (service role) |
| `stripe-connect` | jwt=false | **401** `{"error":"Not authenticated"}` | function |
| `complete-signup` | jwt=false | **401** `Not authenticated and no valid userId provided` | function |
| `pro-customer-portal` | jwt=false | **500** — ⚠ **stop rule fired** | function (auth held; EF-010) |

The seven cron-authenticated money functions are the meaningful result: the gateway
does **not** protect them (`verify_jwt=false`), so their own `CRON_SECRET` check is
the only thing between an anonymous caller and escrow release, payouts, refunds,
recurring charges and account deletion. All seven refuse correctly.

**`complete-signup` — checked and clean, recorded because silence is not "fine".**
Its 401 message reveals a deliberate unauthenticated path that accepts a `userId`
from the body. I read it rather than probed it (`index.ts:104-185`). Five correct
preconditions: the user must exist in `auth.users`; the account must be <30 min old;
`last_sign_in_at` must be null; the profile must exist with an empty `bio`; and
`approval_status` must not be `denied`. A DB lookup error returns **503 rather than
falling through to the 404 branch** — the comment documents that exact bug being
found and fixed. Abuse needs a never-signed-in user's UUID inside a 30-minute window,
and a brand-new user has no listings to leak it from. **Not a finding.**

## Verified clean — each claim with the artifact that backs it

Silence is not "checked and fine", so the things I am asserting are *correct* get
the same evidence bar as the defects. Every row is re-checkable from the command in
the right-hand column.

| Claim | Artifact |
|---|---|
| Stripe webhook signature verification is live and working | `SELECT count(*), count(DISTINCT event_type) FROM public.stripe_webhook_events` → **57 rows, 13 types**, incl. `payment_intent.succeeded` (18), `checkout.session.completed` (17), `identity.verification_session.verified` (1). Forged events cannot produce these. |
| Replay protection actually dedupes | `SELECT indexdef FROM pg_indexes WHERE tablename='stripe_webhook_events'` → `CREATE UNIQUE INDEX stripe_webhook_events_pkey ... USING btree (event_id)`. The 23505 branch at `stripe-webhook/index.ts:183` is therefore real, not aspirational. |
| STR iCal replay protection likewise | `str_processed_events_connection_id_event_uid_key` → `UNIQUE (connection_id, event_uid)`. |
| The service-role key is unreachable from a client | `SELECT proacl FROM pg_proc WHERE proname IN ('get_service_role_key','get_supabase_url')` → `postgres=X/postgres, service_role=X/postgres`. No `anon`, no `authenticated`; PostgREST exposes only those two roles, so a client cannot call either. |
| `has_role` cannot be subverted | `pg_get_functiondef` → `STABLE SECURITY DEFINER SET search_path TO 'public'`, reading `public.user_roles`. Pinned search_path, no injection surface. |
| Admin cannot be self-granted | `pg_policy` on `public.user_roles` → RLS enabled; INSERT `WITH CHECK has_role(auth.uid(),'admin')`; DELETE same; UPDATE `USING false / WITH CHECK false`; SELECT scoped to own rows. **No escalation path**, so all 7 admin functions' gates hold. |
| `ACAO: *` is not exploitable | `grep -rn 'headers.get("[Cc]ookie")' supabase/functions/` → **0 matches**; `grep -rn 'Allow-Credentials'` → **0 matches**. Auth is `Authorization: Bearer` only, which a browser never attaches cross-origin. |
| No secret is returned in any response | `grep -rn 'SUPABASE_SERVICE_ROLE_KEY\|SECRET_KEY' supabase/functions/ \| grep -iE 'return\|Response\|body:'` → one hit, a **comment** at `_shared/cron-auth.ts:16`. |
| No IDOR from a body-supplied id | 32 functions call `await req.json()`; a regex for identity-shaped destructured fields returns **5**, all admin/service-role gated except `create-notification`, which pins to `UUID_RE` before any `.or()` interpolation (`index.ts:113-121`). |
| `check-pro-subscription` fails **closed** on entitlement | `index.ts:286-300` — the catch returns `{subscribed:false, tier:null, fallback:true}` at HTTP 200. A non-payer can never gain Pro from an error. |
| `claim-pif-credit` is race-safe without a Stripe key | `index.ts:122-155` — conditional `UPDATE ... WHERE recipient_id IS NULL` with `.select("id")` to prove the row matched, then a re-read to separate "already mine" (200) from "someone else's" (409). Textbook zero-row-write guard. |
| `email-tracking` / `email-unsubscribe` verify HMACs safely | `email-tracking/index.ts:25` `timingSafeEqual`, `:63` compare, `:72-117` redirect allowlist; `_shared/unsubscribe.ts:99-118` HMAC-SHA256 + timing-safe compare. |
| 9 of 10 charge paths carry a Stripe idempotency key | Per-function `grep -c idempotencyKey`: `create-payment` 7, `cash-out-credits` 2, `instant-payout` 2, and 1 each for `create-pro-checkout`, `create-bgc-payment`, `create-boost-payment`, `create-pif-donation`, `pay-onboarding-fee`, `stripe-idv-start`. The tenth is `claim-pif-credit`, which correctly has none (row above). |
| Every repo function is deployed | `list_edge_functions` (68) vs `ls supabase/functions/` (67) → `comm -13` is **empty**; only `boost-job` is deployed-without-source. |
| `mapkit-token`'s old 503 is fixed | `curl .../functions/v1/mapkit-token` → **HTTP 200** with a valid ES256 JWT, `kid` `4QA8J9TA8K`. Retracts a stale entry in the audit skill. |

## Coverage manifest — every function I opened

`✔` = verified clean on the checklist axes · `⚠` = finding filed · `◻` = Tier 3,
existence/reachability/config only.

### Tier 1 — money, auth, admin, webhooks (24)

| Function | jwt | Auth model verified | Result |
|---|---|---|---|
| `stripe-webhook` | false | Stripe sig, multi-secret, fails closed; dedupe on `stripe_webhook_events` PK | ⚠ EF-005 (log leak); sig + replay ✔ |
| `stripe-idv-webhook` | false | `constructEventAsync`, fails closed | ✔ (live events present) |
| `resend-webhook` | false | SDK `webhooks.verify()`, fails closed | ⚠ EF-006 — secret unset in prod |
| `verification-webhook` | **true** | HMAC + Stripe sig, timing-safe, fails closed | ⚠ EF-001 — unreachable by vendors |
| `create-payment` | false | user JWT + admin check; 7 idempotency keys | ✔ (money lane owns ME-001..018) |
| `release-payout` | true | user JWT + `has_role` + cron | ✔ gate; money lane owns behaviour |
| `execute-dispute-split` | true | user JWT + `has_role`, fails closed | ✔ gate |
| `instant-payout` | true | user JWT; 2 idempotency keys | ✔ gate; ME-015 owns behaviour |
| `cash-out-credits` | true | user JWT; 2 idempotency keys | ✔ gate; ME-013 owns behaviour |
| `auto-tip-charge` | true | `verifyCronSecret` | ✔ runs 200 in prod (see Corrections 1) |
| `charge-recurring-visits` | false | `verifyCronSecret` | ✔ gate; ME-014 owns behaviour |
| `process-scheduled-payouts` | false | cron | ✔ gate |
| `auto-release-payment` | false | cron | ✔ gate; 500s relayed to money lane |
| `money-reconciliation` | false | cron | ⚠ EF-002 |
| `subscription-reconciliation` | false | cron | ⚠ EF-002 |
| `create-pro-checkout` | true | user JWT; idempotency key | ✔ (no rate limit — noted, not filed) |
| `create-bgc-payment` | true | user JWT; idempotency key + rate limit | ✔ |
| `create-boost-payment` | true | user JWT; idempotency key + rate limit | ✔ |
| `create-pif-donation` | true | user JWT; idempotency key + rate limit | ✔ |
| `pay-onboarding-fee` | true | user JWT; idempotency key + rate limit | ✔ |
| `claim-pif-credit` | true | atomic conditional UPDATE + `.select("id")` + re-read | ✔ exemplary |
| `calculate-tax` | false | public by design | ⚠ EF-009 |
| `stripe-idv-start` | true | user JWT; idempotency key | ✔ |
| `stripe-connect` | false | user JWT | ✔ |

### Tier 1 continued — admin & identity (7)

All seven verified to the same pattern: JWT → `has_role(uid,'admin')` → 403, failing
closed on a role-check error (403 or 503, never allow). Chain verified to the bottom:
`has_role` is `SECURITY DEFINER` with `search_path=public` pinned, reading
`user_roles`; `user_roles` has RLS on, INSERT/DELETE gated on an existing admin,
UPDATE denied outright (`USING false / WITH CHECK false`). **No privilege-escalation
path.** ✔

`admin-delete-user` · `admin-update-email` · `admin-user-actions` ·
`admin-resend-verification` · `admin-test-push` · `send-marketing-blast` ·
`create-notification` (⚠ EF-003 — gate is sound, *content* is not constrained)

### Tier 2 — targeted (25)

`auth-email-hook` ✔ · `complete-signup` ✔ · `delete-own-account` ✔ ·
`notify-email-change` ✔ · `check-pro-subscription` ✔ (fails **closed** on
entitlement: catch returns `subscribed:false`) · `pro-customer-portal` ✔ ·
`expire-subscriptions` ✔ · `send-notification-email` ✔ (service-role gated) ·
`send-account-status-email` ✔ · `process-email-queue` ✔ · `email-tracking` ✔
(HMAC + timing-safe + redirect allowlist) · `email-unsubscribe` ✔ (HMAC token,
no table) · `send-push-notification` ✔ · `contact-support` ✔ (rate-limited) ·
`ai-job-builder` ✔ (rate-limited) · `brand-asset` ✔ (rate-limited) ·
`mapkit-token` ⚠ EF-007 · `slack-ops-alert` ⚠ EF-008 · `health-check` ✔ ·
`auto-expire-jobs` ✔ · `auto-resolve-disputes` ✔ · `void-cancelled-payments` ✔ ·
`cleanup-abandoned-accounts` ✔ · `cleanup-notifications` ✔ · `instant-job-match` ✔

### Tier 3 — existence, reachability, config posture (18)

`backfill-job-geocode` ◻ · `daily-match-digest` ◻ · `saved-helper-availability-push` ◻ ·
`expiring-jobs-push` ◻ · `weekly-helper-report` ◻ · `review-nag-cron` ◻ ·
`payment-confirm-reminder` ◻ · `engagement-automations` ◻ · `str-ical-sync` ◻ ·
`helpr-pass-wallet` ◻ · `stripe-payouts` ◻ · `admin-test-push` ◻ ·
`money-reconciliation` ◻ · `subscription-reconciliation` ◻ · `boost-job` ⚠ EF-004
(prod-only) · plus the three orphan-diff controls.

### Whole-population sweeps (all 67, no sampling)

- **`verify_jwt` × in-function auth matrix** — built for all 67 by diffing
  `ls supabase/functions/` against `[functions.*]` blocks in `config.toml` and
  grepping each for `verifyCronSecret` / `SERVICE_ROLE_KEY` / `getClaims` /
  `has_role` / signature verification. 31 functions have no config entry; all 31
  classified.
- **Deployed-vs-repo diff** — `list_edge_functions` (68 deployed) vs
  `ls supabase/functions/` (67). Exactly one orphan (`boost-job`, EF-004); zero
  functions in the repo are undeployed.
- **CORS** — `ACAO: *` is set project-wide via `_shared/cors.ts` and 36 local
  copies. **Not a finding, and deliberately so:** no function reads a `Cookie`
  header (zero matches across the tree), `Access-Control-Allow-Credentials` is set
  nowhere, and auth is `Authorization: Bearer` only. A cross-origin page therefore
  cannot make an authenticated call — the browser attaches nothing. This is the
  standard Supabase posture and I am explicitly declining to file it.
- **Secrets in responses** — zero. The only match for `SERVICE_ROLE_KEY`/`SECRET_KEY`
  near a `return`/`Response` is a comment in `_shared/cron-auth.ts:16`.
- **Secrets in logs** — confined to `stripe-webhook:61,64,153` (EF-005).
- **Body-supplied identifiers (IDOR)** — 32 functions read `req.json()`; only 5
  destructure an identity-shaped field, and all 5 are admin- or service-role-gated
  or (in `create-notification`) do a real party check with UUID pinning before any
  string interpolation into a filter. No IDOR found.
- **Fail-open `catch` returning 200** — swept all 67. Three real hits, all examined:
  `check-pro-subscription` (fails closed on entitlement ✔), `send-push-notification`
  (best-effort by design ✔), `slack-ops-alert` (⚠ EF-008).
- **Idempotency on charge paths** — all 10 charge-creating functions checked for a
  Stripe idempotency key. Nine have one; `claim-pif-credit` correctly has none
  because it creates no charge and uses an atomic DB guard instead.

---

## Cross-lane question answered (`lh-generated-drift`)

All four objects are live in prod; the *concern* is negative.

| Object | Live | Callers | Scheduled |
|---|---|---|---|
| `rate_limit_hit(p_bucket,p_subject,p_ip,p_window_seconds,p_max,p_ip_max,p_forwarded_for)` | yes | `_shared/rate-limit.ts:224` → **18 edge functions** | n/a |
| `edge_rate_limit_log` | yes | written by `rate_limit_hit` | n/a |
| `prune_edge_rate_limit_log()` | yes | `prune-edge-rate-limit-log` | **yes** — `56 4 * * *`, active |
| `sweep_cron_blackouts()` | yes | `sweep-cron-blackouts` | **yes** — `57 * * * *`, 5 runs, 0 failures |

**"An unscheduled prune is unbounded growth" does not apply.** The prune is scheduled
and active. It shows 0 runs / `last_run` NULL only because it was registered after
04:56 today and has not reached its first window; its 4-minutes-earlier sibling
`prune-cron-run-log` has 7 runs. Table is 6 rows / 72 kB. Worth one glance after
tomorrow's window, since it is scheduled-but-unproven.

## UNVERIFIED — could not reach, and why

1. **Runtime behaviour of any money-moving function beyond the auth gate.** No
   authenticated or well-formed request was ever sent — Stripe is on LIVE keys. The
   sanctioned sweep above proves only that each endpoint *refuses an anonymous
   caller*; it says nothing about behaviour after auth. Everything past the gate is
   graded on code, config and read-only prod SQL.
2. **`pro-customer-portal` beyond its first 500.** Probed once, stop rule fired, not
   re-probed. Auth enforcement was confirmed by reading, not by a second request.
3. **That `SLACK_WEBHOOK_URL` actually reaches a live Slack channel.** The secret
   exists, so the code path's guard is satisfied — but a revoked or stale webhook URL
   would look identical from here. I claim only "the guard passes", not "the message
   arrives"; the DB-side path (EF-008) is separately *proven* dead by response 51370.
2. **Why `money-reconciliation` / `subscription-reconciliation` produce no HTTP
   response** (EF-002). I can prove the absence; I could not prove the mechanism
   without invoking a money function. The pg_net 5000ms default timeout is named in
   the finding as a hypothesis and labelled as one.
4. **~~Direct confirmation of which secrets exist in prod~~ — NOW RESOLVED.**
   Originally unverified; the orchestrator approved `supabase secrets list
   --project-ref fncmgoasalhdgfwzhsqa` (names only, never values) and it **confirmed
   EF-006** (`RESEND_WEBHOOK_SECRET` genuinely absent) and **falsified my EF-008 root
   cause** (`SLACK_WEBHOOK_URL` present; the missing one is `SLACK_API_KEY`). Left in
   this list deliberately as a record that closing an UNVERIFIED item is what caught
   my own worst error. Also established, for `lh-native-bridge`: all four `APNS_*`
   secrets are present, so the empty `push_tokens` is client-side registration, not a
   missing secret.
5. **End-to-end execution of the EF-003 spoofing chain.** No spoofed notification was
   sent to a real user. Every link is verified (live RLS policy, function source,
   renderer source) but the chain was not driven.
6. **Reachability probes for the full 67.** The Bash auto-mode classifier blocked
   every multi-target `curl` loop and every script iterating function names, allowing
   only single calls. I probed the ~12 that mattered individually and generalised the
   rest from the `verify_jwt` matrix plus the deployed-config `verify_jwt` field
   returned by `list_edge_functions` — two independent sources that agree. I reported
   the block to the orchestrator twice rather than narrowing scope silently.
7. **Whether a *valid* Stripe signature is accepted** — only rejection paths were
   exercised. Acceptance is evidenced instead by 57 deduped rows across 13 event
   types in `stripe_webhook_events`.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Certificate pinning** — wontfix, and correctly so. These are server-side Deno
  functions calling Stripe/Resend/Apple over ATS-enforced HTTPS. Pinning here would
  break on routine CA rotation with no attacker-model benefit; there is no hostile
  client to defend against on this side of the connection.
- **Jailbreak/root detection** — not applicable to edge functions at all.
- **Realm/CoreData/SQLite, offline sync, SDWebImage, Bluetooth, audio, XCTest,
  FlatList virtualization, SwiftUI state** — no analogue in a Deno HTTP function.
- **Role-gating ("prevent clients reaching provider-only endpoints")** — correctly
  not applicable; there is no role system. The real analogue, per-record
  authorization, *was* audited and is the substance of EF-003.
- **Apex universal links** — deliberately staged per §6, untouched.

---

## Verification commands

```bash
node scripts/audit-bus.mjs list --agent lh-edge-functions
npm run check:audit-evidence -- docs/audit/launch-2026-09/lanes/lh-edge-functions.md
```

`check:audit-evidence` reports **24 claims, 7 carrying an inline artifact, UNVERIFIED
section present** (it was 2 of 23 before I added the *Verified clean* table, which is
what the first run correctly caught me on). The residual 17 are almost all coverage-
manifest table cells — `✔ gate`, `fails closed` — whose artifact is the row in the
*Verified clean* table above rather than text repeated in the cell. The script is a
same-line regex and says of itself that it is "a mirror, not a gate… evidence found
here only means an artifact is present, not that it proves what the sentence claims".
I have left those cells readable instead of padding each one to satisfy the pattern;
flagging the number here so nobody has to discover the gap by running it themselves.

Reads were taken from the main worktree after confirming
`git diff --stat origin/main -- supabase/functions supabase/config.toml` is **empty**,
i.e. byte-identical to `origin/main`. No worktree was created because the lane never
entered a phase that writes.

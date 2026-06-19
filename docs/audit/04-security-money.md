# Deep Pass 04 — Payments, Money Flow & Backend Security (Phases 4 + 14)

Companion to `docs/PRE_LAUNCH_AUDIT.md`. Verified against prod
(`fncmgoasalhdgfwzhsqa`) via Supabase MCP + direct reads of
`supabase/functions/`. Every finding cites `file:line` or the prod object.

---

## A. Verified-clean (checked, sound — do not re-flag)

| Area | What was checked | Result |
|---|---|---|
| Client key posture | `src/integrations/supabase/client.ts:1-40` | Uses ONLY `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (anon). No service-role key in the bundle. ✓ |
| Stripe secret logic | all of `supabase/functions/*` | Every `new Stripe(STRIPE_SECRET_KEY)` is server-side in edge functions. `grep` of `src/` finds `sk_test` only in `src/test/edge/*` mocks. No charge/payout logic in the bundle. ✓ |
| Webhook signature | `stripe-webhook/index.ts:89` | `stripe.webhooks.constructEventAsync(body, sig, webhookSecret)` — verifies signature before processing. Missing-sig/secret paths ack 200 to stop retries but do NOT process. ✓ |
| Webhook idempotency | `stripe-webhook/index.ts:116-134` | Inserts `stripe_webhook_events(event_id)` with UNIQUE; `23505` → skip. Prevents double-grant / double-email on Stripe retries. ✓ |
| `release-payout` idempotency | `release-payout/index.ts:163-177, 287` | Triple guard: pre-check `payout_transfers` ledger (409 if exists), Stripe `idempotencyKey: release-payout-${job.id}`, DB `UNIQUE(stripe_transfer_id)`. Best-in-class. ✓ |
| Escrow authorization | `create-payment/index.ts:81,246-248,431,482,514-515` | Every action checks `job.customer_id === user.id` / poster-or-helper / `has_role('admin')`. ✓ |
| Onboarding-fee race | webhook:295, process-scheduled-payouts:84, release-payout:230 | All three paths use an atomic conditional `UPDATE … WHERE onboarding_fee_paid=false` claim; webhook auto-refunds a duplicate $2 (idempotency-keyed). ✓ |
| RLS coverage | prod `pg_policies` vs `pg_tables` | 90/90 public tables have `rowsecurity=true` and ≥1 policy. Zero gaps. ✓ |
| `get_service_role_key` grant | prod `has_function_privilege` | EXECUTE only for `postgres` + `service_role`; `anon`=false, `authenticated`=false. Not exploitable. ✓ |
| Dispute payout block | `release-payout/index.ts:134-143`; create-payment:252 | Defense-in-depth: refuses payout on any `disputed_at` marker unless `dispute_status='resolved'`. ✓ |

---

## B. Findings

### 🟠 F-SEC-01 — `.env` is tracked in git (downgraded from blocker)
`.env` is committed (`git ls-files .env` → match) **even though** it is also
listed in `.gitignore:48`. Verified contents are publishable-only:
`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
— 0 matches for `service_role` / `sk_live` / `sk_test`. These are
public-by-design keys already shipped in the client bundle, so this is a
**hygiene issue, not a secret leak**, and **key rotation is NOT required**
(contrary to the audit-prompt assumption).
**Fix:** `git rm --cached .env && git commit`. The file stays on disk; future
secret additions are now correctly ignored. (If a private key is ever added to
`.env` later, rotate then.)

### 🟠 F-MONEY-01 — Two active payout crons with non-shared idempotency (double-pay hazard)
Prod `cron.job` has **both** payout systems live:
- `auto-release-payment` (`*/30 * * * *`) → Phase 1 escrow→`payout_pending`,
  Phase 2 (gated on `RELEASE_PAYOUT_AUTO=1`) calls the **idempotent**
  `release-payout`.
- `process-scheduled-payouts` (`0 13 * * *`) → transfers **directly** with
  **no Stripe idempotency key**, writes **no `payout_transfers` ledger row**,
  and guards only on the `payment_status='payout_pending'` query filter +
  a post-transfer flip to `released` (`process-scheduled-payouts/index.ts:200-205`).

Both select the same `status='completed' AND payment_status='payout_pending'`
jobs. Because `process-scheduled-payouts` uses no idempotency key and
`release-payout` uses `release-payout-${job.id}`, the two paths will **not**
dedup against each other at Stripe. A race where both read `payout_pending`
before either writes `released` → **helper transferred twice**. Even alone,
`process-scheduled-payouts` can double-pay under a concurrent re-invocation.
**Why it matters:** real money leaves the platform balance; "a helper is paid
exactly once" is violated.
**Fix (pick one):**
1. **Retire `process-scheduled-payouts`** — `auto-release-payment → release-payout`
   already covers the full path safely. Unschedule the cron, keep `release-payout`
   as the single payout writer.
2. If kept: make it (a) pre-check `payout_transfers` for an existing
   pending/paid row, (b) write a `payout_transfers` row, and (c) use the **same**
   idempotency key as `release-payout` (`release-payout-${job.id}`).

### 🟡 F-MONEY-02 — `create-payment` escrow checkout has no Stripe idempotency key
`stripe.checkout.sessions.create(...)` at `create-payment/index.ts:209` runs
with no `idempotencyKey`. The DB guard at line 84 (`stripe_session_id` +
`payment_status !== 'unpaid'`) prevents most duplicates, but a rapid
double-submit before the first session row is persisted (lines 222-228) could
create two checkout sessions for one job.
**Why it matters:** low — manual capture, poster-initiated, and the second
session would orphan rather than double-charge — but it's a cheap gap to close.
**Fix:** pass `{ idempotencyKey: \`escrow-${jobId}\` }` to the session create.

### 🟡 F-MONEY-03 — `admin_release_dispute` marks job released even if the transfer silently fails
`create-payment/index.ts:537` calls `transferToHelper(...)`, whose inner
`catch` (line 801) **swallows** the Stripe error (admin notification only, no
rethrow). Control returns and the job is unconditionally set
`payment_status='released'` (line 540). A failed transfer leaves a job marked
"released" with no money moved — and unlike `release-payout`, there is no
`payout_transfers` ledger row to reconcile against.
**Why it matters:** silent payout failure + wrong DB state on the disputed-money
path. **Fix:** route admin dispute releases through `release-payout` (which has
the ledger + idempotency), or rethrow on transfer failure so the job is not
flipped to `released`.

### 🟡 F-SEC-04 — `public.open_jobs_browse` is a SECURITY DEFINER view (advisor ERROR)
Supabase advisor flags `open_jobs_browse` as `security_definer_view` (the only
ERROR-level lint). Such views enforce the *creator's* RLS, not the querying
user's. Likely intentional (public browse/map needs to read open jobs
regardless of viewer), but it must be confirmed to expose **only** non-sensitive
columns of **open** jobs.
**Fix:** review the view definition; if it only surfaces public browse columns,
document it and (optionally) recreate as `security_invoker=true` with an
explicit RLS policy. Otherwise narrow the column set.

### 🟡 F-SEC-05 — `partner_applications` INSERT policy is always-true
Advisor `rls_policy_always_true`: policy `public_insert_partner_applications`
has `WITH CHECK (true)` — anyone (incl. anon) can insert. This is **intentional**
(the public "Become a Partner" form; `BecomeAPartner.tsx:6` documents anon
insert, service_role-only read), so it is acceptable, but it's an
unauthenticated write endpoint with no throttle.
**Fix:** add basic abuse protection (rate-limit by IP via the shared
`_shared/rate-limit.ts`, or a captcha) to prevent spam inserts. Low urgency.

### 🟢 F-SEC-06 — 18 functions have a mutable `search_path` (advisor WARN)
e.g. `get_platform_impact_stats`, `record_job_view`, `apply_to_job`,
`counter_application_bid`, `endorse_skill`, `auto_approve_milestone`, +13.
SECURITY DEFINER functions without a pinned `search_path` are a theoretical
hijack surface.
**Fix:** add `SET search_path = public` to each (most newer functions already
have it; this is the backlog tail). Hardening, not exploitable today.

### 🟢 F-SEC-07 — 59 anon-EXECUTE SECURITY DEFINER functions — verified internally gated
Advisor flags 59 secdef functions executable by `anon`, including mutators
(`accept_application`, `apply_to_job`, `rpc_open_dispute`, `rpc_decide_dispute`,
`update_business_member_role`, `create_business_api_key`). **Spot-checked the
highest-risk ones in prod:** `rpc_decide_dispute` requires `auth.uid()` non-null
+ `has_role('admin')`; `update_business_member_role` requires
`auth.uid()` = owner/admin member; `accept_application` derives the job from
the application and locks the row; `auto_approve_milestone` is a trigger (not
RPC-callable). All gate on `auth.uid()` (NULL for anon → reject). This is the
standard Supabase grant-to-PUBLIC posture, **not a vulnerability.**
**Fix (optional defense-in-depth):** `REVOKE EXECUTE … FROM anon` on the
mutation RPCs so the advisor warning clears and anon can't even attempt them.

### 🟢 F-SEC-08 — Leaked-password protection disabled (advisor WARN)
Supabase Auth's HaveIBeenPwned compromised-password check is off.
**Fix:** enable in Auth settings (one toggle). Low effort, real signup-hardening.

---

## C. Money-path scorecard (1–5, 5 = ship-ready)

| Path | Auth | Idempotency | State integrity | Error handling | Score |
|---|---|---|---|---|---|
| Escrow funding (`create-payment` escrow) | 5 | 3 (F-MONEY-02) | 5 | 5 | 4 |
| Two-party release (`create-payment` release) | 5 | 5 | 5 | 5 | 5 |
| Auto-release 48h (`auto-release-payment`) | 5 | 5 | 5 | 5 | 5 |
| Scheduled payout (`process-scheduled-payouts`) | 5 | **2 (F-MONEY-01)** | 3 | 4 | **3** |
| Manual/auto payout (`release-payout`) | 5 | 5 | 5 | 5 | 5 |
| Dispute release (`admin_release_dispute`) | 5 | 3 | 3 (F-MONEY-03) | 3 | 3 |
| Webhook ingestion (`stripe-webhook`) | 5 | 5 | 5 | 5 | 5 |
| Refunds (`admin_refund_*`) | 5 | 4 | 5 | 5 | 5 |

**Net:** the canonical path (`auto-release-payment → release-payout`) is
excellent. The two open money risks both live in the **legacy parallel
`process-scheduled-payouts` cron** (F-MONEY-01) and the **dispute-release
shortcut** (F-MONEY-03) — both fixable by routing through `release-payout`.

---

## D. Phase 14 — App Store / store-readiness (backend-adjacent)

| Check | Status | Evidence |
|---|---|---|
| Account deletion exists & reachable | ✅ | `delete-own-account` edge fn (v12) + in-app path; required by App Store guideline 5.1.1(v) |
| Stripe secrets server-side only | ✅ | §A above |
| Payments = real-world services (not IAP) | ✅ | Helpr tasks are physical services → Stripe is correct, not StoreKit/IAP (App Store 3.1.3(e)) |
| Email secrets server-side | ✅ | Resend only in edge fns (see `06-cross-cutting.md` Phase 12) |
| UGC moderation surface | ⚠️ verify | suspicious-pattern + no-show detection crons exist; confirm report/block + content-moderation UI is reachable for App Store 1.2 (UGC) |
| `.env` not bundled into `.ipa` | ✅ | only `VITE_*` (public) keys; build embeds them by design |

**Still to verify on-device (manual pass):** iOS `Info.plist` permission
usage strings (camera/photos/location/notifications), Sign in with Apple
present alongside other social logins (App Store 4.8), no seed/test data in the
production build.

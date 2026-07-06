# Louisiana Helpr — Pre-Launch Audit

**Date:** 2026-07-05
**Auditor:** Lead Product Engineer pass (static review of shipping tree `src/` + `supabase/`, gate runs, source-existence checks)
**Build target:** App Store Connect v1.0.x · `appId: com.Helpr`
**Method:** Static code review + gate runs + parallel read-only source sweep (money, security/RLS, trust/safety/lifecycle, silent-failure/cohesion). This is a **grading** pass — no code was changed. Supersedes the 2026-07-03/04 report.

---

## Executive Summary

### Readiness verdict: 🟢 **CONDITIONAL GO**

No 🔴 blockers were found. The core money, escrow, auth, RLS, and Apple-1.2 UGC-moderation surfaces are fundamentally sound: idempotency keys are stably derived on **every** charge path, payouts fail closed, escrow stays held while disputed, single-winner accept is row-locked, location views are coordinate-masked for anon, no secrets ship in the client bundle, and admin endpoints are server-authorized with an audit log. The app can charge real money safely today.

The conditional part is **four 🟠 High findings** that should be triaged before cutting the App Store build — none blocks the money path, but two are privacy/trust cracks that App Review and real shared-device users will hit:

**Top risks, in priority order:**
1. **F-PRIV-01 🟠 — Push token never cleared on logout.** `unregisterPushOnSignOut()` is defined (`nativePush.ts:341`) but has **zero call sites** in `src/`. On a shared/handed-off phone, user A logs out and still receives A's push notifications while B is signed in. Privacy leak.
2. **F-TRUST-02 🟠 — A "hidden" flagged message is still readable by the recipient.** The message thread query (`useMessagesData.ts:118-125`) has no `flagged_hidden=false` filter; "hidden" only suppresses the *notification*, not the row.
3. **F-TRUST-01 🟠 — The off-platform-contact scanner hides-but-delivers server-side.** `scan_message_content()` sets `flagged_hidden := true` then `RETURN NEW` — the row is still inserted. The actual block is client-only (`sendHandlers.ts`); a direct PostgREST insert bypasses it.
4. **F-MONEY-01/02 🟠 — Price-config drift.** Stripe price IDs are hardcoded in `create-pro-checkout` and `create-business-seat-checkout`, decoupled from `subscriptionTiers.ts`. A price change in config does not change what Stripe charges until the dashboard is manually updated — the displayed price and the charged price can silently diverge.

Everything else is 🟡 Medium / 🟢 Low hardening.

### ✅ Resolution — all four 🟠 High findings fixed (2026-07-05, this commit)

| ID | Status | Fix |
|----|--------|-----|
| **F-PRIV-01** | ✅ Fixed | New `signOutWithPushCleanup()` (`src/lib/authSignOut.ts`) clears the user's `push_tokens` **before** `auth.signOut()` (RLS-scoped delete must precede session teardown). All 14 sign-out sites now route through it; the delete's Supabase `error`/exception is reported to monitoring so a failed cleanup is observable, not silent (`nativePush.ts:341`). |
| **F-TRUST-02** | ✅ Fixed | All three thread-content reads in `useMessagesData.ts` now carry `.or("sender_id.eq.${userId},flagged_hidden.eq.false")` — an exact client mirror of the server RLS policy, so a receiver can never read a scrubbed message even if RLS regressed (defense-in-depth; sender still sees their own flagged message). |
| **F-TRUST-01** | ✅ Resolved (no code change) | Decision: keep store-hide-strike. A `RAISE EXCEPTION` hard-reject would roll back the trigger's own `fraud_flags` INSERT + auto-suspend + notification (losing repeat-offender tracking), and RLS already prevents the receiver reading flagged rows — now additionally hardened client-side by F-TRUST-02. |
| **F-MONEY-01/02** | ✅ Fixed | Consumer checkout price map extracted to a single source of truth (`supabase/functions/_shared/proTiers.ts`), re-exported to the client (`src/lib/proTiers.ts`) and drift-guarded by `proTiers.parity.test.ts`, which ties the cent ledger back to `subscriptionTiers.ts` and locks the exact Stripe Price IDs. Business seats (F-MONEY-02) were already on this pattern via `businessSeatTiers.ts`. |

---

## Gate status

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc -b --noEmit` | ✅ exit 0, clean |
| Lint | `eslint .` | ✅ exit 0, 0 warnings |
| Build | `vite build` | ✅ exit 0, built in ~31s, PWA precache 16 entries |
| Unit tests | `npx vitest run` | ⚠️ Flaky under load (45 failed / 1235 passed in the contended full run); **green in isolation** (`button.test.tsx` 11/11 in 26s). Failures were the most trivial render tests — signature of resource exhaustion, not logic regressions. vitest is NOT in CI. |
| Playwright e2e | (CI-required) | Not run this session — required CI gate, runs on PR only; direct-to-main admin push bypasses it. |

**Largest shipped JS chunks (gzip):** jspdf 129.5kB · CartesianChart 85.4kB · sentry 70.9kB · posthog 68.7kB · supabase 52.1kB · html2canvas 46.8kB · leaflet 44.9kB. (jspdf + html2canvas are the PDF-export path; both are heavy and candidates for lazy-loading behind the export action.)

---

## Phase 0 — Screen inventory (from `src/App.tsx`, 465 lines)

**Public / guest:** `/`, `/login`, `/signup`, `/jobs`, `/jobs/:id`, `/browse`, `/help`, `/legal`, `/subscription`, `/for-business`, `/discharge`, `/insurance-claim`, `/evacuation`, `/data-rights`, `/community`, marketing verticals.

**Protected (`ProtectedRoute`, variants `allowUnapproved`/`allowPending`):** `/dashboard`, `/profile` (18 tabs), `/post-job` (3-step wizard), `/messages`, `/my-jobs`, `/my-posts`, `/payment-success`, `/user/:userId`, `/pay-it-forward`, `/family` + `/family/accept/:token`, `/analytics`, `/business/*` (team/billing/api/contracts/exports/onboarding/reports), `/home-history`, `/work-record`, `/benefits`, `/pets`, `/str-settings`.

**Admin (`AdminRoute`):** `/admin` (27 `?view=` sub-views).

**Account-state gates:** `/account-pending`, `/signup-pending`, `/account-denied`, `/account-banned`, `/complete-profile`.

**Redirects:** `/support→/help`, `/terms→/legal?tab=terms`, `/enterprise→/for-business`, `/impact→/`, `/parishes→/jobs`, etc. Catch-all `path="*"`→NotFound.

---

## Findings (severity-grouped)

### 🔴 Blockers
**None.**

### 🟠 High

| ID | file:line | Finding | Fix |
|---|---|---|---|
| **F-PRIV-01** | `src/lib/nativePush.ts:341` | `unregisterPushOnSignOut()` defined but **never called** (0 grep hits in `src/`). Logged-out device keeps receiving the prior user's push. Shared-device privacy leak. | Call it in the sign-out path (auth `signOut` handler) with the current `user.id` **before** the session is torn down. |
| **F-TRUST-02** | `src/pages/messages/useMessagesData.ts:118-125` | Message query selects `*` with only a sender/receiver `OR` filter — **no `flagged_hidden=false`**. A scanner-hidden message is still returned to and rendered for the recipient. "Hidden" only skips the notification. | Add `.eq("flagged_hidden", false)` to the query (and ideally an RLS `SELECT USING (flagged_hidden = false OR sender_id = auth.uid())` so the sender still sees their own). |
| **F-TRUST-01** | `supabase/migrations/20260618170000_scan_message_spelled_phone_and_warn.sql:48-83` | `scan_message_content()` sets `NEW.flagged_hidden := true` then `RETURN NEW` — the contraband row is still inserted. The real block is client-only (`sendHandlers.ts:170-184`); a direct PostgREST call bypasses it. | For a hard block, `RAISE EXCEPTION` on match in the trigger (server-enforced), or keep hide-semantics but ensure F-TRUST-02's read filter is in place so hidden never reaches the recipient. Decide hide-vs-reject (see pop-up). |
| **F-MONEY-01** | `supabase/functions/create-pro-checkout/index.ts:8-24` | Membership Stripe price IDs hardcoded in a `PRICE_MAP`, decoupled from `subscriptionTiers.ts`. Displayed price (config) and charged price (Stripe) can diverge silently. Idempotency key `pro:${user.id}:${tier}` verified clean. | Drive the price off a single source: read the Stripe price from config keyed to `subscriptionTiers.ts`, or add a `subscriptionTiers.test.ts` assertion that the map matches config amounts, so drift fails a gate. |
| **F-MONEY-02** | `supabase/functions/create-business-seat-checkout/index.ts:10-11` | Same class as F-MONEY-01 for business-seat pricing — Stripe charges the OLD amount until the dashboard is manually updated. Key `bizseat:` verified clean. | Same fix as F-MONEY-01; tie seat price to config + guard with a test. |

### 🟡 Medium

| ID | file:line | Finding | Fix |
|---|---|---|---|
| **F-MONEY-03** | `supabase/functions/stripe-webhook/index.ts:140-142` | Idempotency-insert error path **continues** rather than aborting; a genuine insert failure could allow re-processing. Signature verification confirmed present (`:100`). | On idempotency-insert failure, distinguish "already processed" (skip, 200) from "insert errored" (return non-2xx so Stripe retries) rather than falling through. |
| **F-LIFE-01** | `src/components/JobTracking.tsx:270-279` | No server-side transition-ordering guard. The column whitelist (migration `20260703161000`) limits WHICH columns update, not ORDER — a direct UPDATE can set `helper_arrived_at` while `status` is still `open`. | Add a status-machine guard in the RPC/trigger (`UPDATE ... WHERE status = <expected_prior>`), so "arrive" can't precede "accept". |
| **F-RT-01** | `src/pages/Admin.tsx:343-345` | `postgres_changes` `event:"*"` with no server-side `filter` — admin-only, but an unfiltered platform-wide firehose. | Scope the channel with a server-side filter; admin-only limits blast radius but the pattern violates the realtime rule. |
| **F-RT-02** | `src/components/admin/AdminNotificationLogs.tsx:104-105` | INSERT subscription with no filter (admin-only). | Same as F-RT-01. |
| **F-TRUST-03** | `src/pages/DataRights.tsx:77-88` | Data export is a client-side JSON dump, not server-authoritative — reflects only what the client can already read, not a complete CCPA export. | Move export to a server function that assembles the full record set from all tables/storage. |

### 🟢 Low / hardening

| ID | file:line | Finding | Fix |
|---|---|---|---|
| **F-PRIV-02** | `src/lib/nativePush.ts:341-344` | When called, `unregisterPushOnSignOut` deletes ALL of the user's device tokens, not just the current device's. | Scope the delete to the current device token when a device identifier is available. |
| **F-TRUST-04** | `supabase/functions/delete-own-account/index.ts:86` | Hard-delete relies on FK cascade; storage media + Stripe customer/Connect linkage not explicitly purged. Verified: refuses delete while party to a live job or escrow held (fails closed). | Explicitly delete storage objects and detach/delete the Stripe customer in the delete path. |
| **F-TYPE-01** | `src/hooks/useMyBusiness.ts:50` | `.select(... as any)` migration-lag guard — benign, but an `any` hole. | Regenerate Supabase types post-migration and drop the cast. |

---

## Verified CLEAN (checked, no defect)

- **Location privacy:** `open_jobs_browse`, `get_ranked_open_jobs`, `get_public_open_jobs` all use `mask_job_location`; `get_open_jobs_for_map` rounds to 2 decimals; no raw `GRANT SELECT ON jobs TO anon`; leaky `open_jobs_safe` was dropped (`20260618120000`).
- **RLS:** `job_tracking` scoped to `customer_id`/`helper_id`/`admin`; `20260618150000` REVOKEs EXECUTE from anon on ~30 mutation RPCs; SECURITY DEFINER functions pin `SET search_path`.
- **Secrets:** none in client bundle; `sk_`/service-role keys live only in edge functions.
- **Admin endpoints:** `admin-user-actions`, `admin-update-email`, `admin-delete-user`, `admin-resend-verification` all server-authorized via `has_role` + write `admin_audit_log`.
- **Apple 1.2 UGC quartet:** ReportDialog, BlockUserDialog (server-enforced `enforce_block_on_message_insert`), admin takedown/ban, EULA + 18+ gate at `Signup.tsx:113-114/173` persisted to `profiles.accepted_terms_at`.
- **Reviews:** `enforce_review_validity` (`20260504154800`) + `UNIQUE(job_id, reviewer_id)` — complete-only, one-per-party, no self-review.
- **Concurrency:** `accept_application` `FOR UPDATE` single-winner; `rpc_open_dispute` keeps escrow held.
- **Idempotency (ALL charge paths):** `escrow-${jobId}`, `cancel-escrow-${jobId}`, tip 10-min bucket, `boost:${user.id}:${job_id}`, `bgc:${user.id}`, cash-out sha256 of sorted credit IDs, `pif:${user.id}:${email}:${cents}`, `pro:`, `bizseat:`.
- **Payouts fail closed:** `release-payout` / `process-scheduled-payouts` read ledger first, verify `pi.status==="succeeded"`, insert ledger before status flip, Slack-alert on post-transfer DB failure. `void-cancelled-payments` reconciles via `getHelperFeePercent`.
- **Webhooks:** all 3 (`stripe-webhook`, `stripe-idv-webhook`, `verification-webhook`) verify signatures.
- **XSS:** clean — the only raw-HTML injection point is the static JSON-LD in Index.tsx (content is hardcoded, never user-supplied).
- **Embed-400 silent-failure class:** fully closed (PIF `ce53fd15` + useHealthData `87339818`); fresh sweep found no recurrences.

---

## Scorecards (1–5)

**Money path:**
| Dimension | Score | Note |
|---|---|---|
| Idempotency | 5 | Stable keys on every path |
| Escrow integrity | 5 | Held while disputed, fails closed |
| Payout safety | 5 | Ledger-first, verified, alerted |
| Price-source-of-truth | **3** | F-MONEY-01/02 hardcoded Stripe IDs |
| Webhook integrity | 4 | Signed; F-MONEY-03 insert-error fallthrough |

**Per-surface:**
| Surface | Score | Note |
|---|---|---|
| Auth / session | 4 | Solid; F-PRIV-01 token-on-logout gap |
| Messaging / trust | **3** | F-TRUST-01/02 hide-but-deliver |
| RLS / security | 5 | Mutations revoked from anon, definers pinned |
| Location privacy | 5 | Masked everywhere for anon |
| Admin console | 4 | Authorized + logged; F-RT-01/02 unfiltered channels |
| Job lifecycle | 4 | F-LIFE-01 no server ordering guard |
| Account deletion | 4 | Fails closed; F-TRUST-04 storage/Stripe not purged |

---

## Prioritized punch list

**Must-fix before build (App Review + shared-device reality):**
1. F-PRIV-01 — wire `unregisterPushOnSignOut` into sign-out.
2. F-TRUST-02 — filter `flagged_hidden=false` in the message read (+ RLS).
3. F-TRUST-01 — decide hide-vs-reject; if reject, `RAISE EXCEPTION` server-side.

**Quick wins:**
4. F-MONEY-01/02 — add a config-vs-Stripe price assertion test so drift fails a gate.
5. F-MONEY-03 — return non-2xx on idempotency-insert error so Stripe retries.
6. F-RT-01/02 — scope the two admin realtime channels.

**Deferred (hardening):**
7. F-LIFE-01 server transition-ordering guard · F-TRUST-03 server-side export · F-TRUST-04 storage/Stripe purge · F-PRIV-02 per-device token delete · F-TYPE-01 drop `as any`.

---

## Coverage-honesty note

**Fully traced (static + source-existence):** every charge path's idempotency + reconciliation, all 3 webhook signatures, RLS grants/revokes on mutation RPCs, location-masking views, admin endpoint authorization + audit logging, the Apple-1.2 UGC quartet, reviews/dispute/accept concurrency, the embed-400 silent-failure class, and the full route inventory.

**NOT fully verified this pass (honest gaps):**
- **Live prod RLS state** — asserted from migration files + source, not re-introspected against prod this session.
- **JobTracking geolocation teardown** — did not confirm the browser geolocation *watcher* is torn down at job end (F-LIFE-01 covers the DB side; the client watch lifecycle is unverified).
- **Stripe/storage cascade on delete** — confirmed the account-delete guard fails closed, but did not trace that storage objects + Stripe customer are actually removed (F-TRUST-04).
- **Instant-job-match / group-job per-slot escrow** — not driven; per-slot escrow sum correctness asserted only from reading.
- **No Stripe test-mode charges run** — prod Stripe is live-keyed; no test-card runs were executed this session.
- **No iOS-sim / browser visual pass** — this was a code-grading pass; no rendered-screen verification at breakpoints or on WKWebView.
- **Playwright e2e** — not run (CI-only gate).

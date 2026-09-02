# Louisiana Helpr — Pre-Launch Audit

**Date:** 2026-07-06 (cohesion sweep: `/evacuation` chrome + contact-email unify · money/webhook follow-on) · base grading pass 2026-07-05
**Auditor:** Lead Product Engineer pass (static review of shipping tree `src/` + `supabase/`, gate runs, source-existence checks)
**Build target:** App Store Connect v1.0.x · `appId: com.Helpr`
**Method:** Static code review + gate runs + parallel read-only source sweep (money, security/RLS, trust/safety/lifecycle, silent-failure/cohesion). The 2026-07-05 pass was grading-only; the 2026-07-06 follow-on **applied fixes** (webhook fail-closed, idempotency-key identity, TOCTOU, fail-closed lifecycle reads) verified by three review agents + the full gate. Supersedes the 2026-07-03/04 report.

---

## 2026-07-06 follow-on — money/webhook hardening (fixes applied, commit `b9da5bfd`)

This pass re-ran the money+silent-failure sweep and found that both Stripe webhooks
could **permanently strand a paid event** on a transient handler error. All items
below were fixed, reviewed (code-reviewer, silent-failure-hunter, security-auditor),
and shipped green.

| ID | file:line | Finding | Fix | Status |
|----|-----------|---------|-----|--------|
| **F-WEBHOOK-01** 🟠 | `supabase/functions/stripe-webhook/index.ts:131-206` | Dedupe row was inserted into `stripe_webhook_events` **before** the handler ran; on handler failure the fn returned **HTTP 200**, so Stripe never retried and the dedupe row blocked every future replay. A transient DB/Stripe blip → a paid event (subscription grant, escrow funding, credit mint) lost forever. | On handler failure, **roll back** the just-inserted dedupe row (`rollbackIdempotency()`, no-op when we didn't insert it) and return **500** so Stripe redelivers and re-runs the idempotent handler. Mirrors the proven `verification-webhook` pattern. Ops alert (`postSlackOpsAlert`, severity `critical`) if the rollback delete itself fails — closes the observability gap on the exact strand it eliminates. | ✅ Fixed |
| **F-WEBHOOK-02** 🟠 | `supabase/functions/stripe-idv-webhook/index.ts` | Same fail-open pattern in the Identity webhook — an IDV status event dropped on a transient error would never re-apply. | Same fail-closed rollback + 500 + rollback-fail ops alert. | ✅ Fixed |
| **F-MONEY-04** 🟠 | `supabase/functions/create-pro-checkout/index.ts` | Stripe idempotency key was `pro:${user.id}:${tier}` — **omitted `billing_cycle`**. A monthly→annual switch within Stripe's 24h key window could replay the *wrong-priced* session. | Key now `pro:${user.id}:${tier}:${billing_cycle}` — the full operation identity. | ✅ Fixed |
| **F-MONEY-05** 🟡 | `supabase/functions/expire-subscriptions/index.ts` | TOCTOU: SELECT-expired-then-UPDATE where the UPDATE filtered only by `user_id` — a subscription that **renewed** in the gap would be wrongly downgraded. | Re-assert the predicate on the UPDATE (`.lt("subscription_expires_at", now)`), so only still-expired rows are nulled. | ✅ Fixed |
| **F-LIFE-02** 🟡 | `src/pages/activity/activityActions/useLifecycleHandlers.ts` | Several money/state gate reads (`job_checkins`, `jobs` proof URLs, prior no-show count) dropped the Supabase `error` — a read failure fell through as falsy, letting a repeat offender escape a ban or a job cancel past a status it couldn't verify. | Capture every `error`, `report()` it, and **fail closed** (toast + return) on the gate reads; ban/warn/reopen writes are report-and-continue. | ✅ Fixed |

### Reviewer-surfaced follow-ups (resolved 2026-07-06)

| ID | file | Finding | Resolution | Status |
|----|------|---------|------------|--------|
| **F-WEBHOOK-03** | `stripe-webhook/handlers/checkoutSessionCompleted.ts` | The fail-closed retry re-runs the handler, so **non-idempotent notification inserts double-fire** (tip/bgc notifications) on a redelivered event. | Notifications now gate on the state-transition write actually happening, not on the webhook firing. **Tip:** the `payment_status: 'pending' → 'paid'` UPDATE carries `.select("id")`; the helper notify fires only when a row actually flipped (a redelivery flips 0 rows → skip). **BGC:** the whole side-effect cluster (profile flip + credential insert + check insert + "started" notify) is guarded by an existence check on an already-`submitted` `helper_credentials` row (fails **open** so a paid check is never dropped). PIF mint/consume were already idempotent (keyed on `stripe_session_id`, fail-closed). Regression-tested by a new duplicate-delivery test. | ✅ Fixed |
| **F-LIFE-03** | `useLifecycleHandlers.ts` (`handleNoShow`) | Ban → ban-status → reopen writes were report-and-continue, so a mid-sequence failure could leave a **half-applied ban**. | The atomic `report_helper_no_show(p_job_id)` RPC (migration `20260518140000`, SECURITY DEFINER, `FOR UPDATE` row lock, poster re-check, 2-strike escalation + reopen in ONE transaction) already existed and is deployed in prod. The non-atomic client-side fallback was **deleted** — a browser can't roll back committed writes, so the only correct path is the server transaction; on any RPC error the handler now fails closed (report + toast + return). | ✅ Fixed |

Alongside these two, the follow-on pass also resolved **F-MONEY-03** (idempotency-**insert** error now fails closed across all three webhooks — see finding row below), reclassified **F-RT-01/02** as by-design (see below), and — while in the checkout handler for F-WEBHOOK-03 — added ops-alert observability on the tip-flip and BGC-record failures and normalized 7 invalid `severity: "error"` Slack calls (an unlisted enum value that rendered an `undefined` header icon) to the valid `"critical"`.

---

## Executive Summary

### Readiness verdict: 🟢 **CONDITIONAL GO**

> **Update 2026-07-06:** the follow-on pass fixed the two remaining High money cracks
> (**F-WEBHOOK-01/02** — webhooks that could permanently strand a paid event) plus two
> Mediums (idempotency-key identity, expire-subscriptions TOCTOU) and the lifecycle
> fail-closed reads. **All six 🟠 High findings across both passes are now resolved and
> shipped green** (`b9da5bfd`). Verdict stays CONDITIONAL — not because a High remains,
> but because the remaining conditions are *verification* gaps, not code gaps: no iOS-sim
> visual pass, no Stripe test-mode charge runs, Playwright e2e is CI-only, and prod RLS
> was asserted from migrations rather than re-introspected. The two Medium structural
> follow-ups (F-WEBHOOK-03 retry double-notify, F-LIFE-03 ban atomicity) plus F-MONEY-03
> (idempotency-insert fail-closed) and F-RT-01/02 (reclassified by-design) are now all
> **resolved** (see the resolution table above).

No 🔴 blockers were found. The core money, escrow, auth, RLS, and Apple-1.2 UGC-moderation surfaces are fundamentally sound: idempotency keys are stably derived on **every** charge path, payouts fail closed, escrow stays held while disputed, single-winner accept is row-locked, location views are coordinate-masked for anon, no secrets ship in the client bundle, and admin endpoints are server-authorized with an audit log. The app can charge real money safely today.

The conditional part is **no longer any open High finding** — all four Highs
that once carried this verdict (F-PRIV-01 push-token privacy, F-TRUST-01/02
message-moderation integrity, F-MONEY-01/02 price-config drift) are **fixed and
verified in the shipping tree** (commit `2b4ef513`; re-verified 2026-07-06 —
`signOutWithPushCleanup` routed through all 14 sign-out sites, the
`flagged_hidden` read-mirror present in all three `useMessagesData` reads, and
the Stripe price map extracted to `_shared/proTiers.ts` with a parity test). The
verdict stays **CONDITIONAL** for one reason only: the remaining gaps are
*verification*, not code — no full iOS-sim visual pass, no live Stripe test-mode
charge runs, and Playwright e2e is CI-only. Everything code-side that this audit
found is resolved.

**Historical top risks (all now ✅ resolved), for the record:**
1. **F-PRIV-01 🟠 — Push token never cleared on logout.** ✅ `signOutWithPushCleanup()` (`authSignOut.ts:17`) clears `push_tokens` before `auth.signOut()`; all sign-out sites route through it; failure is reported, not silent.
2. **F-TRUST-02 🟠 — A "hidden" flagged message readable by the recipient.** ✅ All three thread reads now carry `.or("sender_id.eq.${userId},flagged_hidden.eq.false")` (`useMessagesData.ts:129/232/270`).
3. **F-TRUST-01 🟠 — Scanner hides-but-delivers server-side.** ✅ Resolved by product decision (keep store-hide-strike model) + F-TRUST-02's read filter closes the recipient-read path.
4. **F-MONEY-01/02 🟠 — Price-config drift.** ✅ Price map extracted to `_shared/proTiers.ts` (re-exported to client, drift-guarded by `proTiers.parity.test.ts`); business seats already on `businessSeatTiers.ts`.

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
| Unit tests | `npx vitest run` | ✅ 2026-07-06: **1287/1287 pass** (133 files) after updating the stripe-webhook test to the new fail-closed contract (500 + `received:false` + rollback-delete). vitest is NOT in CI — this local run is the only safety net on a direct-to-main admin push. |
| Playwright e2e | (CI-required) | Not run this session — required CI gate, runs on PR only; direct-to-main admin push bypasses it. |

**Largest shipped JS chunks (gzip):** jspdf 129.5kB · CartesianChart 85.4kB · sentry 70.9kB · posthog 68.7kB · supabase 52.1kB · html2canvas 46.8kB · leaflet 44.9kB. (jspdf + html2canvas are the PDF-export path; both are heavy and candidates for lazy-loading behind the export action.)

---

## Phase 0 — Screen inventory (from `src/App.tsx`, 465 lines)

**Public / guest:** `/`, `/login`, `/signup`, `/jobs`, `/jobs/:id`, `/browse`, `/help`, `/legal`, `/subscription`, `/for-business`, `/discharge`, `/insurance-claim`, `/evacuation`, `/data-rights`, `/community`, marketing verticals.

**Protected (`ProtectedRoute`, variants `allowUnapproved`/`allowPending`):** `/dashboard`, `/profile` (18 tabs), `/post-job` (3-step wizard), `/messages`, `/my-jobs`, `/my-posts`, `/payment-success`, `/user/:userId`, `/pay-it-forward`, `/family` + `/family/accept/:token`, `/analytics`, `/business/*` (team/billing/api/contracts/exports/onboarding/reports), `/home-history`, `/work-record`, `/pets`, `/str-settings`.

**Admin (`AdminRoute`):** `/admin` (27 `?view=` sub-views).

**Account-state gates:** `/account-pending`, `/signup-pending`, `/account-denied`, `/account-banned`, `/complete-profile`.

**Redirects:** `/support→/help`, `/terms→/legal?tab=terms`, `/enterprise→/for-business`, `/impact→/`, `/parishes→/jobs`, etc. Catch-all `path="*"`→NotFound.

---

## Findings (severity-grouped)

### 🔴 Blockers
**None.**

### 🟠 High — all resolved

| ID | file:line | Finding | Fix | Status |
|---|---|---|---|---|
| **F-PRIV-01** | `src/lib/authSignOut.ts:17` (was `nativePush.ts:341` unwired) | `unregisterPushOnSignOut()` defined but **never called**. Logged-out device kept receiving the prior user's push. Shared-device privacy leak. | `signOutWithPushCleanup()` clears the user's `push_tokens` **before** `auth.signOut()` (RLS-scoped delete precedes session teardown); all sign-out sites route through it; the delete error/exception is reported to monitoring, not silent. | ✅ Fixed (`2b4ef513`) |
| **F-TRUST-02** | `src/pages/messages/useMessagesData.ts:129/232/270` | Message reads selected `*` with only a sender/receiver `OR` filter — **no `flagged_hidden=false`**. A scanner-hidden message was still rendered for the recipient. | All three thread-content reads now carry `.or("sender_id.eq.${userId},flagged_hidden.eq.false")` — an exact client mirror of the server RLS policy; sender still sees their own flagged message; all three surface their Supabase error. | ✅ Fixed (`2b4ef513`) |
| **F-TRUST-01** | `supabase/migrations/20260618170000_scan_message_spelled_phone_and_warn.sql:48-83` | `scan_message_content()` sets `NEW.flagged_hidden := true` then `RETURN NEW` — contraband row still inserted; the block was client-only. | **Resolved by product decision:** keep store-hide-strike. A `RAISE EXCEPTION` hard-reject would roll back the trigger's own `fraud_flags` INSERT + auto-suspend + notification (losing repeat-offender tracking); the recipient-read path is now closed by F-TRUST-02. | ✅ Resolved (no code change) |
| **F-MONEY-01** | `supabase/functions/create-pro-checkout/index.ts` | Membership Stripe price IDs hardcoded, decoupled from `subscriptionTiers.ts`. Displayed price (config) and charged price (Stripe) could diverge silently. | Price map extracted to a single source of truth (`_shared/proTiers.ts`), re-exported to client (`src/lib/proTiers.ts`), drift-guarded by `proTiers.parity.test.ts` (ties the cent ledger back to `subscriptionTiers.ts` + locks the Stripe Price IDs). | ✅ Fixed (`2b4ef513`) |
| **F-MONEY-02** | `supabase/functions/create-business-seat-checkout/index.ts` | Same class for business-seat pricing. | Already on the single-source pattern via `businessSeatTiers.ts`; verified. | ✅ Fixed |

### 🟡 Medium

| ID | file:line | Finding | Fix |
|---|---|---|---|
| **F-MONEY-03** ✅ Fixed | `stripe-webhook/index.ts`, `stripe-idv-webhook/index.ts`, `verification-webhook/index.ts` | Idempotency-**insert** error path (non-23505) still **continued** rather than aborting; a genuine insert failure could allow re-processing. Distinct from F-WEBHOOK-01, which fixed the **handler** error path. | **Fixed across all three webhooks:** a non-23505 error on the dedupe-row insert now means the dedupe table is unhealthy → **fail closed** (Slack `stripe_webhook_error` critical alert + return 500 in each function's native envelope), so Stripe/the vendor retries once the DB recovers rather than processing the event un-deduped. A 23505 (duplicate) still 200-skips. Signature verification runs BEFORE the insert (security-auditor confirmed). |
| **F-LIFE-01** | `src/components/JobTracking.tsx:270-279` | No server-side transition-ordering guard. The column whitelist (migration `20260703161000`) limits WHICH columns update, not ORDER — a direct UPDATE can set `helper_arrived_at` while `status` is still `open`. | Add a status-machine guard in the RPC/trigger (`UPDATE ... WHERE status = <expected_prior>`), so "arrive" can't precede "accept". |
| **F-RT-01** ✅ By-design | `src/pages/Admin.tsx:343-345` | `postgres_changes` `event:"*"` with no server-side `filter`. | **Reclassified as by-design, not a defect.** The realtime rule ("scope every channel to the user") exists to stop a *per-user* screen receiving the whole platform's writes; these are **admin oversight consoles** whose entire purpose is a platform-wide live feed, so a user filter would defeat them. The channels already carry a `channelNonce()` (the dedupe half of the rule), and RLS still gates row visibility server-side. Documented the intent in-code so a future reader doesn't "fix" it into uselessness. |
| **F-RT-02** ✅ By-design | `src/components/admin/AdminNotificationLogs.tsx:104-105` | INSERT subscription with no filter (admin-only). | Same as F-RT-01 — intentional admin-wide feed, now nonce'd + documented. |
| **F-TRUST-03** | `src/components/profile/LegalTab.tsx:67-110` (was `src/pages/DataRights.tsx:77-88`; page merged into the Profile Legal tab 2026-08-18, finding carried over unchanged) | Data export is a client-side JSON dump, not server-authoritative — reflects only what the client can already read, not a complete CCPA export. | Move export to a server function that assembles the full record set from all tables/storage. |

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
| Price-source-of-truth | 4 | F-MONEY-01/02 fixed (single source); F-MONEY-04 idempotency-key identity fixed |
| Webhook integrity | **5** | Signed; F-WEBHOOK-01/02/03 + F-MONEY-03 all resolved — every webhook fails closed on a dedupe-insert error and is retry-safe (notifications gate on the real state flip) |

**Per-surface:**
| Surface | Score | Note |
|---|---|---|
| Auth / session | **5** | F-PRIV-01 token-on-logout gap resolved (`signOutWithPushCleanup`) |
| Messaging / trust | **4** | F-TRUST-01/02 resolved (read-mirror + product decision); off-platform scanner store-hide-strike by design |
| RLS / security | 5 | Mutations revoked from anon, definers pinned |
| Location privacy | 5 | Masked everywhere for anon |
| Admin console | 5 | Authorized + logged; F-RT-01/02 unfiltered channels confirmed by-design (admin oversight feeds, nonce'd + documented) |
| Job lifecycle | 4 | F-LIFE-03 no-show ban now atomic (RPC-only, fail-closed); F-LIFE-01 server ordering guard still open |
| Account deletion | 4 | Fails closed; F-TRUST-04 storage/Stripe not purged |

---

## Prioritized punch list

**Must-fix before build — ✅ ALL CLEARED (2026-07-05, commit `2b4ef513`):**
1. ✅ F-PRIV-01 — `signOutWithPushCleanup` wired through all 14 sign-out sites; token delete precedes `auth.signOut()`; failure reported.
2. ✅ F-TRUST-02 — `flagged_hidden=false` read-mirror added to all three `useMessagesData` reads.
3. ✅ F-TRUST-01 — decided: keep hide-strike (product decision); recipient-read path closed by F-TRUST-02.

No open High or Blocker remains. The must-fix-before-build list is empty.

**Done this pass (2026-07-06, commit `b9da5bfd`):**
- ✅ F-WEBHOOK-01/02 — both Stripe webhooks fail closed (rollback dedupe + 500) so a transient error can't strand a paid event.
- ✅ F-MONEY-04 — `create-pro-checkout` idempotency key now includes `billing_cycle`.
- ✅ F-MONEY-05 — `expire-subscriptions` re-asserts the expiry predicate on UPDATE (TOCTOU).
- ✅ F-LIFE-02 — `useLifecycleHandlers` gate reads fail closed + `report()` the error.

**Done this pass (2026-07-06, follow-on commit):**
- ✅ F-MONEY-03 — idempotency-**insert** error now fails closed (Slack alert + 500) across all three webhooks so Stripe/vendor retries instead of processing un-deduped.
- ✅ F-WEBHOOK-03 — tip + BGC notifications gate on the real state transition (`.select()`-checked flip / existence guard); PIF was already idempotent; duplicate-delivery regression test added.
- ✅ F-LIFE-03 — `handleNoShow` now relies solely on the atomic `report_helper_no_show` RPC and fails closed on error (non-atomic client fallback deleted).
- ✅ F-RT-01/02 — reclassified by-design (admin oversight feeds); intent documented in-code, already nonce'd.
- ✅ Observability — ops alerts added on tip-flip and BGC-record failures; 7 invalid `severity: "error"` Slack calls normalized to `"critical"`.

**Done this pass (2026-07-06, cohesion sweep — commits `f2baf055`, `f607bd92`):**
- ✅ **F-CHROME-01** — `/evacuation` (Pet Evacuation Help) was a public web route that dropped the shared marketing nav + footer (rendered a bare `min-h-screen` wrapper). Wrapped in `PublicLayout` so the web surface carries global chrome exactly like its sibling verticals (`/discharge`, `/insurance-claim`); added `/evacuation` to `DOCUMENT_SCROLL_ROUTES` so the `app-shell` 100dvh lock is not double-applied to the now-document-scroll layout. DOM-verified at 1440 (nav→h1→footer stacking, zero overflow) and 375 (`html.app-shell` absent, nav+footer present). Native surface unchanged (`PublicLayout` still renders `AppShell` on `isNativePlatform`).
- ✅ **F-COHESION-01** — `CancelSurveyDialog` was the lone contact affordance still pointing at `hello@louisianahelpr.com`; unified both occurrences (mailto href + display text) to the canonical `admin@louisianahelpr.com`. This was the only non-`admin@` contact email in `src/`.

**Deferred (hardening / structural):**
- F-LIFE-01 server transition-ordering guard · F-TRUST-03 server-side export · F-TRUST-04 storage/Stripe purge · F-PRIV-02 per-device token delete · F-TYPE-01 drop `as any`.

**Open recommendations (product/positioning — not defects, no code owed):**
- **"Task marketplace" vs "job" terminology.** SEO meta + Navbar tagline use "task marketplace" / "Everyday Tasks" (`Navbar.tsx:240`, `Index.tsx:134/137`) while in-app copy standardizes on "job". Recommend **keeping "task marketplace" in SEO/meta** (it's a search keyword users type) but the visible Navbar tagline is a softer call — unify to "job" only if the marketing voice should match in-app. Not a defect; flagged for a deliberate call.
- **Tier-ladder shorthand.** `subscriptionTiers.ts` ships 5 tiers (Free / Helpr Basic / Helpr Pro / Helpr Elite / Business); some brief prose uses "Free / Pro / Elite" shorthand. Config is the source of truth and the app is consistent with it — the shorthand is a summary, not a contradiction. No change needed.

---

## Coverage-honesty note

**Fully traced (static + source-existence):** every charge path's idempotency + reconciliation, all 3 webhook signatures, RLS grants/revokes on mutation RPCs, location-masking views, admin endpoint authorization + audit logging, the Apple-1.2 UGC quartet, reviews/dispute/accept concurrency, the embed-400 silent-failure class, and the full route inventory.

**NOT fully verified this pass (honest gaps):**
- **Live prod RLS state** — asserted from migration files + source, not re-introspected against prod this session.
- **JobTracking geolocation teardown** — did not confirm the browser geolocation *watcher* is torn down at job end (F-LIFE-01 covers the DB side; the client watch lifecycle is unverified).
- **Stripe/storage cascade on delete** — confirmed the account-delete guard fails closed, but did not trace that storage objects + Stripe customer are actually removed (F-TRUST-04).
- **Instant-job-match / group-job per-slot escrow** — not driven; per-slot escrow sum correctness asserted only from reading.
- **No Stripe test-mode charges run** — prod Stripe is live-keyed; no test-card runs were executed this session.
- **Browser visual pass — partial.** The `/evacuation` chrome fix (F-CHROME-01) was verified in Chrome by **measured DOM geometry** (nav present, footer present, nav→content→footer stacking order, `documentElement.scrollWidth <= clientWidth` zero-overflow assertions) at 1440 and 375, and the `html.app-shell` class absence confirmed at 375. This is geometry-verified, not screenshot-verified: the Playwright screenshot tool hit a hard 5s backend timeout this session (fonts-loaded then stall, identical before/after a CSS animation-freeze injection — a tooling limit, not a page defect), so pixel screenshots weren't captured. Every OTHER route's visual/breakpoint pass remains unrun.
- **No iOS-sim / WKWebView visual pass** — no rendered-screen verification on the native surface this session. The iOS sim is signed into a real user (view-only constraint), so authed-flow screenshotting was out of scope; a dedicated `npx cap run ios` pass is still owed for full completeness.
- **Playwright e2e** — not run (CI-only gate).

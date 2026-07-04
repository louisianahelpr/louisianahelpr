# Louisiana Helpr — Pre-Release Full-App Audit

_Generated: 2026-07-03 · **Re-verified 2026-07-04** · Branch: `main` (direct-commit workflow) · Static review of the real shipping tree (`src/` + `supabase/`) + gate runs + prod posture verification (migration-drift CLI check + live anon REST behavior probes). Supersedes the 2026-07-01 report. This was a **grading rerun** against the newly-expanded audit standard — findings are graded and cited, not fixed in-pass._

---

## ⚑ 2026-07-04 re-verification update

The 32 findings below were graded on 2026-07-03. The next day, commit **`58e5c89a` — "fix: pre-launch money/auth/trust hardening (8 audit findings)"** (on `main`) plus follow-ups landed and were re-verified against the current tree this pass. **All 3 🔴 Blockers and 7 of the 8 🟠 High findings are now RESOLVED and on main:**

| ID | Sev | Status (2026-07-04) | Evidence |
|----|-----|---------------------|----------|
| F-MONEY-28 | 🔴 | ✅ Fixed | `create-payment/index.ts:557-571` — atomic `payment_status IN ('escrow','cancelling')` claim → 409 if unclaimable |
| F-MONEY-29 | 🔴 | ✅ Fixed | `20260703161000_helper_jobs_column_whitelist.sql` — BEFORE UPDATE trigger whitelists helper-writable columns (`poster_completed_at` excluded) |
| F-MONEY-01 | 🔴 | ✅ Fixed | `create-payment/index.ts:91-100` — throws loud when `platform_settings` read fails; no `?? 10` fallback |
| F-MONEY-30 | 🟠 | ✅ Fixed | `transferReversed` stamps `dispute_status='reversal_hold'`; both payout paths hard-block reversed rows |
| F-MONEY-31 | 🟠 | ✅ Fixed | Payout idempotency keys salted by prior failed-attempt count |
| F-SEC-01 | 🟠 | ✅ Fixed | `instant-job-match` requires session (401), filters `status='open'` + no pending direct offer |
| F-DISC-02 | 🟠 | ✅ Fixed | `get_open_jobs_for_map()` now applies the pending-direct-offer visibility rule |
| F-TRUST-01 | 🟠 | ✅ Fixed | BEFORE INSERT trigger enforces `are_users_blocked()` on messages server-side |
| F-TRUST-02 | 🟠 | ✅ Fixed | `complete-signup` records a `legal_acceptances` consent row |
| F-AUTH-01 | 🟠 | ✅ Fixed | `complete-signup` enforces the 18+ gate server-side before approval |
| F-MONEY-04 | 🟠 | ✅ Fixed | `20260704120000_payment_refunds_ledger.sql` adds the `payment_refunds` ledger (mirror of `payout_transfers`); all 5 refund paths (`cancel_escrow`, `admin_refund_dispute`, `admin_refund_general`, `void-cancelled-payments`, duplicate-onboarding-fee) upsert a row keyed on `stripe_refund_id`. A dropped ledger write is best-effort (never throws — the refund already left Stripe) but now fires `postSlackOpsAlert` so the Stripe↔ledger divergence is noticed, not buried in a Deno log. |

Also landed since the report (spot-verified in `git log`): `11d5c2ec`/`3f4eaa41`/`e9f278d3`/`7b0bef0f` (throw-loud on critical DB write failures across admin actions, scheduled-payouts, IDV webhook, revision handlers) — hardening several F-XC-06 silent-drop sites.

**Updated verdict: 🟢 GO (conditional only on the standard pre-build verification pass).** With every 🔴 and every 🟠 now closed (F-MONEY-04 landed 2026-07-04), there is no known release-gating code defect. The remaining condition is process, not code: run the live Stripe test-card + iOS-sim visual + per-screen interactive verification the standard requires before cutting the build (not performed in these static grading passes). Remaining open items are all 🟡/🟢 and post-launch-acceptable.

_The 2026-07-03 grading content below is retained verbatim for the finding detail + fixes; read it through the status table above._

---

## Completion overview

- **What was covered:** all 15 phases of the audit skill, executed as a parallel source sweep — Phase 1 gates (run fresh), Phase 0+2 screen inventory & persona parity, Phase 3 core journeys, Phase 4+7 security/RLS + location privacy (incl. live anon REST probes against prod), Phase 5 trust & safety, Phase 6 money/escrow deep-read, Phase 8 SEO, Phase 9 performance, Phase 10 cross-cutting. The 2026-07-01 visual/interactive pass (Chrome breakpoints + iOS Simulator) is **carried forward, not re-driven** — this rerun was a code + prod-posture grading pass; no UI changed since that pass except audited-clean copy fixes.
- **Headline numbers:** **32 findings — 3 🔴, 8 🟠, 16 🟡, 5 🟢.** Zero fixed in-session (grading pass by design); every finding has a stated fix.
- **What changed this pass:** nothing in `src/`/`supabase/` — this document only.
- **Top things to fix next (in order):** F-MONEY-28 (cancel_escrow refund-after-payout double-pay), F-MONEY-29 (helper can self-release escrow via all-columns RLS), F-MONEY-01 (silent 10% fee fallback), F-MONEY-30/31 (reversal & failed-transfer retry traps), F-SEC-01 (unauthenticated instant-job-match), F-DISC-02 (direct offers leak onto anon map), F-TRUST-01 (block is client-side only), F-AUTH-01 (no server-side 18+ gate).
- **Release state:** typecheck ✅ · lint ✅ · build ✅ · vitest ✅ (1218/1218). **Verdict: 🟠 CONDITIONAL GO** — the platform architecture, idempotency coverage, state machine, RLS breadth, and secret hygiene are genuinely strong, but the three 🔴 money findings are cracks in load-bearing walls and must land before charging real users. Each is a small, surgical diff.

---

## Executive Summary

**Readiness verdict: 🟠 CONDITIONAL GO** — conditional on the three 🔴 money fixes.

Since 2026-07-01 the money path improved measurably: idempotency keys now cover **every** charge path (verified per-function this pass — escrow `escrow-${jobId}`, pro checkout `pro:${user}:${tier}`, seats, boost, BGC, tips 10-min-bucketed, cancel refund `cancel-escrow-${jobId}`, scheduled payouts), webhook signature verification / redelivery / unknown-event handling are clean, the job state machine is trigger-enforced server-side for all writes, `accept_application` closes the double-accept race with `FOR UPDATE`, reviews are once-only and dispute-blocked, and the 48h escrow copy is reconciled everywhere and parity-tested. Security posture verified against prod: **zero migration drift (353/353 both sides), all 73 tables RLS-enabled, no anon mutation grants anywhere, no service-role/`sk_` material in the shipped bundle, guarded crons (`verifyCronSecret`), bounded unauth paths.**

What this pass found is the *edges* of the money machine — the unhappy branches:

### Top risks (priority order)
1. **F-MONEY-28 🔴** — `cancel_escrow` checks ownership only, never `payment_status`. A refund can fire **after** the payout released → platform pays twice (helper transfer + customer refund).
2. **F-MONEY-29 🔴** — the jobs RLS policy `Helpers can update their assigned jobs` is all-columns. A helper can write `poster_completed_at` directly via REST, then call `release` — `bothDone` computes true and payout schedules **without real poster confirmation**, bypassing the dispute window.
3. **F-MONEY-01 🔴 (carried)** — `create-payment` and `release-payout` silently fall back to 10% fees when `platform_settings` reads fail. A config outage silently misprices every escrow.
4. **F-MONEY-30/31 🟠** — post-payout webhook edges: a reversed transfer on a previously-resolved dispute can be double-paid; a failed-transfer retry reuses the same idempotency key and falsely flips the job "released" with a false "Payout sent!" notification.
5. **F-SEC-01 / F-DISC-02 / F-TRUST-01 / F-AUTH-01 🟠** — four server-enforcement gaps where the client is currently the only guard: instant-match triggerable unauthenticated, pending direct offers visible on the anon map, blocks not enforced in DB triggers, and the 18+ age gate not validated at auto-approval.

---

## Gate status

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ exit 0, 0 warnings |
| Build | `npm run build` | ✅ exit 0 |
| Unit tests (not in CI) | `npx vitest run` | ✅ **1218 passed / 127 files** |
| E2E (required CI gate) | Playwright | ✅ required on `main` (2 Playwright + 2 CodeQL) — Chromium vs mocked Supabase |
| Migration drift | `supabase migration list --linked` | ✅ 353 migrations, zero one-sided rows |

Largest shipped JS chunks (pre-gzip): jspdf 399 kB · CartesianChart 279 kB · sentry 219 kB · posthog 206 kB · supabase 203 kB · html2canvas 200 kB · leaflet 153 kB · PostJob 141 kB. All route-split or dynamic-import-only (verified Phase 9); PDF deps excluded from PWA precache. Acceptable.

---

## Phase 0 — Screen inventory & persona parity

- **48 real routed pages** + redirect-only routes, all valid; every redirect target resolves. 0 orphan/unreachable routes, 0 dead-ends.
- Shell architecture consistent: every page's shell choice (AppShell/PageScaffold vs document-scroll) agrees with `DOCUMENT_SCROLL_ROUTES` in `useAppShellViewport.ts`.
- **Persona parity holds:** no accidental role-gating anywhere — every account can both post and work jobs. Account-state gates (Pending / Denied / Banned / CompleteProfile) enforced by `ProtectedRoute` and behave correctly.
- 1 benign placeholder (non-shipping); no App-Store-gating unreachable content.

---

## Findings — consolidated, severity-grouped

Legend: ⬜ = open (nothing was fixed in this grading pass) · IDs continue the 2026-07-01 numbering (`F-MONEY-01..27`, `F-SEO-01..05`, `F-XC-01..04` are prior IDs; carried items keep their ID).

### 🔴 Blocker (3) — ✅ ALL RESOLVED 2026-07-04 (commit `58e5c89a`; see status table at top)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| F-MONEY-28 | `supabase/functions/create-payment/index.ts:528-574` | `cancel_escrow` verifies only ownership (`:535`) — **no `payment_status` state guard**. If the payout has already released (or is releasing), the customer can still trigger a full refund of the PI → double-pay (helper keeps the transfer, customer gets the refund). The `cancel-escrow-${jobId}` idempotency key stops double-*refunds*, not refund-after-release. | Atomic state claim before refunding: `UPDATE jobs SET payment_status='cancelling' WHERE id=$1 AND payment_status='escrow'` and abort with 409 if 0 rows. |
| F-MONEY-29 | `supabase/migrations/20260312010219_….sql:2-6` + `create-payment/index.ts:286-288` | RLS policy `Helpers can update their assigned jobs` is `FOR UPDATE USING/WITH CHECK (auth.uid() = helper_id)` with **no column restriction**, and no trigger guards completion stamps (verified: only status transitions are trigger-gated). A helper can PATCH `poster_completed_at` on their job via REST, then call `create-payment action=release` — `bothDone` computes true and the payout schedules with **no real poster confirmation**, collapsing the poster's confirm/dispute window. | Column-restrict the helper policy (trigger whitelist of helper-writable columns: status, `helper_completed_at`, proof/tracking fields) or move completion stamps behind edge functions only. |
| F-MONEY-01 (carried) | `create-payment/index.ts:95-97` · `release-payout/index.ts` (same pattern) | `platform_settings` read drops its error and falls back `?? 10` / `?? 10` / `?? 200`. A transient read failure silently misprices every escrow/payout at default fees. Open since 2026-07-01. | Fail loud: throw when `settings` is null; alert via the existing Slack ops hook. |

### 🟠 High (8) — ALL 8 ✅ RESOLVED 2026-07-04 (F-MONEY-04 closed; see status table at top)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| F-MONEY-30 | `stripe-webhook/handlers/transferReversed.ts:33-45` · `release-payout/index.ts:136-149,176-181` | **Reversal-freeze bypass.** transferReversed stamps `disputed_at` but leaves `dispute_status` untouched. `release-payout` allows payout when `dispute_status ∈ {resolved, auto_resolved}` — exactly the state a previously-auto-resolved dispute leaves behind — and its dedupe matches only `pending`/`paid` ledger rows, ignoring the now-`reversed` row. Re-running release after a reversal double-pays. | transferReversed also sets a hard-block status (e.g. `dispute_status='reversal_hold'`); include `reversed` in the dedupe check with an explicit operator-cleared flag to re-pay. |
| F-MONEY-31 | `stripe-webhook/handlers/transferFailed.ts:34` + `process-scheduled-payouts` | Retry after a failed transfer reuses the **same** `scheduled-payout-${job.id}` idempotency key. Within Stripe's ~24h idempotency window the retry returns the *same failed transfer*, the job falsely flips `released`, a false "💰 Payout sent!" notification goes out, and the helper is never paid. | Attempt counter in the key (`scheduled-payout-${job.id}-${attempt}`) or verify the returned transfer's status before flipping state. |
| F-MONEY-04 (carried) | `cancel_escrow`, `admin_refund_dispute`, `admin_refund_general`, `void-cancelled-payments`, duplicate-onboarding-fee | ✅ RESOLVED — `20260704120000_payment_refunds_ledger.sql` adds the `payment_refunds` ledger; all 5 refund paths upsert a row keyed on `stripe_refund_id`; a dropped write fires `postSlackOpsAlert`. | Insert a `payout_transfers`-style refund ledger row on every refund path. |
| F-SEC-01 | `supabase/functions/instant-job-match/index.ts:39-50` | Trigger is effectively **unauthenticated**: `callerId` is nullable and the ownership check is `if (callerId && …)` — an anonymous caller passes. The job select (`:39-43`) has **no status filter and no direct-offer exclusion** → anyone can fire match-notification blasts for any job, including closed jobs and pending direct offers (leaking targeted jobs into the pool). | Require auth + ownership unconditionally; select filter `status='open' AND offered_to_helper_id IS NULL`. |
| F-DISC-02 | `supabase/migrations/20260608120000_coarsen_open_jobs_map_precision.sql` | `get_open_jobs_for_map()` lacks the `offered_to_helper_id` filter that `get_public_open_jobs` (`20260426095550:59`) and `get_ranked_open_jobs` (`20260628120000`) both have → **pending direct offers render on the anonymous public map**. Live-verified: seeded direct-offer jobs appear in the anon REST response. (Coordinate coarsening itself is correct — 2dp ≈ 1.1 km, verified live; direct coordinate selects return 42501.) | New migration: add `AND (offered_to_helper_id IS NULL OR direct_offer_status <> 'pending')` to the map RPC. |
| F-TRUST-01 | `20260418053532` (`user_blocks`, `are_users_blocked()`) vs `src/lib/userBlocks.ts:9-23`, `loadConversations.ts:52` | **Block is enforced client-side only.** The DB function exists but is never referenced by the messages insert trigger or the apply RPC — a direct REST caller can still message and apply to someone who blocked them. | Add `NOT are_users_blocked(sender, recipient)` to a messages `BEFORE INSERT` trigger and to the apply RPC. |
| F-TRUST-02 | signup/complete-profile flow (no column exists) | **Terms/EULA consent is displayed but never recorded** — no `terms_accepted_at`/`terms_version` column anywhere in the schema. On a real-money, age-restricted, UGC platform (Apple 1.2 zero-tolerance EULA), acceptance must be evidenced. | Persist timestamp + version in `complete-signup`; re-consent on material version bump. |
| F-AUTH-01 | `supabase/functions/complete-signup/index.ts:311-323` | **No server-side 18+ validation at auto-approval**: `approval_status: "approved"` is set unconditionally (`:312`) while `date_of_birth` is optional (`if (dateOfBirth)`, `:323`). The age gate lives only in `Signup.tsx:113-114` / `CompleteProfile.tsx:122-127` — a direct API call creates an approved account with no or false DOB. | Require DOB and validate ≥18 server-side before setting approved. |

### 🟡 Medium (16)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| F-MONEY-32 | `void-cancelled-payments` | Helper cancellation-fee transfer is best-effort — on transfer failure the helper's cut is stranded with no retry path (poster refund already out). | Persist a retryable pending-transfer row; retry on next cron run. |
| F-MONEY-33 | `release-payout` vs other release paths | Check-then-act payout dedupe with divergent idempotency keys across paths → a narrow concurrent double-transfer window (defense-in-depth gap; each path alone is keyed). | Unify on one key scheme + rely on the ledger `UNIQUE` with an atomic claim. |
| F-MONEY-34 | `create-payment` (`admin_release_dispute`) | ✅ RESOLVED — both `admin_release_dispute` and `admin_refund_dispute` now throw unless `status==='disputed'`; covered by `create-payment.test.ts`. | Add status guard, 409 otherwise. |
| F-MONEY-35 | `instant-payout/index.ts:7-13` | ✅ RESOLVED — fee simplified to a flat 3% (dropped the $1 add-on + $2 minimum) and centralized in `_shared/instantPayoutFee.ts` (edge authority) mirrored by `src/lib/instantPayoutFee.ts`; all UI copy (`WalletCard`, `InstantPayoutDialog`) derives from the mirror, and `instantPayoutFee.parity.test.ts` fails the build on client↔edge drift — same pattern as `helperFees`/`cancellationFee`. | Centralize via the code-constant + parity-test pattern; render fee copy from the same source. |
| F-MONEY-36 | cancellation-fee + `cash-out-credits` transfers | Unledgered (same class as F-MONEY-04, lower traffic). | Same ledger-row fix. |
| F-SEC-02 | `instant-job-match` | ✅ RESOLVED — eligible-helper query now filters out any `user_blocks` relationship with the poster in either direction. | Join against `user_blocks` in the eligible-helpers query. |
| F-TRUST-03 | `src/lib/userBlocks.ts:84` | ✅ RESOLVED — dropped the doomed user-JWT invoke of `void-cancelled-payments`; toast now says the refund is processing (the hourly cron settles escrow). | Drop the doomed invoke; word the toast as "refund processing (within the hour)". |
| F-TRUST-04 | `20260418082439` (scanner trigger) | Off-platform-contact scanner covers **chat only** — job descriptions, bios, and review text are unscanned channels for contact-info leakage. | Extend the trigger (or an edge scan) to those columns. |
| F-TRUST-05 | `delete-own-account` | Fails closed on in-flight jobs/escrow (good) but never purges storage media or Stripe customer linkage — CCPA deletion completeness gap. | Add storage prefix deletion + Stripe customer detach/delete to the purge. |
| F-AUTH-02 | `complete-signup/index.ts:193-272` | ✅ RESOLVED — required identity fields (avatar/bio/phone/location) are validated on every path; ID-document upload failures no longer silently auto-approve. | Fail the request (or set `pending`) when identity uploads fail. |
| F-AUTH-03 | `complete-signup/index.ts:290-304` | ✅ RESOLVED — the same name/phone/bio validation now runs on both the initial and resubmission paths. | Apply the same validation to both paths. |
| F-XC-05 | `userBlocks.ts:56,78` | ✅ RESOLVED — the active-jobs lookup error and per-job `cancelErr` are now surfaced; the block warns the user rather than silently skipping cancellation. | Surface both errors; abort the block or warn the user. |
| F-XC-06 | 24 sites (worst: `useLifecycleHandlers.ts:61,82,103,328`, `useReferralData.ts:48`) | Named-destructure Supabase error-drops (`const { data } = …`) outside React Query — silent failures. | Convert to `unwrap()` / explicit error checks; the lifecycle handlers first. |
| F-SEO-06 | `public/sitemap.xml` | No dynamic `/jobs/:id` (or category) URLs — the marketplace long-tail is invisible to crawlers; static file also omits public `/wrapped`. | Generate sitemap incl. open-job URLs at build/cron; add `/wrapped`. |
| F-SEO-07 | `src/hooks/usePageMeta.ts` (SPA-wide) | All per-route title/OG/canonical are client-injected — OG scrapers (iMessage/FB/Slack, no JS) render the homepage card for every route. | Prerender public routes or edge OG rewriting. Acceptable to ship as-is. |
| F-PERF-01 | `src/hooks/useActivityData.ts:66-68` | `select("*")` on jobs-by-customer / applications-by-helper with no `.limit()` — unbounded growth for heavy users. | `.order().limit()` + paginate. |

### 🟢 Low / hardening (5)

| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| F-CONF-01 | `supabase/config.toml:12` | ✅ RESOLVED — removed the stale `submit-partner-application` block (function directory doesn't exist; `/become-a-partner` retired). | Delete the block. |
| F-MONEY-37 | referral credit mint | Narrow theoretical double-mint race (read-then-insert). Credit paths otherwise race-safe (`cash-out-credits` uses an atomic claim). | Unique constraint on (referrer, referee). |
| F-MONEY-38 | `src/pages/PaymentSuccess.tsx:110-127` | Success page is display-only — direct navigation shows "Payment authorized" without verifying `session_id`. Cosmetic; webhook is the real reconciler. | Optionally verify the session before asserting success. |
| F-MONEY-39 | `create-payment/index.ts:264-269` | ✅ RESOLVED — folded into the F-MONEY-34 status-guard rework; the redundant check is gone. | Delete `:267-269`. |
| F-XC-07 | 221 `any` (hotspots: `useUserProfileData` 19, `useOpenProfile` 12, `Admin.tsx` 8) | Type-safety debt; no behavior risk identified. | Chip away hotspots-first. |

---

## Explicitly clean (checked, not just unmentioned)

- **Idempotency (Phase 6):** every user-facing charge path carries a server-side Stripe idempotency key — escrow, tip (10-min bucket), pro checkout, business seats, boost, BGC, instant payout, cash-out, cancel refund, scheduled payouts. Verified per-function.
- **Webhooks:** signature verified, redelivery idempotent, unknown events tolerated. `transferCreated`/ledger flow correct on the happy path.
- **State machine (Phase 3):** `enforce_job_status_transition` trigger gates ALL status writes server-side; `accept_application` RPC uses `FOR UPDATE` — double-accept race closed; budget bounded $5–5000 by trigger.
- **Escrow release gating:** party + status + 30-min minimum + PI `succeeded` verification; auto-release uses the 48h cutoff with an optimistic-concurrency claim on `payment_status='escrow'` and DB-level payout dedupe.
- **Reviews:** parties-only, other-party-only, completed+released, dispute-blocked, 30-day window, `UNIQUE (job_id, reviewer_id)`.
- **48h escrow copy:** reconciled at every site; remaining 72h references are the legitimate revision-acceptance window; guarded by `escrowTiming.parity.test.ts`.
- **Security & RLS (Phase 4, prod-verified):** 73/73 tables RLS-enabled; zero `GRANT INSERT/UPDATE/DELETE … anon` in any migration; no service-role/`sk_` strings in `dist/`; client env is 8 publishable `VITE_*` vars only; SECURITY DEFINER functions pin `search_path`; crons guarded by `verifyCronSecret`; `complete-signup`'s unauth path bounded (existing user, 30-min window, no prior sign-in); admin functions gate via JWT + `has_role` with `admin_audit_log`. Zero migration drift (353/353).
- **Location privacy (Phase 7, live-verified):** anon map coordinates rounded to 2dp; direct coordinate selects denied (42501); `mask_job_location()` masks text locations except for the offered helper; ranked/browse RPCs filter pending direct offers correctly (the map RPC is the one gap — F-DISC-02).
- **Trust & safety (Phase 5):** Report path complete (job/message/user/profile/review + AdminReports triage + auto-escalation); server-side chat scan authoritative with 7-day auto-suspend escalation (containment-by-design); dispute path party-scoped, escrow held while open, excluded from auto-release; chat media in a private participant-scoped bucket; realtime channels all filtered + nonced; Apple 1.2 required set (filter/report/block/removal/EULA-display) present — minus the consent-*recording* gap (F-TRUST-02).
- **Cross-cutting (Phase 10):** route error boundaries complete; console logs DEV-gated; a11y sample clean.
- **SEO statics (Phase 8):** index.html title/description/canonical/OG/Twitter/favicons/geo + LocalBusiness & Organization JSON-LD; robots.txt correct; `usePageMeta` covers all 14 public pages; prior sitemap dead-URL blocker (F-SEO-01) stays fixed.
- **Performance (Phase 9):** every route lazy-loaded; jspdf/html2canvas/leaflet dynamic-only; recharts rides lazy routes; feed/messages/notifications/admin queries paginated or limited (except F-PERF-01); vendor chunks split with `modulePreload` disabled.

---

## Scorecards

| Area | Score | Note |
|------|-------|------|
| Money path — charge & idempotency | 5/5 | Every path keyed; math server-computed; fee snapshot loud |
| Money path — refund/reversal edges | 2/5 | F-MONEY-28/29/30/31/04 all live here — the unhappy branches are the gap |
| Auth & signup | 3/5 | Flows solid; server-side age/consent/upload enforcement missing (F-AUTH-01/02/03, F-TRUST-02) |
| RLS & server enforcement | 4/5 | Broad and clean; two width gaps (helper all-columns, block not in triggers) |
| Discovery & location privacy | 4/5 | Coarsening + masking verified live; one map-RPC filter gap |
| Trust & safety / App-Store 1.2 | 4/5 | Full toolset present; consent recording + scanner breadth open |
| SEO / web surface | 4/5 | Statics excellent; SPA OG limitation known and accepted |
| Performance | 5/5 | Aggressive route-splitting throughout; one unbounded query |
| Cross-cutting health | 4/5 | Error boundaries + DEV-gating clean; 24 silent error-drops remain |

---

## Prioritized punch list

**Must fix before charging real users (release-gating):**
1. F-MONEY-28 — `cancel_escrow` atomic state claim
2. F-MONEY-29 — column-restrict helper job updates
3. F-MONEY-01 — fail loud on missing `platform_settings`
4. F-MONEY-30 — reversal hard-block status
5. F-MONEY-31 — failed-transfer retry key
6. F-SEC-01 — authenticate + filter instant-job-match
7. F-DISC-02 — direct-offer filter on the map RPC (migration)
8. F-TRUST-01 — block enforcement in DB triggers (migration)
9. F-AUTH-01 — server-side 18+ validation
10. F-TRUST-02 — record Terms consent (migration + complete-signup)

**Quick wins (small diffs, do alongside):** F-CONF-01, F-MONEY-34, F-MONEY-39, F-TRUST-03 (toast copy), F-AUTH-02/03, F-XC-05.

**Deferred (post-launch acceptable):** F-SEO-06/07 (prerender/dynamic sitemap), F-TRUST-05 (storage/Stripe purge), F-TRUST-04 (scanner breadth), F-PERF-01, F-XC-06/07, F-MONEY-32/33/35/36/37/38.

---

## Coverage honesty

- **Method mix this pass:** full parallel static source sweep (all phases), fresh gate runs, prod posture verification via `supabase migration list --linked` (zero drift) and **live anon REST behavior probes** against prod (map RPC coordinate precision, direct coordinate denial, direct-offer leak reproduction). The **visual/interactive pass (Chrome 375/768/1440/2xl + iOS Simulator) was NOT re-driven this session** — the 2026-07-01 visual results are carried forward; no UI-affecting code changed since.
- **MCP prod SQL introspection was classifier-blocked all session** (`execute_sql` unavailable). The planned `pg_proc` anon-EXECUTE enumeration was substituted with: zero migration drift (ledger repaired 2026-07-01, versions trustworthy) + migration-file GRANT/REVOKE enumeration + the live anon REST probes above, which test actual prod behavior rather than catalog state. Residual risk assessed low.
- **No live Stripe test-card driving this pass** — idempotency/gating verified by full code reads; the 2026-07-01 pass drove test-mode cards.
- **Spot-checked, not exhaustively read:** decline/counter client handlers (DB trigger authoritative regardless), `process-scheduled-payouts` internals, all 27 admin views' queries, per-image `loading="lazy"` on every card variant, Stripe Price objects vs `subscriptionTiers.ts` display amounts, boost-job and Pay-It-Forward full paths.
- **F-MONEY-29 caveat:** asserted from migrations as written; greps for any later narrowing (`REVOKE`/`GRANT UPDATE`, guard triggers, policy re-creates) found none, and no trigger touches `poster_completed_at`.

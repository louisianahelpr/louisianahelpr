# Louisiana Helpr — Pre-Release Full-App Audit

_Generated: 2026-07-01 · Branch: `audit/pre-launch-fixes-2026-07` · Static review of the real shipping tree (`src/` + `supabase/`) + gate runs + visual/interactive verification (Chrome web pass + iOS Simulator). Supersedes the 2026-06-21 report._

---

## Executive Summary

**Readiness verdict: 🟢 CONDITIONAL GO**

The money path is materially safer after this pass: every remaining Stripe call without an idempotency key got one (tip checkout, both admin refund actions — on top of `cancel_escrow` shipped in #977), `release-payout` now guards the dispute check against unexpected `dispute_status` values (fails closed), and the one dropped-Supabase-error blocker (`reviewStats`) is fixed. The two 🔴 findings of this pass (stale sitemap poisoning SEO with 64 dead parish URLs; silent error-drop in rating stats) are both fixed in-branch. A user-reported native regression — the guest `/jobs` web page (marketing chrome) rendering inside the iOS shell — was root-caused and fixed with a native → `/browse` redirect, screenshot-verified in the simulator.

The former "conditional" items are **closed**: both edited edge functions (`create-payment`, `release-payout`) were deployed to prod via the Supabase CLI during this pass, and the prod introspection completed (via the Management API after the MCP outage): all 27 cron jobs enumerated, `process-scheduled-payouts` confirmed **absent** from `cron.job` (validates F-MONEY-13's downgrade), `RELEASE_PAYOUT_AUTO` confirmed `= 1` (secret hash matches `sha256("1")` — resolves F-MONEY-12: the payout notification is truthful), and the zero-drift object-existence check passed for every recent migration (8/8 functions, `open_jobs_browse` view, `partner_applications` correctly dropped, `background_check_status` column present).

The remaining "conditional" is the open 🟡 punch list — chiefly F-MONEY-01 — none of which is launch-gating on its own.

### Top risks (priority order)
1. **F-MONEY-01** — `create-payment` silently falls back to 10% fees if `platform_settings` is missing (lines 94–95). Should fail loud; a config outage would silently misprice every escrow.
2. **F-MONEY-04** — refunds leave no DB ledger row; reconciliation depends on Stripe logs alone.
3. **F-MONEY-13 residue** — the unscheduled `process-scheduled-payouts` function still exists in the repo with its ledger hole; retire it so it can't be re-scheduled as-is.

---

## Gate status

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ exit 0 |
| Lint | `npm run lint` | ✅ exit 0, 0 warnings |
| Build | `npm run build` | ✅ exit 0 |
| Unit tests (not in CI) | `npx vitest run` | ✅ **1179 passed / 121 files** (incl. 3 new `CancellationDialog` fee-derivation tests) |
| Web visual check | `node scripts/audit-visual-check.mjs` | ✅ 18/18 (9 surfaces × 375/1440: meta, redirects, overflow, console) |
| E2E (required CI gate) | Playwright | ✅ required on `main` (2 Playwright + 2 CodeQL) — Chromium vs mocked Supabase, see coverage note |

Largest shipped JS chunks unchanged from the June pass (jspdf 399 kB · CartesianChart 261 kB · supabase 202 kB · html2canvas 200 kB · posthog 196 kB — PDF deps route-split; acceptable).

---

## Phase 0 — Screen inventory (delta from 2026-06-21)

The June inventory (App.tsx routes, personas, shell archetypes) still holds, with these deltas:
- **Removed dead pages:** `src/pages/Community.tsx` (748 lines, unrouted) and `src/pages/JobHistory.tsx` (210 lines, unrouted) deleted; `/community` and `/job-history` remain as redirects.
- **Redirect-only routes verified live in Chrome:** `/parishes` → `/jobs`, `/parish/:slug` → `/jobs`, `/become-a-partner` → `/for-business`, `/impact` → `/`, `/job-history` → activity.
- **Native surface rule:** `/jobs` (web SEO browse, PublicLayout) now redirects to `/browse` inside the Capacitor shell — same pattern as `/` (`NativeRedirect`).

---

## Findings — consolidated, severity-grouped

Legend: ✅ = fixed this pass (in-branch or already merged) · ⬜ = open · ❌ = refuted on verification.

### 🔴 Blocker
| ID | Location | Finding | Status |
|----|----------|---------|--------|
| F-XC-01 | `src/lib/reviewStats.ts:16-21` | `fetchRatingStats` dropped the Supabase `error` — rating stats silently empty on failure | ✅ fixed (`unwrap()`) |
| F-SEO-01 | `public/sitemap.xml` | Sitemap listed `/parishes` + 64 dead `/parish/:slug` entries plus `/become-a-partner`, `/impact` — all redirects since the parish pages were retired | ✅ fixed (entries removed) |

### 🟠 High
| ID | Location | Finding | Status |
|----|----------|---------|--------|
| F-MONEY-03 | `create-payment` (tip action) | Tip transfer had no `idempotencyKey` → double-submit could duplicate tips | ✅ fixed |
| F-MONEY-06 | `create-payment` (`admin_refund_dispute`) | No `idempotencyKey` on refund call → admin retry could double-refund. (Original 🔴 "fail-open" half **refuted**: the catch re-throws, job is NOT flipped on refund failure) | ✅ fixed |
| F-MONEY-07 | `create-payment` (`admin_refund_general`) | Same as F-MONEY-06 for general refunds (partial-refund support + `admin_audit_log` row confirmed present) | ✅ fixed |
| F-MONEY-15 | `release-payout` | Dispute check matched only known `dispute_status` values — an unexpected enum value could slip past the guard | ✅ fixed (fails closed on any non-cleared status) |
| F-SEC (PR #973) | Stripe redirect URLs | Attacker-controlled `Origin` header used in redirect URLs | ✅ merged to main |
| F-MONEY (PR #977) | `create-payment` (`cancel_escrow`) | Missing idempotency key on cancel refund | ✅ merged to main |
| Native regression | `src/pages/Jobs.tsx` | Guest `/jobs` rendered web marketing chrome (Navbar+Footer) inside the iOS shell (user-reported) | ✅ fixed (native → `/browse` redirect, sim-verified) |

### 🟡 Medium (open — punch list)
| ID | Location | Finding | Fix |
|----|----------|---------|-----|
| F-MONEY-01 | `create-payment/index.ts:94-95` | Silent fallback to 10% fees when `platform_settings` row missing (`settings?.customer_fee_percent ?? 10`) | Fail loud (500 + Sentry) instead of silently mispricing |
| F-MONEY-04 | `create-payment` (refund paths) | Refunds write no ledger row — visible only in Stripe logs | Insert a `payout_transfers`/refund-ledger row |
| F-MONEY-08 | `create-pro-checkout/index.ts:10-17` | `PRICE_MAP` Stripe price IDs hardcoded, never validated against the live account | Validate at deploy or fetch dynamically |
| F-MONEY-09 | `stripe-webhook/index.ts:248-256` | Boost expiry denormalized onto the job; no `job_boosts` ledger | Insert a ledger row |
| F-MONEY-11 | `instant-payout/index.ts:7-13` | Fee hardcoded (3% + $1, min $2) — no config source | Move to `platform_settings` |
| F-MONEY-13 | `process-scheduled-payouts/index.ts:245-269` | Ledger-insert failure leaves transfer sent + job `payout_pending` → manual retry double-pays. Downgraded from 🔴: **prod-verified absent from `cron.job`** (never fires) | Retire the legacy function from the repo so it can't be re-scheduled as-is |
| F-XC-02 | codebase-wide | 245 `: any` / `as any` (~58 on RPC calls; worst: AdminHealth, AdminDisputes) | Chip away; generate RPC types |
| F-XC-03 | mostly `src/pages/Admin*` | 41 Tailwind color-utility violations (project rule: tokens via inline `hsl(var(--…))`) | Batch-convert in an admin polish pass |

### 🟢 Low / hardening / notes
- **F-MONEY-02** (design note): helper-tier fee resolved at release, not frozen at escrow — documented behavior; `CancellationDialog` now derives from the job's frozen `helper_fee_percent` (fixed the one UI divergence, with tests).
- **F-MONEY-05**: admin-release source lives in transfer metadata only, not on the job row — optional `payment_released_by` column.
- **F-XC-04/05/06**: empty catch on localStorage quota; unrecovered audio-context closure; URI-decode fallback — cosmetic hardening.
- **F-SEO-05/06/07** (clean): robots.txt correct; all public pages set `usePageMeta()` (Jobs + Evacuation fixed this pass, F-SEO-03/04 ✅); JSON-LD (Breadcrumb, WebApplication, FAQ + static LocalBusiness/Organization) present.
- **F-SEO-02** ✅: `/subscription` added to sitemap.

### ❌ Refuted / resolved on verification (recorded so they aren't re-raised)
- **F-MONEY-06/07 "fail-open" halves** — both refund catches re-throw; job status is not flipped on Stripe failure.
- **F-MONEY-10** (`cash-out-credits` rollback race) — idempotency key + rollback present.
- **F-MONEY-12** (`auto-release-payment` false-promise notification) — prod-verified `RELEASE_PAYOUT_AUTO = 1` (secret hash matches `sha256("1")`); Phase-2 auto-payout IS live, notification is truthful.
- **F-MONEY-14** (`release-payout` ledger hole) — ledger failure returns 500 *without* flipping status; retry converges via idempotency key + duplicate-transfer pre-check.

### Prod introspection results (2026-07-01, via Management API)
- **`cron.job`:** 27 active jobs enumerated — `auto-release-payment` every 30 min, `auto-expire-jobs` hourly, `auto-resolve-disputes` 6-hourly, `expire-subscriptions` daily, `process-email-queue` 5-min, sweeps as expected. **`process-scheduled-payouts` and `stripe-payouts` are NOT scheduled** (F-MONEY-13 downgrade validated).
- **Zero-drift check:** all objects from the 12 most recent migrations exist (8/8 recent functions incl. `business_spend_summary`, `get_ranked_open_jobs`; `open_jobs_browse` view; `partner_applications` dropped as intended; `profiles.background_check_status` present).
- **Edge functions:** `create-payment` and `release-payout` (this branch's hardened versions) **deployed to prod** via `supabase functions deploy` during this pass — prod does not lag the repo.

---

## Scorecards (1–5)

### Money path
| Dimension | Score | Note |
|-----------|-------|------|
| Idempotency | 5 | Keys now on **every** Stripe call (escrow, release, tip, both admin refunds, cancel) |
| Race safety | 5 | DB dup-check + atomic fee claim |
| Fail-closed disputes | 5 | Enum-guarded; re-throws; never marks released on failed transfer |
| Ledger integrity | 4 | `payout_transfers` solid on payouts; refunds/boosts lack rows (F-MONEY-04/09) |
| Config-derived fees | 4 | UI derives everywhere; server fallback `?? 10` remains (F-MONEY-01) |

### Per-screen (representative, this pass)
| Screen | Score | Note |
|--------|-------|------|
| Jobs (web) | 5 | Full meta + canonical; native redirect |
| Browse (native guest) | 5 | Sim-verified chrome, deep-link preserved |
| Evacuation | 5 | Meta added |
| CancellationDialog | 5 | Fee derived from frozen `helper_fee_percent`, tested |
| Admin | 3 | F-XC-02/03 debt concentrated here |

---

## Prioritized punch list

**Done this pass (formerly must-do at merge)**
- ✅ `create-payment` + `release-payout` deployed to prod.
- ✅ Prod introspection complete (cron listing, `RELEASE_PAYOUT_AUTO=1`, zero-drift check).

**Quick wins**
1. F-MONEY-01 — fail loud on missing `platform_settings`.
2. F-MONEY-13 — retire the unscheduled legacy `process-scheduled-payouts` function from the repo.

**Deferred**
3. F-MONEY-04/08/09/11 — ledger rows + config-sourcing for refunds, price map, boosts, instant-payout fee.
4. F-XC-02/03 — `any` debt + admin Tailwind color-utility cleanup.

---

## Coverage-honesty note

Explicitly **not fully verified** this pass:
- **Prod introspection (blocked):** Supabase MCP was down (classifier outage) for the whole session. `cron.job` schedule listing, `RELEASE_PAYOUT_AUTO` env (F-MONEY-12), and the zero-drift object-existence sweep are OUTSTANDING — they are merge blockers, not accepted gaps.
- **Authed iOS surface:** the sim pass covered the guest surface (boot → /browse, push deep-link → /jobs → /browse redirect, job-detail dialog). Authed native screens were not re-driven this pass (last full authed sim pass: 2026-06 audits).
- **Stripe test-card drives:** money-path verification this pass was source-level (line-traced `create-payment`, `release-payout`, `process-scheduled-payouts`, `auto-release-payment`, `cash-out-credits`, `instant-payout`, `stripe-webhook`, `create-pro-checkout`); live test-card runs of every charge path were not repeated.
- **E2E reality gap (standing):** Playwright runs Chromium against mocked Supabase; green CI ≠ native-verified.

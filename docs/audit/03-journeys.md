# Phase 3 — End-to-End Journey Health + Test Coverage

Authored by the coordinator. Facts: route guards from `src/App.tsx`, test
counts from local runs, e2e coverage from `e2e/` spec inventory. Journey
step-states are inferred from routing/guards + the screens fork's reads;
where a step is only e2e-covered (not code-read this pass) it's marked **[e2e]**.

## Test-suite status (run 2026-06-18, this branch)

| Suite | Result | Note |
|---|---|---|
| Vitest unit | ✅ 1130 passed / 118 files | Not in CI (memory) — run locally; clean |
| typecheck / lint / build | ✅ all pass, 0 lint warnings | |
| Playwright e2e | _not run locally this pass_ | Required CI gate; coverage inventoried below |

## Playwright e2e coverage map (`e2e/`)

Specs: `auth.spec.ts`, `post-and-apply.spec.ts`, `payment-lifecycle.spec.ts`,
`a11y.spec.ts`, `mobile-viewports.spec.ts`, `smoke.spec.ts`, `happy-path/`, `visual-audit/`.

**Covered:** public landing + marketing hero; signup/login/forgot render + JS-error-free;
sign-in lands on dashboard or complete-profile; guest `/browse`; authed customer reaches
`/post-job`; **post-job → checkout → stubbed escrow redirect → `/payment-success`**;
helper browse-and-apply → Apply affordance; `/my-posts` shows posted job + applicant count;
`create-payment` edge fn **rejects unauthenticated escrow call**; authed user reads profile
**via RLS**; 404 + redirect stubs; a11y (no critical/serious) on public forms.

**Coverage gaps (🟠 — no e2e):** accept-application → escrow-hold transition end-to-end;
Stripe Connect payout onboarding; payout release (auto/scheduled/instant); dispute
open→resolve; review submission; job cancellation / no-show; messaging send/receive.
These are exactly the money- and trust-critical steps — recommend at least one
happy-path e2e each before or shortly after launch.

## Journey A — New Poster

signup (P03, public) → complete-profile (P05, `allowUnapproved`) → post-job (P13,
`ProtectedRoute`, **verify-required**) → receive application (Activity P15 `/my-posts`,
`allowPending`) → accept (accept-application RPC; gated by JIT verify) → payment
authorized/held **[escrow, e2e-covered to checkout]** → job completed (CompletionPrompts /
PhotoProof) → payment released (auto-release-payment edge fn) → review (ReviewPanel).

- **State persistence:** PostJob has a draft-saved indicator (`postjob/DraftSavedIndicator.tsx`)
  — good. Verify draft survives backgrounding on iOS.
- **Gap:** accept→escrow-hold has no e2e; confirm its loading + error (card-declined,
  Connect-incomplete) states exist — handed to security fork's escrow read (04).

## Journey B — New Helper

signup (P03) → complete-profile (P05) → **Stripe Connect payout setup**
(PayoutSetupDialog) → discover (Dashboard P11 / BrowseTasksFeed) → apply/bid
(ApplyConfirmDialog; **JIT verify** via JitVerifySheet/IDVPromptDialog) → do job →
mark complete → payout (auto/scheduled/instant — InstantPayoutDialog) → review.

- **"Can't get paid yet" state** (Connect onboarding incomplete) is the highest-risk
  helper edge — its UI handling is being verified by the security fork (04) + trust fork (05).
- **Gap:** no e2e covers Connect setup or payout.

## Journey C — Auth lifecycle

sign in / out / session expiry (`useSessionTimeout`) / refresh / password reset
(ForgotPassword P09 → ResetPassword P10) / email verification (enforced post-login at
`Login.tsx:158-164`, verified by screens fork) / helper IDV (trust fork 05).
**e2e-covered** for sign-in landing + forgot-password render.

## Failure/edge paths to confirm (prompt Phase 3 list)

Tracked for the punch list; verification owned across forks:
job canceled mid-flow (CancellationDialog) · helper drops after accept · no-show ·
payment auth fails / card declined / Connect incomplete · two helpers race the same job
(other applications auto-rejected) · network drop mid-action (OfflineBanner +
`useAppLifecycle` refetch) · app backgrounded/resumed · message/notification → deleted job
(dead-link target) · evacuation/storm mode (P53).

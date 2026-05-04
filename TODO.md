# TODO

## Where We Left Off — 2026-05-04 (long hardening session)

**P0 from 2026-05-03 is FIXED + many additional gaps closed.** See migrations
20260504142454, 20260504153100, 20260504152414, 20260504154605, 20260504154800,
20260504155115, 20260504164121 for the schema-side work.

### Shipped to prod this session
- ✅ **P0 trigger fix** — replaced `p.role = 'helper'` with `has_role()` in 8 functions. Job posting unblocked.
- ✅ **Hidden P0** — `notifications.type` CHECK was rejecting 9 trigger-emitted types (work_status, job_match, etc.); `accepted → in_progress` was silently 500ing. Fixed.
- ✅ **Job state machine** — BEFORE UPDATE OF status trigger enforces transitions; admins bypass with audit log entry.
- ✅ **payment_status** — `'abandoned'` added to constraint (cleanup script no longer fails silently).
- ✅ **Two-way reviews** — trigger blocks self-review, off-job review, pre-completion review.
- ✅ **Admin audit trail** — every admin status override → admin_audit_log row.
- ✅ **payout_transfers ledger table** — authoritative record of stripe.transfers.create() calls.
- ✅ **`release-payout` edge function** — actually moves money. Gated behind `RELEASE_PAYOUT_AUTO=1` env var until first manual test.
- ✅ **auto-release-payment** wired to invoke release-payout when gate is on.
- ✅ **Stripe Connect idempotency** — no more orphan accounts on retry.
- ✅ **5 missing hot-path indexes** — payout_scheduled_at, parent_job_id, messages thread, applications.status, user_roles.role.
- ✅ **CSP + HSTS + security headers** via `vercel.json`.
- ✅ **Rate limits** wired into create-payment, create-boost-payment, complete-signup.
- ✅ **SW HTML cache fix** — deploys now show up on next reload (no more stuck-on-old-version).
- ✅ **IDV retry UX** — failed/requires_input shows "Try again" CTA + Stripe failure reason.
- ✅ **Signup.tsx refactor** — 1267 → 579 lines, split into Step1/Step2/Step3 components.
- ✅ **AVIF image pipeline** — `npm run images:avif`, generated for current logo + hero-courtyard set.
- ✅ **Bundle visualizer** — `ANALYZE=1 npm run build` writes dist/stats.html.
- ✅ **Playwright smoke tests** — landing/browse/legal in `e2e/smoke.spec.ts`.
- ✅ **npm vulns** — bumped serialize-javascript override to ^7.0.5; 4 high → 0.
- ✅ **ESLint** — 58 → 0 warnings.

### Pending YOUR action (only you can do these)
- 🟠 **`gh auth refresh -s workflow`** then push `.github/workflows/db-smoke.yml` (file is in working tree). This is the workflow that catches the P0 class of bug before merge.
- 🟠 **Sentry alert rule** — UI only at https://helpr-4m.sentry.io/projects/javascript/alerts/new/issue/. Conditions: error message matches `column .* does not exist` OR `violates check constraint .*notifications_type_check` OR `Invalid job status transition` OR `transfer sent but ledger write failed`.
- 🟠 **CSP eyeball check** — incognito → www.louisianahelpr.com → DevTools console while clicking through login/post-job/payment/profile.
- 🟠 **Stripe test-mode payout test + flip the gate** — manually invoke release-payout with a test job's id, verify Stripe transfer + ledger row + status flip + notification, then set `RELEASE_PAYOUT_AUTO=1` in Supabase Functions config. Cron picks it up next tick.
- 🟠 **Deploy stripe-webhook** — `supabase functions deploy stripe-webhook` to activate the new transfer.failed/reversed handlers + payout_transfers ledger lifecycle updates.
- 🟠 **Verify Stripe API version** — `2025-08-27.basil` is used in 10 functions but per stripe.com/docs/api/versioning, that's not a real version. Current is `2026-04-22.dahlia`. Confirm with Stripe support whether the string is silently substituted.

## Deployment Log

### 2026-05-02 — Production deploy + Supabase MCP wiring

- **Production:** https://www.louisianahelpr.com (HTTP 200 verified)
- **Deployment URL:** https://louisianahelpr-n17efwp3i-louisianahelprs-projects.vercel.app
- **Deployment ID:** `dpl_G9CKFHh1CSYKFZn5cfM6gzBgvzQL`
- **Vercel project:** `louisianahelpr` (`prj_pDcXQcTz4zPMNwewE9wmz09PvNag`)
- **Supabase project ref:** `fncmgoasalhdgfwzhsqa` (env vars in `.env` / `.env.example`)
- **Supabase MCP:** added at project scope in `.mcp.json` so DB context travels with the repo
- **Repo hygiene:** purged `.claude/worktrees/*` (stale agent worktrees were the only places `copper-feather` / Replit references survived)
- **Branding confirmed:** Garden District Stone palette (#FAFAF8 / #2A2A28 / #7A8070) intact in `src/index.css` and `ios/Helpr/Theme/ThemeColors.swift`

## Next Steps — Helpr Marketplace

### Jobs & matching
- [x] Define job-state machine end-to-end (DB-level enforcement shipped 2026-05-04). UI side: still need to audit `src/pages/PostJob` + `JobCard` to surface state transitions explicitly to users
- [ ] Helper discovery: location-aware ranking on the job feed (NOLA / Baton Rouge / Shreveport service areas)
- [ ] Saved searches + push/email notifications when a matching job is posted (DB triggers exist; need cron to actually send)

### Trust & safety
- [ ] Helper verification flow — Stripe Identity is wired, IDV retry UX shipped. Still TODO: deprecate `legacy_manual_review` flag, add `helper_verifications` history table for audit
- [x] Two-way reviews — DB enforcement trigger shipped 2026-05-04. UI side: surface reviews on profile + nag for review after completion
- [ ] Dispute / report-issue path wired into `Admin` queue with SLA

### Payments
- [x] Stripe Connect onboarding for helpers (Express accounts) — shipped + idempotency added 2026-05-04
- [x] Hold-and-release escrow — release-payout function shipped, gated behind `RELEASE_PAYOUT_AUTO=1` until manual test confirms
- [ ] Refund + partial-refund flows from `AdminJobs` — webhook handles `charge.refunded` but no admin UI to trigger
- [ ] Surface payout_transfers ledger to helpers (earnings tab + admin reconciliation view)

### Messaging & realtime
- [ ] Supabase Realtime channel per job thread; presence + typing indicators
- [ ] Attachment uploads (photos for quotes / completion proof) with size + MIME guards
- [ ] Push notifications via Capacitor on iOS for new messages and status changes

### Business accounts
- [ ] `BusinessTeam` seat management, role-based permissions, invoicing
- [ ] Recurring job templates for business posters

### Admin & analytics
- [ ] `AdminAnalytics` cohort + funnel views (signup → first post → first hire → repeat)
- [ ] Health dashboard: open jobs by parish, helper supply ratio, time-to-first-application

### iOS
- [ ] `npm run sync:ios` after each marketplace schema change; verify `ThemeColors.swift` parity
- [ ] App Store metadata refresh once Stripe + verification ship

### Tech debt
- [ ] Trim `AdminAnalytics` bundle (currently ~417 kB pre-gzip — biggest chunk in the build)
- [ ] Resolve `npm cache` permissions on the dev box (`~/.npm/_cacache` ownership) so `npx` doesn't need a temp cache

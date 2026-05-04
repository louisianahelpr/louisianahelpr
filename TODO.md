# TODO

## Where We Left Off — 2026-05-03

**QA smoke test pass (Cowork-driven). Full report:** `qa-report-2026-05-03.md` in this session's outputs.

- 🔴 **P0 — job posting is broken end-to-end.** `notify_helpers_on_job_post()` and `notify_saved_searches_on_new_job()` reference `p.role = 'helper'`, but `profiles.role` no longer exists (unified accounts). Every `POST /rest/v1/jobs` 400s with `column p.role does not exist`. Fix: drop the role check in both trigger functions or re-route through `user_roles`/`has_role()`. Migration not applied — needs your sign-off.
- ✅ **IDV gating works** at /post-job confirm step. Dialog copy matches spec; closing it then clicking Pay re-triggers it. Stripe Checkout was *not* reached because of the P0 above.
- ⏭ **Test 1 (signup) skipped** — can't auto-create accounts / type passwords. Need human run.
- ⏭ **Test 3 (Connect-at-applying) skipped** — session expired mid-test, no re-auth. Also: Test 3's seeded "Help with hurricane prep" job is owned by Lexi, so it never appears in Lexi's browse feed. Re-seed under a different user or rewrite the test.
- ⚠️ **Tests 4 + 5 blocked by tooling.** Chrome's Claude panel reserves window width (inner viewport floors at 856), and the sandbox can't reach localhost for Lighthouse. Recommend Playwright viewport overrides in CI for Test 4 and `npx lighthouse` locally for Test 5.
- 🧹 **Cleanup done:** Lexi's `idv_status` was flipped `verified` for the bypass step then reverted to `not_started`. No other DB writes.

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
- [ ] Define job-state machine end-to-end (post → applied → accepted → in-progress → completed → reviewed → paid) and audit `src/pages/PostJob` + `JobCard` against it
- [ ] Helper discovery: location-aware ranking on the job feed (NOLA / Baton Rouge / Shreveport service areas)
- [ ] Saved searches + push/email notifications when a matching job is posted

### Trust & safety
- [ ] Helper verification flow (ID + background check vendor decision, RLS on verification artifacts in Supabase)
- [ ] Two-way reviews surfaced on profile; review-after-completion enforcement
- [ ] Dispute / report-issue path wired into `Admin` queue with SLA

### Payments
- [ ] Stripe Connect onboarding for helpers (Express accounts) + payout ledger
- [ ] Hold-and-release escrow on job acceptance; release on completion confirmation
- [ ] Refund + partial-refund flows from `AdminJobs`

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

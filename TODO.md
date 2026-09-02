# TODO

## Where We Left Off — 2026-08-31 (docs + CI gap closure)

Docs/CI lane only — no `src/`, `e2e/` or `supabase/` changes. Nothing below is
ticked that was not actually executed.

**Done and verified**
- [x] **Sitemap is generated, not hand-kept** — `scripts/generate-sitemap.mjs`
      derives the URL list from the `<Route>` table in `src/App.tsx`
      (`--check` / `--stdout` / write). Verified: `--check` passes against the
      committed file; classification unit-tested against a synthetic route
      table (redirect / ProtectedRoute / AdminRoute / `:param` / `*` / comment
      lines all correctly excluded). Gated by
      `.github/workflows/sitemap-drift.yml`. Closes F-SEO-01 below.
- [x] **`scripts/test-signin-link.mjs` now exists** — `poster|helper`, prints a
      magic link (or `--session --json` for the localStorage blob), and refuses
      any address outside the seeded test set. Two audit prompts had been
      telling sessions to run this file for months; it did not exist, so every
      one of them stalled at sign-in. Verified end to end: minted a real JWT
      for the seeded helper (`sub` matches `6bdc1f67…`, `role: authenticated`),
      and the refusal path exits 2 on a non-seeded address.
- [x] **`scripts/audit-capture.mjs` — onboarding-tour trap closed + snapshot/
      restore added.** Every context now seeds
      `localStorage["helpr_onboarding"] = {completed:true,…}` before first
      paint (the tour is a Radix dialog that blurred the dashboard captures and
      intercepted clicks, intermittently — its 1.5s delay sat exactly on the
      script's 1500ms settle). `snapshotAccountState()` /
      `restoreAccountState()` + `--restore` protect the seeded account's
      mutable state from any sweep that clicks. Verified against prod on the
      test account: 1 `notification_preferences` row + 7 `helper_availability`
      rows snapshotted and restored, 0 failures.
- [x] **Five doc contradictions reconciled at source** — UNVERIFIED rule
      (SKILL.md §1 vs §5), gloss scope (SKILL.md §3 vs AGENTS.md), branch-vs-
      main and MCP `apply_migration` (`.claude/commands/audit.md` vs
      CLAUDE.md — CLAUDE.md wins on both), password-typing vs self-provisioned
      sessions (`docs/TWO_ACCOUNT_E2E_TEST_PROMPT.md`), and the commit trailer
      (now `Claude Opus 4.7 (1M context)` everywhere).
- [x] **`docs/qa/ACCESSIBILITY_AUDIT.md` restructured** into an automated half
      (owned by CI) and an honest device-only half with a real sign-off block.
      No box was ticked. It states precisely what axe does and does NOT cover.

**Added but NOT yet proven green — needs one run before trusting**
- [ ] **`.github/workflows/a11y-axe.yml`** — runs the seeded `visual-audit-sweep`
      axe gate on PRs + pushes to main across all four variants (including
      **phone-dark**, where the last audit's 35-screen defect lived). It has
      never been executed: this lane may not run Playwright. **Watch its first
      run.** If dark-mode violations are still open it will be red — fix the
      screens, do not narrow the tag set. Make it a required check only after
      it goes green once. Budget ~50-60 billed minutes per UI-touching push
      (paths-filtered, so backend/docs commits cost ~nothing).
- [ ] **Enable `wcag22aa` + `best-practice` tags** in
      `e2e/happy-path/visual-audit-sweep.spec.ts` (`.withTags([…])`). Measured:
      the current tag set runs 69 of axe 4.13's 105 rules, and **tap-target
      size (`target-size`), heading order, and landmark rules are NOT among
      them** — those three are still manual in the a11y checklist. One-line
      change, owned by the e2e lane.

---

## Pre-Release Audit punch list — 2026-06-18

Full report: `docs/PRE_LAUNCH_AUDIT.md` (verdict + findings + scorecards). Section
files under `docs/audit/`. **All 15 phases complete.** Verdict: **CONDITIONAL GO**
— no hard blocker (prompt's 🔴 lat/lng-leak bar is NOT tripped; coords are
coarsened/absent everywhere). Ship once the 3 must-fix Highs are closed.

**Must-fix before the next build (all quick, low-risk):**
- [x] **F-MONEY-01** — retire the `process-scheduled-payouts` cron. **Done in the database, which is where the double-pay hazard lived.** `20260618130000_unschedule_legacy_payout_cron.sql:15-17` unschedules it (guarded, idempotent), and `20260831190419_schedule_http_crons_missing_from_migrations.sql:62` records the deliberate refusal to re-create it while scheduling its siblings — so the racing cron cannot come back by accident. What remains is only the function *directory* `supabase/functions/process-scheduled-payouts/`, which is invoked by nothing scheduled; deleting it is an owner call, not a money risk. Verified 2026-09-02.
- [ ] **F-DISC-01** — close the legacy street-address leak. **Both shipped fixes are in; only the regression test is still open.** The leaky view is gone (`20260618120000_mask_open_jobs_rpc_drop_leaky_view.sql:64` — `DROP VIEW IF EXISTS public.open_jobs_safe`) and `get_ranked_open_jobs` masks `location` (`:53`, preserved through `20260901031421:171`), so the surface described below no longer exists. **Remaining work, and the only reason this stays unchecked:** no test asserts that an anon open-jobs surface never returns a street number. Until one exists, nothing stops a future migration un-masking the column — the live post path still writes the full street to `jobs.location` (`src/pages/postjob/jobSubmitHelpers.ts:156`), so the data is there to leak; it is latent only because current rows carry no street numbers. Re-verified 2026-09-02.
- [x] **F-SEC-01** — `git rm --cached .env && git commit` (file stays on disk; already gitignore'd). Key rotation NOT required (publishable-only keys).

**Other quick wins:**
- [x] **F-MONEY-02** — add `idempotencyKey: escrow-${jobId}` at `create-payment/index.ts:209`.
- [x] **F-SCR-01** — delete orphans `src/pages/LocalPricingGuide.tsx` + `src/pages/VerifyHelper.tsx` (both already removed).
- [ ] **F-SEC-08** — enable HaveIBeenPwned leaked-password protection in Supabase Auth.
- [x] **F-SEO-01** — `public/sitemap.xml` is now DERIVED from the route table by `scripts/generate-sitemap.mjs` (`--check` in `.github/workflows/sitemap-drift.yml`). **The "~20 missing public pages" premise was stale** — those marketing routes (`/how-it-works`, `/community`, `/parishes`, `/impact`, …) were deleted in `2352466e`. The app has 6 indexable public routes and the sitemap already lists exactly those 6, so no regeneration was needed; verified `node scripts/generate-sitemap.mjs --check` → "up to date (6 public URLs)" on 2026-08-31. `/login` + `/signup` are public but deliberately NOINDEXed as auth entry points (one-line change in the script if that judgement changes).

**Larger / deferred:**
- [ ] **F-MONEY-03** — route `admin_release_dispute` through `release-payout` or rethrow on transfer failure (`create-payment/index.ts:537-540,801`).
- [ ] **F-SEC-04** — `open_jobs_browse` SECURITY DEFINER view: document + narrow, or recreate `security_invoker`.
- [ ] **F-SEC-05** — rate-limit the public `partner_applications` insert.
- [x] **F-DISC-02** — tighten over-broad default grants on `open_jobs_safe`. Moot: the view itself was dropped by `20260618120000:64`, so there are no grants left to tighten. Verified 2026-09-02.
- [ ] **F-TRUST-01** — give the dual off-platform message-scan regex (client `messageScanner.ts` + server `scan_message_content()`) a shared source of truth or an equivalence test.
- [ ] **F-TRUST-02 / F-TRUST-03** — spelled-number evasion heuristic; soften the fixed 2-flag/24h auto-suspend (warn-first) and confirm `cash` tokens aren't over-firing.
- [ ] **F-SEC-06 / F-SEC-07** — pin `search_path` on 18 fns; `REVOKE EXECUTE … FROM anon` on mutation RPCs.
- [ ] **F-PERF-02 / F-SCR-02** — Leaflet → Apple MapKit consolidation spike.
- [ ] **F-PERF-03** — lazy-split the Activity route chunk (220 kB) by tab.
- [ ] **F-TYPE-01 / F-SCR-03** — burn down `any` (385 total), money/auth paths first.
- [ ] **Coverage** — line-audit core-journey screens; run Playwright e2e + `npx vitest run` (not in CI).

---

## Where We Left Off — 2026-05-11 (long session — CodeQL + refactors + iOS polish)

### Production state at end of session

- ✅ **All builds green on main.** PR #56 unblocked `npm install` everywhere
  (downgraded `react-leaflet@5` → `^4.2.1` + `react-leaflet-cluster@4` → `^3.1.1`)
  and inlined the Facebook icon SVG that lucide-react 1.x removed from Footer.
- ✅ **27 CodeQL alerts closed** in PRs #41 + #54-superseded-by-#56:
  12 XSS (`<img>` sites guarded with inline `startsWith("blob:")`),
  13 info-exposure (`err.message` stripped from edge function 500 responses
  in 11 functions), and 13 workflow-permissions blocks added.
- ✅ **Sentry: 0 unresolved issues** (verified mid-session).
- ✅ **Supabase advisors:** 0 ERROR, 30 perf WARN (all `multiple_permissive_policies`
  on known tables), 69 security WARN (all intentional SECURITY DEFINER fns
  + HIBP password-protection requires Pro).
- ✅ **PR #41/49/56 merged** to main.
- 🟡 **PR #60 open** — bundle of iOS polish (status-bar overlay fix + welcome
  card shrink + FAB redesign + full JobFilters parity on `/browse`) + perf
  audit doc + pre-render scaffold. Waiting on Vercel build rate-limit reset
  to finish CI checks.

### iOS native — Build #20 status

- TestFlight Build #18 was rejected (ITMS-90032) on the alt-icon
  declarations. Stripped in commit `d6be7b4`.
- Build #19 (CFBundleVersion 2032) shipped to TestFlight successfully.
- Build #20 (CFBundleVersion 2033) archived + uploaded to ASC mid-session.
  Status when last checked: in ASC processing. **Has the security fixes
  but NOT the polish items from PR #60** — those need a Build #21 dispatch
  after PR #60 merges.

### Real cowork-actionable items

1. **🚨 P0 — 3 cron functions still 500-ing.** `auto-release-payment`,
   `void-cancelled-payments`, `process-scheduled-payouts` have been
   returning 500 on every pg_cron tick (every ~30 min) for days. I
   redeployed each with `console.error("[fn-name] fatal:", error)` so the
   actual error message lands in Function Logs. **Check Supabase Studio
   → Edge Functions → Logs UI** for those 3 functions and post the
   first `fatal:` line. The root cause is invisible from the supabase
   MCP — only the Studio UI shows the deno log output.
   Once we have the error message, the fix is probably small (likely
   missing env var post-JWT-rotation, or a Stripe API version mismatch).

2. **Cut iOS Build #21** after PR #60 merges. Goes via the
   `ios-beta.yml` workflow with `build_number_floor=2034`. Brings:
   - The status-bar overlay fix (no more double padding above headers)
   - The welcome card / FAB / filters polish on `/browse`
   - All the iOS PWA / a11y groundwork

3. **`db-smoke.yml` workflow** still has a pre-existing migration
   duplicate-key issue (`schema_migrations_pkey` on version
   `20260505234500`). Surfaced on every PR that touches `.github/workflows/db-smoke.yml`.
   Adding top-level `permissions:` to that file was deliberately skipped
   in PR #60 because the touch triggers the broken workflow. Fix the
   migration duplicate first, then add permissions in a follow-up.
   CodeQL alert #5 stays open until.

4. **Alt-icon Xcode wiring** still pending on Mac (per earlier session).
   `public/app-icon-alt.svg` + `Info.plist` declarations exist (currently
   stripped) + `scripts/generate-ios-icons.mjs` exists. Cowork needs to:
   `node scripts/generate-ios-icons.mjs` → drag `ios/App/App/AlternateIcons/`
   into Xcode as folder reference → re-add `CFBundleAlternateIcons` to
   Info.plist. Once that lands, `src/lib/featureFlags.ts` and
   `src/components/profile/AppIconPicker.tsx` both need to be created —
   neither exists yet.

5. **Static pre-render of landing page** — single biggest remaining perf
   win (real-user mobile FCP is 10.98s vs <3s target). Scaffold at
   `scripts/prerender.mjs` is ready; enable per `docs/PERF_AUDIT_TODO.md`
   instructions. Requires `npm install --save-dev puppeteer` first.

6. **Vercel rate-limit headache.** Free tier caps daily builds; today's
   PR sprawl burned through it. Going forward I'll batch fixes into single
   PRs (matches Lexi's explicit feedback). If recurring, $20/mo Pro tier
   removes the cap.

### Refactor progress

- `Profile.tsx` 1,319 → 681 lines (-48%). 5 components extracted into
  `src/components/profile/`: DeleteAccountDialog, SecurityTab,
  JobListTab, ProfileEditForm, ProfileLanding.
- `PostJob.tsx` 1,172 → 731 lines (-37.6%). 4 components extracted into
  `src/components/postjob/`: CheckoutStep, LogisticsSection,
  BudgetSection, DetailsSection.
- Next targets per the older roadmap (low-priority, opportunistic):
  `Dashboard.tsx` (~1,015 lines), `Stripe webhook` (699 lines / 11 cases).

### Sentry rules — fully live

All 9 alert rules (P0 schema drift, P0 notifications check, P0 invalid
job state, P0 payout-without-ledger, P0 chat-push-trigger, P1 edge-fn
5xx burst, P1 Stripe Connect spike, WARN webhook signature, WARN
rate-limit) created via Sentry API. Lexi can revoke the sntryu_ token
at https://sentry.io/settings/account/api/auth-tokens/ — it's no longer
needed.

### Supabase GitHub secrets — all 3 set

`SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`
are configured. `db-deploy.yml` and `db-drift-detect.yml` will now run
end-to-end on their nightly schedules (the latter has been skip-warning
for ~a week before this).

---

## Supabase branching hygiene (Cowork — Free plan, 200 hrs/mo)

If you spin up a preview branch with `supabase branches create <name>`:
1. Do your work in the same session.
2. `supabase branches delete <name>` BEFORE you close out.
3. If you forget, Lexi will get a quota warning email within ~1 week per branch.

On Free plan there is no auto-cleanup. The 2 branches that got
deleted 2026-05-11 (`liquid-glass-elevation-design` merged 7 days
prior + `chore/rename-migrations-to-prod-versions` 24h prior)
burned 192 of 200 hours by themselves.

---

## Where We Left Off — 2026-05-11 (iOS-state audit + security cleanup)

Audit pass against the iOS/Capacitor surface to reconcile `TODO.md`
with actual code state. Code paths cross-checked against
`src/lib/nativePush.ts`, `src/lib/socialLogin.ts`,
`src/lib/nativeInit.ts`, `ios/App/App.entitlements`,
`ios/App/App/Info.plist`, and `capacitor.config.ts`.

### Closed today (2026-05-11)

- ✅ **Sentry alert rules** — all 9 live via API (no more UI paste needed).
  Rules 1-5 + 8 = P0 alerts; Rules 6-7 = P1; Rule 9 = P2 digest.
- ✅ **Supabase preview branches** — 2 stale branches deleted (`liquid-glass`
  merged 7 days prior, `chore/rename-migrations` 24h prior). Reclaimed
  ~192 of 200 monthly hours. Quota healthy through 2026-05-18 reset.
- ✅ **25 CodeQL alerts** (12 High XSS + 13 Medium info-exposure) closed
  in PR #30. New shared helper `src/lib/imagePreview.ts`. Edge functions
  no longer leak `err.message` in client responses.
- ✅ **iOS Build #18** triggered to TestFlight (workflow run #18).

### Status reconciliation — previously-claimed-pending was already shipped

| Claim | Audit verdict | Evidence |
|---|---|---|
| "Ship iOS Build #17+" | Code shipped; **#18 archiving now** | `nativePush.ts:31,67-84` token buffer + flush; build #18 dispatched 2026-05-11 |
| "Apple Sign-In native iOS rewire — deferred" | ✅ **DONE** | `AppleSignInButton.tsx:28-40` native routing; `socialLogin.ts:30-44` idToken exchange; `App.entitlements:40-43` has `applesignin`. TestFlight #14 verified working. |
| "Push notifications via Capacitor on iOS" | ✅ **DONE** | `useNativePushSetup()` at `App.tsx:180`; token persist + auth-buffering verified |
| "iOS Alt App Icon" | 🔴 **ROLLED BACK** | Build #18 (CFBundleVersion 2031) was rejected by ASC with ITMS-90032 — Info.plist declared `CFBundleAlternateIcons` but PNGs were never rasterized into the .ipa (no Mac session had run `scripts/generate-ios-icons.mjs` + Xcode folder reference). Rolled back the `CFBundleAlternateIcons` keys from `ios/App/App/Info.plist` so build #19 archives clean. Re-add the keys AFTER Cowork runs the rasterize script + does the Xcode folder-reference drag-drop step. |

### Still pending Lexi (UI work)

- [ ] **Add 2 Supabase GitHub secrets** at https://github.com/louisianahelpr/louisianahelpr/settings/secrets/actions
  - `SUPABASE_ACCESS_TOKEN` — Supabase Dashboard → Account → Access Tokens (project scope)
  - `SUPABASE_DB_PASSWORD` — Supabase Settings → Database → Connection string
  - (`SUPABASE_PROJECT_REF` is auto-set by claude session 2026-05-11)
- [ ] **App Store metadata refresh** — `docs/APP_STORE_REVIEW_SUBMISSION.md` has paste-ready copy
- [ ] **Logo uploads to external services** — Stripe brand settings, Google OAuth consent screen, Gmail Workspace sender avatars. `docs/LOGO_UPDATE_RUNBOOK.md` has the full surface list.
- [ ] **Revoke the GitHub PAT** `claude-cli-codeql-fixes-2026-05-11` once iOS build settles. Same security hygiene as the Sentry token.

### Still pending Cowork (next Mac session)

- [ ] **Alt-icon rasterize + Xcode wiring** — `node scripts/generate-ios-icons.mjs` then drag `ios/App/App/AlternateIcons/` into Xcode App group as folder reference
- [ ] **PR #29** — migration filename rename is still open + MIGRATIONS_FAILED. Either fix or close.
- [ ] **App Store review submission** after Lexi green-lights

---

## Where We Left Off — 2026-05-09 (migration drift CLOSED + structural fix shipped)

**Reports in session outputs:** `qa-report-2026-05-03.md`, `migration-pipeline-postmortem.md`.

- ✅ **P0 fixed in prod.** Applied the rewrite of all 8 helper-filter functions via `apply_migration` (recorded as `20260509194716_repair_notify_triggers_no_role_check` and `20260509195035_rewrite_helper_filters_behavior_based`). Verification: all 8 return `still_broken=false` against the `LIKE '%p.role%'` check. Smoke test (transactional INSERT into `jobs`) passed — triggers fire cleanly, no `column p.role does not exist`. **Build 18 unblocked.**
- ✅ **IDV gating verified** at /post-job confirm step.
- ✅ **Migration backlog CLOSED — 12/12 applied + verified.** Cowork ran the full sequence in user-specified order, every `apply_migration` returned success, every verification query passed (one false-alarm on a bad LIKE-escape in the verifier itself, not real drift). Chat-push functional smoke test passed end-to-end (synthetic INSERT → `notify_message_recipient` → notification row with `type='message'` + correct `link`). All 4 sweeper crons registered. `schema_migrations` rows recorded for each.
- ✅ **CI structural fix shipped (commit `a9b42fff`):**
  - `.github/workflows/db-deploy.yml` — auto-runs `supabase db push --linked --include-all` on push to main when migrations change. Concurrency-locked.
  - `.github/workflows/db-drift-detect.yml` — nightly 06:00 UTC. Diffs local files vs prod's `schema_migrations`, opens/updates a labeled GitHub issue, auto-closes when clean.
  - `migration-lint.yml` re-enabled on PRs (was workflow_dispatch only).
- 🟠 **Lexi: add 3 GitHub repo secrets** to activate the new workflows (Settings → Secrets and variables → Actions):
  - `SUPABASE_ACCESS_TOKEN` — Supabase Dashboard → Account → Access Tokens (project access scope)
  - `SUPABASE_DB_PASSWORD` — Settings → Database → Connection string
  - `SUPABASE_PROJECT_REF` = `fncmgoasalhdgfwzhsqa`
  Both new workflows skip-with-warning until secrets land — nothing breaks if you wait.
- 🟠 **First drift-detect tick should report 0** on the night after secrets are added — confirms the structural fix works end-to-end.
- 🔴 **Filename hygiene still pending** — several local migration prefixes use invalid hours (`20260506380000` parses as `38:00:00`). Switch to `supabase migration new <slug>` going forward. Cowork is queued to rename existing files in a separate PR (renaming during the backlog application risked reapply, so it was deliberately deferred).
- ⏭ **QA tests 1, 3, 4, 5** still need a human/CI run (auto-blocked: account creation, password entry, viewport emulation, sandbox→localhost).
- 🧹 **DB cleanup done:** Lexi's `idv_status` reverted from `verified` to `not_started`. No other writes outside the intended migrations.

### Concrete next steps

1. Add the 3 GitHub secrets above.
2. Watch the first nightly drift-detect tick (Settings → Actions tab) — should report 0.
3. Cowork's invalid-timestamp file-rename PR — review when opened.
4. Sentry alert rules — paste the 9 rules from `docs/SENTRY_ALERT_RULES.md` (rewrote in commit `117c59f7` — added 3 new alert types including the chat-push silent-break detector).

---

## Handoff List — 2026-05-06 (post-audit session)

This block consolidates everything that wasn't shippable in the audit
session, sorted by who can do it. Everything else above this line is
historical session notes — keep those for context but don't reread top
to bottom unless looking up history.

---

### A — Lexi only (you, account credentials / UX decisions)

These need your accounts, your DNS, your judgement on copy or product.
None can be done from code alone.

- ~~**Sentry alert rules**~~ — moved to Cowork's lane (B) 2026-05-06
  since Cowork now has access to helpr-4m.sentry.io.
- [ ] **Stripe DNS records** for branded receipt emails (low-pri until
  you're ready for branded receipts — Stripe sends generic ones until
  then).
- [ ] **Logo uploads to external services** — App Store Connect (already
  shipped via icon-set), Stripe brand settings (icon + logo + brand
  color), Google OAuth consent screen, Gmail Workspace sender avatars.
  `docs/LOGO_UPDATE_RUNBOOK.md` lists every surface.
- [ ] **Notification copy decisions** — these need your voice, not mine:
    - Daily digest "5 new jobs in [parish]" subject lines for email
    - Review-result email tone (helper got 5 stars vs 2 stars)
    - Week-1 nag sequence ("you haven't browsed in 3 days — here's what
      you missed")
    - Re-engagement push for users dormant 30+ days
- [ ] **Tune auto-restrict thresholds after 2-3 weeks of real data**
  — currently 1 violation → `final_warning`, 2 → 7-day temp_ban, 3 →
  30-day temp_ban. Watch the AdminUsers reverse-rail; if you're
  reversing >30% of auto-bans, loosen to 2/3/4. If you're not catching
  bad actors fast enough, tighten to 1/2/2.
- [ ] **Real-name vs initial display** — `formatName()` returns "First
  L." for privacy. Decide whether some surfaces (helper bios, your
  admin queue) should show full names. Currently uniform.

---

### B — Cowork (offshore iOS dev / deploys)

Native-iOS or deploy-pipeline work that lives on their machine.

- [ ] **Ship iOS Build #17+** — includes today's auth-session push
  buffering fix (`f91885fc`). Required before any user — including
  admins — gets push tokens. Right now production has 0 push tokens.
- [ ] **Apple Sign-In native iOS rewire** — deferred to next iOS build.
  Web flow works. Native plugin (`@capgo/capacitor-social-login`) needs
  the Service ID + Key ID stored as native config (see
  `reference_oauth_client_ids.md` in memory for IDs).
- [ ] **Sentry alert rules** — paste the 5 alert specs from
  `docs/SENTRY_ALERT_RULES.md` into helpr-4m.sentry.io. Cowork has
  Sentry access (confirmed 2026-05-06).
- [ ] **iOS Alternate App Icon** for 36px notification thumbnails
  (low-pri) — current wrought-iron H smudges at 36px. Drop a flatter
  "H + fleur-de-lis silhouette" PNG and wire iOS 18 Alternate App Icons
  so users can opt in via Settings → Helpr → App Icon.
- [ ] **Submit to App Store review** when Lexi gives the OK.

---

### C — Future engineering sessions (Claude or human dev, multi-hour each)

Real shippable work that genuinely needs more than one session each.
Listed in rough priority order.

- [x] **Real-time job radar map (the "force multiplier")** — shipped 2026-05-06.
  Leaflet + react-leaflet + OpenStreetMap tiles. Public RPC
  `get_open_jobs_for_map` returns coords rounded to 3 decimals (~110m
  precision) so doorstep is never exposed. `BrowseMap` lazy-loaded
  via Suspense. List/Map toggle live on `/browse` (DashboardGuest)
  AND on authenticated `/dashboard`. Pin tap → popup with title/budget/
  category/urgent flag → 1-tap apply (auth) or "Sign up to apply"
  redirect (guest). Pin clustering via `react-leaflet-cluster`
  (chunkedLoading + spiderfyOnMaxZoom + 50px cluster radius).
  Geocoding wired into PostJob (Nominatim, free, US-scoped) so
  new posts populate coords automatically. Map item COMPLETE.
- [ ] **Continue god-component extraction**
  AdminUsers is at 467 lines (was 1,916 as of 2026-05-06; further reduced via
  `src/components/admin/adminusers/` subdirectory).
  9 sub-components extracted: `AutoRestrictedRail`, `DenyUserDialog`,
  `BanDialog`, `EditEmailDialog`, `DeleteUserDialog`,
  `ManualVerifyDialog`, `ResetPasswordDialog`, `ReuploadIdDialog`,
  `FormalWarningDialog`. The shared `callAdminAction` coordinator
  + `actionBusy` state are retired from the parent. AdminUsers is
  now mostly the user-list + filter pills + per-card menu —
  no further dialog extractions needed at this point. Profile.tsx (573 lines)
  and PostJob.tsx (109 lines) were extracted in the
  2026-05-11 session. Remaining: `Dashboard.tsx` (510 lines).
- [x] **Stripe webhook refactor** — handlers split into
  `supabase/functions/stripe-webhook/handlers/` (13 files, ~1 k
  total lines) with a thin 173-line `index.ts` router. Done.
- [ ] **Migrate Profile/Dashboard/Messages to `useProfile()` hook**
  Foundation laid in `src/hooks/useProfile.ts`. Each consumer needs
  its own careful migration (read sites identified, but profile-shape
  expectations differ by call site). Saves DB cost + simplifies cache
  invalidation.
- [ ] **Test coverage past 53**
  Currently 7 test files / 53 cases / 2 real bugs found
  (formatPhone country-code, formatName whitespace). Next targets:
  `analytics`, `messageAttachments`, `imageCompression`,
  `parishLookup`, `applicationAttachments`, `cppRouting`. Build
  testable pure helpers out of god-component logic during refactors
  — co-locate `.test.ts` next to each.
- [ ] **End-to-end Playwright with a test-customer fixture**
  Current e2e (post-and-apply.spec.ts) covers redirect + navigation
  paths only. Full happy path (post → checkout → apply → accept →
  complete → review reveal) needs a fixture user whose creds live in
  CI secrets.
- [x] **Drop legacy `'helper'` enum value** — runtime cleanup shipped
  2026-05-06 (8 functions rewritten to behavior-based filters,
  migration `20260506380000_*`). The physical Postgres enum value is
  retained because dropping it would require recreating `has_role`
  (which has `app_role` as a parameter type) plus the user_roles type
  cast — non-trivial risk for zero practical benefit since 0 rows and
  0 functions reference `'helper'::app_role` anymore. The value is
  effectively dead at runtime; the schema-level vestige is harmless.
- [x] **Animated count-up on the hero "active now" pill** — shipped
  2026-05-06 (`useCountUp` hook, RAF-based ease-out-cubic tween,
  respects prefers-reduced-motion).
- [ ] **More nuanced fraud detection** — beyond the burst-job and
  multi-reporter signals already shipped: velocity/IP heuristics,
  rapid-cancellation patterns, image-reuse detection across postings.
  Each pattern would extend `detect_suspicious_user_patterns` cron.

---

### D — Decisions paused on owner sign-off

- [ ] **Auto-restrict threshold tuning** — 1/2/3 ladder shipped today.
  Reassess after real data lands.
- [ ] **Notification cadence** — `sweep-daily-job-digest` is live (9am
  CT). Future sessions can layer review-result emails + week-1 nag
  sequence + 30-day re-engagement. Each needs your copy choice first.
- [ ] **Skeleton screens beyond what shadcn `<Skeleton>` covers** — the
  audit's recommendation was overstated; most existing Loader2 usages
  are inline button spinners that should stay. The DashboardSkeleton +
  9 sibling variants in `SkeletonLoaders.tsx` already handle the major
  full-page loading states. Re-audit if the perceived-speed feels off
  after iOS Build #17 ships.

---

## Where We Left Off — 2026-05-06 (overnight + morning sessions, 81 commits)

Production state: 0 unresolved Sentry issues, all 13 cron jobs firing
on schedule, RLS perf advisor 281 → 85 (-196), security advisor
167 → 65 (intentional public RPCs only), Playwright 9/9 + 2 auth
skipped, build/tsc/lint all green.

### Shipped this session

**Push notifications system (end-to-end, awaiting iOS Build #17)**
- `send-push-notification` edge function with both APNs (iOS) + FCM
  (Android) paths. Skip-with-warning when creds missing. Auto-cleans
  dead tokens (410/404/UNREGISTERED).
- APNs creds set in Supabase function secrets: KEY_ID `D767K5J877`,
  TEAM_ID `P85MCK558V`, BUNDLE_ID `com.Helpr`, AUTH_KEY (.p8 contents).
- DB trigger `notifications → send-push-notification` so every in-app
  notification automatically becomes a push (respects per-user
  notification_preferences with master push_enabled toggle + per-category bools).
- `PushNotificationPrompt` mounted on Dashboard.
- Auto-call `register()` on app boot when permission already granted
  (commit 0fc54f24 — Capacitor doesn't auto-re-emit cached tokens).
- Buffer device token until auth session restored from local storage
  (commit f91885fc — APNs delivers in <100ms, faster than supabase-js
  session hydration; buffer in module ref + flush on SIGNED_IN).
- Admin Health page now shows live token stats (total / iOS / Android /
  last registered) + "Send test push to me" button.

**Native iOS OAuth (TestFlight #14 verified working)**
- `@capgo/capacitor-social-login` wired for Apple + Google native sign-in.
- `AppleSignInButton` + `GoogleSignInButton` switch to native path on
  `Capacitor.isNativePlatform()`, exchange idToken via
  `supabase.auth.signInWithIdToken`. Web fallback unchanged.
- `initSocialLogin()` called from `initNative()` on app boot.
- TestFlight build #14 succeeded; tested on real iPhone, both buttons work.

**Apple Developer cleanup (cowork last night)**
- 13 items revoked: `com.nexltech.oldnock` + `com.louisianahelpr.app` +
  XC Wildcard App IDs; 5 API-created Dev certs; old SIWA key
  `Y754ZY5DQ2`; cert `Q2MD48R498`; Distribution Managed `GN5F5RQX2L`;
  5 Invalid Profiles. Account is now: 1 App ID (`com.Helpr`), 1
  Services ID (`com.Helpr.signin`), 2 Certs (active Distribution
  `96A589WNN9` + personal Dev), 1 SIWA Key (`67WQZ3F8Q5`).

**DB Smoke workflow fixed** — was failing 4× since 2026-05-04
- Added 4 newer migrations to KNOWN_CI_FLAKY (storage.objects /
  realtime.messages — image-perm-sensitive)
- Wrapped REVOKE loops in `EXCEPTION WHEN undefined_function` so
  Supabase-managed funcs (`rls_auto_enable`,
  `extend_boosts_with_no_applications`) absent in fresh DBs don't
  abort the run
- Smoke test now UPDATEs profile instead of INSERT (handle_new_user
  trigger auto-creates the row)
- Static role-string guard scoped to .ts/.tsx only (migration history
  was flagging dead historical patterns)
- Run time: 1m43s, all green.

**Other features**
- Branded business-team invite emails + resend button + `?invite=` prefill
- Recurring job templates: `spawn-recurring-jobs` cron firing daily 5am UTC
- `get_ranked_open_jobs` falls back to `profile.parish` when helper
  hasn't set preferred parishes
- Reports admin queue: SLA timer (24h) + audit_log entry on resolve
- Realtime typing-broadcast bug fixed (was creating fresh channel
  each call); added throttling
- Postgres-changes Messages subscription gets server-side filter
  (was receiving every INSERT in public.messages)
- Email send log: collapse pending row into terminal status (no more
  orphan pending entries)
- 6 unused edge functions deleted (auto-resend-* trio, auto-resolve-revisions,
  job-lifecycle-automations, job-match-digest)
- 10 unused landing components deleted (-1023 LOC)
- `@capacitor/android` removed from package.json

**Security fix (real)**
- `stripe-idv-webhook` had a silent unsigned fallback: anyone could
  POST a fake `identity.verification_session.verified` event and
  bypass IDV. Patched to fail closed when secret/signature missing.

**Backwards-compat memory**
- Realtime tokens via `cron.alter_job()` to read from new vault keys
- Storage paths stored as paths (not URLs) on profiles + applications
  + messages.attachment_url; signed URLs generated at display time
- 14 service-role policies scoped to `{service_role}` (was `{public}`)
- 75 policies scoped to `{authenticated}` (was `{public}`)
- 158 `auth.uid()` calls wrapped in `(SELECT auth.uid())` for initPlan

### Open product decisions

- 🟡 **Should admin broadcasts → push notifications?** Currently
  `AdminBroadcasts` writes to `broadcast_messages` (shown via the
  banner on Dashboard), but does NOT insert into `notifications` —
  so broadcasts don't fan out to push. If you want broadcasts to
  also push to every user, ~10 lines: in the broadcast send handler,
  query all users where `notification_preferences.push_enabled` AND
  `system_alerts`, then fan out via `createNotification`. Currently
  banner-only because the design intent was passive vs. push-y.

### Pending YOUR action (only you can do these)

- 🟠 **iOS Build #17** — cowork ships this afternoon when you're back.
  Required to land push tokens in `push_tokens` (the auth-session
  buffering fix from commit f91885fc).
- 🟠 **Sentry alert rules** — paste the 5 specs from
  `docs/SENTRY_ALERT_RULES.md` into helpr-4m.sentry.io. ~30 sec each.
- ⚪️ **HIBP password protection** — ACCEPTED RISK (won't fix). Requires
  Supabase Pro ($25/mo); staying on free tier. Studio → Auth → Policies →
  "Check for leaked passwords" if that ever changes.
- 🟠 **Submit build #14 (or latest) to App Store review** — TestFlight
  is internal-only. Cowork can do it from App Store Connect once
  you've smoke-tested the native OAuth paths on TestFlight.
- 🟠 **Stripe DNS records** (low-pri) — for branded
  `*@louisianahelpr.com` Stripe receipts.

### Branding (low-pri follow-up)

- [ ] **iOS Alternate App Icon for very small surfaces.** The wrought-iron
  H reads great at 60-180px (home screen, FB profile, App Store listing
  hero) but smudges to a recognizable-but-detail-lost blob at 36px
  (notification thumbnails, iOS Settings list). Most users won't notice,
  but if user feedback ever surfaces "I can't tell which app sent this,"
  ship a simplified glyph version via iOS 18 Alternate App Icons (user
  can opt in via Settings → Helpr → App Icon). Source files in
  `public/apple-touch-icon.png` (current wrought-iron) — alt would be
  a flatter "H + fleur-de-lis silhouette" PNG of the same dimensions.

### Salvage from deleted `job-lifecycle-automations.ts`

Recovered from git (commit `5526a859^`). The deleted function had 9
logical sections; 4 are already covered elsewhere, 5 are genuinely
novel automation ideas worth filing for later:

- [x] **Job-start reminders** — shipped 2026-05-06 as
  `sweep_job_start_reminders` + pg_cron `*/5 * * * *`. T-30min push to
  both customer and helper for `accepted` jobs. Idempotent via
  `jobs.start_reminder_sent_at`.
- [x] **No-show detection** — shipped 2026-05-06 as
  `sweep_no_show_alerts` + pg_cron `*/5 * * * *`. T+30min nudge if
  status is still `accepted`. Customer and helper get gentle prompts;
  6h cap stops re-alerting on stale rows.
- [x] **Auto-escalate users with 3+ reports** — shipped 2026-05-06 as
  `auto_escalate_reports` AFTER INSERT trigger on `reports`. Fans
  system_alert to all admins when 3+ open reports in 90d. Carpet-bomb
  prevention skips if any admin got an alert for that user in 7d.
- [x] **Auto-restrict repeat violators** — shipped 2026-05-06.
  Final ladder: 1st violation → `final_warning`, 2nd → 7-day
  `temp_ban`, 3rd → 30-day `temp_ban`, 4th+ → admin-only notification
  (no further auto-action). Trigger early-returns on admin-initiated
  + self-managed violation types so it never overrides existing bans.
  AdminUsers has a "Recently auto-restricted" rail with one-tap
  Reverse for false positives. Companion sweeper releases expired
  auto-bans hourly.
- [x] **Suspicious pattern detection** — shipped 2026-05-06 as
  `detect_suspicious_user_patterns` + daily pg_cron `30 4 * * *`.
  Inserts into existing `fraud_flags` table when burst job posting
  (10+/24h) or multi-reporter pile-on (3+ distinct reporters/30d) is
  detected. Idempotent via existing-unresolved-flag check.

Already covered by other functions, so NOT salvaged:
  - Review reminders → `review-nag-cron`
  - Expire open jobs → `auto-expire-jobs`
  - Auto-release payment reminders → `auto-release-payment`
  - Auto-complete stale jobs → partially covered by `auto-resolve-disputes`

If any of these become a priority, the source code is in
`git show 5526a859^:supabase/functions/job-lifecycle-automations/index.ts`.

## Where We Left Off — 2026-05-05 (prior session)

47 commits. Production quiet (Sentry: 0 unresolved issues; 9/9
Playwright tests pass; RLS spot-check confirms wrapped policies still
enforce correctly).

### Shipped today
- ✅ **Branded auth emails working end-to-end** — Supabase Auth Send
  Email Hook → standardwebhooks signature verify → React Email render
  → pgmq → process-email-queue → Resend. Recovery email confirmed
  delivered from `Helpr <noreply@louisianahelpr.com>`. Covers signup
  confirmation, password reset, magic link, email change,
  reauthentication, invite.
- ✅ **JWT key migration COMPLETE** — cowork wrote new `sb_secret_*` to
  vault.secrets, repointed all 12 cron jobs (`cron.alter_job()` from
  `vault.legacy_service_role_key` → `vault.service_role_key`), and
  Disable Legacy was clicked. All 12 cron functions returning HTTP 200.
- ✅ **Apple Sign In verified working** — first production sign-in
  succeeded; first-time users land on `/complete-profile`, returning
  on `/dashboard`. Calendar JWT-rotation reminder: 2026-11-02.
- ✅ **user-documents bucket privacy split** — created public `avatars`
  bucket (image-only, 5MB cap), flipped `user-documents` to private,
  switched all callsites from `getPublicUrl` to `createSignedUrl(path,
  ttl)`. License/insurance/portfolio uploads now path-only with
  per-click signed URLs. Migration:
  20260505220000_split_avatars_bucket_private_user_documents.
- ✅ **P0 trigger fixes** — handle_new_user, prevent_self_escalation,
  sync_email_verified, sync_email_verified_on_insert all migrated off
  the dropped `profiles.role` column to `has_role()`/user_roles.
  Signup unbroken end-to-end.
- ✅ **Perf advisor: 281 → 89 lints (68% drop; 86% on WARNs only)**
  - 158 `auth_rls_initplan` → 0 (mechanical wrap migration:
    20260505235000)
  - 75 policies scoped from `{public}` → `{authenticated}` (excl. 2
    intentional anon-insert) — closes ~30 multiple_permissive entries
  - 14 service-role policies scoped to `{service_role}` — closes 7
    more multiple_permissive entries
  - 1 realtime.messages policy wrapped (the last initPlan warning)
- ✅ **Security advisor: 167 → 65** — 0 ERRORs. 64 remaining WARNs are
  intentional public RPCs / RLS helpers / admin funcs with internal
  `has_role` checks. The one remaining toggle (HIBP leaked-password
  protection) is an accepted risk — needs Pro tier, staying on free.
- ✅ **Email send log orphan rows fixed** — process-email-queue now
  UPDATEs the pending row by message_id instead of inserting a fresh
  terminal row. One canonical entry per message.
- ✅ **Pgmq cleanup** — purged stale msg_id=3 with the bad
  `noreply@send.louisianahelpr.com` sender (enqueued before the
  apex-revert deploy and retried every 5 min for ~12 min).
- ✅ **Performance: 6 duplicate indexes dropped, 12 missing FK
  indexes added** (migrations 20260505234000, 20260505234500).

### Pending YOUR action (only you can do these)
- 🟠 **`gh auth refresh -s workflow`** then push
  `.github/workflows/db-smoke.yml` (file is in working tree). This
  workflow catches the trigger-bug class before merge.
- 🟠 **Sentry alert rule** — UI only at
  https://helpr-4m.sentry.io/projects/javascript/alerts/new/issue/.
  Conditions: error message matches `column .* does not exist` OR
  `violates check constraint .*notifications_type_check` OR
  `Invalid job status transition` OR `transfer sent but ledger write
  failed`.
- 🟠 **Stripe test-mode payout test + flip the gate** — manually
  invoke release-payout with a test job's id, verify Stripe transfer +
  ledger row + status flip + notification, then set
  `RELEASE_PAYOUT_AUTO=1` in Supabase Functions config. Cron picks it
  up next tick.
- 🟠 **Deploy stripe-webhook** — `supabase functions deploy
  stripe-webhook` to activate the new transfer.failed/reversed
  handlers + payout_transfers ledger lifecycle updates.
- 🟠 **iOS App Store build 17 publishable key audit** — needs Mac+Xcode.
- ⚪️ **HIBP password protection** — ACCEPTED RISK (won't fix). Needs
  Supabase Pro ($25/mo); staying on free tier. Auth → Policies → "Check
  for leaked passwords" if/when upgraded.
- 🟠 **Stripe DNS records** (low-pri) — Stripe sent "unused domain
  failing DNS verification" 2026-05-05. Apex-only `*@louisianahelpr.com`
  Stripe email branding requires 2-3 CNAMEs + TXT they show in the
  dashboard. Or remove the domain from Stripe to silence.

## Where We Left Off — 2026-05-04 (prior hardening session)

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
- ✅ **AVIF image pipeline** — `npm run images:avif`. Rolled back in PR #221 — hero preload removed for LCP.
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
- ✅ **Verify Stripe API version** — DONE 2026-05-05. Programmatic test against `api.stripe.com/v1/balance` confirms `2025-08-27.basil` is honored (Stripe echoes back unchanged); bogus version strings get HTTP 400 (no silent substitution). The docs page only lists milestone versions; `.basil` branch dates remain valid. No code changes needed.

### Supabase JWT key rotation — DONE (2026-05-05)

Cowork wrote the new `sb_secret_*` to vault.secrets, repointed all 12
cron jobs via `cron.alter_job()`, and Disable Legacy was clicked.
Section kept for the rationale — the original exposure was the legacy
service_role JWT leaking via pg_stat_statements + Studio saved-query
history during a failed `ALTER DATABASE` for vault GUCs.

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
- [x] Define job-state machine end-to-end (DB-level enforcement shipped 2026-05-04). UI side shipped 2026-05-05: PaymentSuccess shows a 4-step visual lifecycle (commit 92773bba); PostedJobsTab/AppliedJobsTab already surface live state with bilateral confirmation indicators; JobCard intentionally stays state-less (only renders OPEN jobs).
- [x] Helper discovery: location-aware ranking on the job feed —
  shipped 2026-05-06 as parish-match sort tier in
  `useDashboardFilters.ts`. Same-parish jobs float above other-parish
  jobs after urgent + boosted, before subscription-tier priority.
  Future polish: weighted distance via `haversineMiles` when both
  user and job have lat/lng (granular within-parish ordering).
- [x] Saved searches + push/email notifications when a matching job is posted (DB triggers exist + cron scheduled by cowork 2026-05-05 + triggers migrated to vault.decrypted_secrets in commit 5ac17952 — fan-out fully live)

### Trust & safety
- [~] Helper verification flow — Stripe Identity is wired, IDV retry UX shipped. `helper_verifications` history table + AFTER UPDATE trigger on profiles shipped commit e2536835; Verification History panel inside AdminUsers profile dialog shipped commit ad6214e5. Still TODO: deprecate `legacy_manual_review` flag (referenced in 4 migrations + 2 edge functions + 2 admin components — separate change)
- [x] Two-way reviews — DB enforcement trigger shipped 2026-05-04. UI side: reviews already surfaced on own Profile (ReviewsTab) and other-user UserProfile (inline panel with sub-ratings); review-nag-cron handles 24h+72h reminders.
- [x] Dispute / report-issue path wired into `Admin` queue with SLA —
  shipped 2026-05-06. `AdminDisputes` now shows color-coded age
  badges (Fresh <24h / 24-48h / Stale >48h / **Chargeback risk** >5d)
  and the queue sort puts chargeback-risk disputes at the very top
  regardless of subscriber tier (Stripe lets card issuers reverse
  charges past the 5-day window — those MUST get attention first).
  Within each priority bucket: oldest dispute first.

### Payments
- [x] Stripe Connect onboarding for helpers (Express accounts) — shipped + idempotency added 2026-05-04
- [x] Hold-and-release escrow — release-payout function shipped, gated behind `RELEASE_PAYOUT_AUTO=1` until manual test confirms
- [x] Refund + partial-refund flows from `AdminJobs` — full refund button (commit 0aa00b26) + partial refund support (commit 19e184a3); webhook still handles `charge.refunded` for any refunds initiated outside the admin UI.
- [x] Surface payout_transfers ledger to helpers (earnings tab — commit afc83213) and admin reconciliation view (commit 3bccf4d8 — last 50 transfers in AdminPayoutBatches with status, failure reason, helper name, job title)

### Messaging & realtime
- [x] Supabase Realtime channel per job thread; presence + typing
  indicators — already shipped in `src/hooks/useChatPresence.ts`.
  Messages.tsx wires `isOtherOnline`, `isOtherTyping`, and
  `broadcastTyping` into the conversation header.
- [x] Attachment uploads (photos for quotes / completion proof) with
  size + MIME guards — already implemented in `src/lib/messageAttachments.ts`.
  5MB cap, MIME whitelist (JPG/PNG/WEBP/HEIC/PDF), EXIF stripping
  on upload, RLS-enforced path convention `<jobId>/<senderId>/<uuid>-<safeName>`,
  signed URLs for display.
- [x] Push notifications via Capacitor on iOS for new messages and status changes

### Business accounts
- [ ] `BusinessTeam` seat management, role-based permissions, invoicing
- [ ] Recurring job templates for business posters

### Admin & analytics
- [x] `AdminAnalytics` cohort + funnel views — activation funnels shipped commit afc83213, cohort retention card shipped commit ffeb15c1.
- [x] Health dashboard: open jobs by parish, helper supply ratio, time-to-first-application — Marketplace Pulse panel shipped commit e9dc12d7 in AdminHealth

### iOS
- [ ] `npm run sync:ios` after each marketplace schema change
- [ ] App Store metadata refresh once Stripe + verification ship

### Tech debt
- [x] Trim `AdminAnalytics` bundle — recharts code-split shipped commit 7caea06b. Initial chunk 409KB → 30KB (13× reduction); chart chunk loads in parallel.
- [ ] Resolve `npm cache` permissions on the dev box (`~/.npm/_cacache` ownership) so `npx` doesn't need a temp cache

### Security follow-ups
- [x] **`user-documents` storage bucket privacy** — DONE 2026-05-05.
  Split into public `avatars` bucket (image-only, 5MB cap) for
  profile pictures + private `user-documents` for licenses/insurance/
  portfolios. All 13+ callsites switched from `getPublicUrl(path)` to
  `createSignedUrl(path, 5 * 60)` (5-min TTL for clicks, 30-day for
  shareable support screenshots). Admin credential-queue uses the
  same per-click signed URL pattern.
- [x] **Bucket "Public read" RLS policies** — DONE 2026-05-05.
  Dropped redundant policies on avatars (now public-flag-managed) and
  user-documents (now owner-or-admin only).
- [~] **HaveIBeenPwned password protection** — ACCEPTED RISK (won't fix).
  Needs Supabase Pro ($25/mo); staying on free tier. Auth → Policies →
  "Prevent use of leaked passwords" if/when upgraded.

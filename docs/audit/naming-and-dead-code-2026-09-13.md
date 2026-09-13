# Naming mismatches and dead code — 2026-09-13

Report only. Nothing edited, committed or deleted. Measured on `origin/main @ 27b2e9b86`
in a detached worktree. Excluded per brief: Pay It Forward / gift-card names,
useApplyFlow.ts, useJobSubmit.ts, chunkReload.ts, e2e/liveSession.ts, admin tiers view.

**DB: NOT verified live.** The Supabase MCP needs re-authorization (non-interactive
session could not run OAuth), so every DB claim below comes from
`src/integrations/supabase/types.ts` + `supabase/migrations/` grep only. Per CLAUDE.md
"verify live before claiming", treat all DB rows as PROBABLY until checked with
`to_regclass`/`to_regprocedure`/`cron.job` on prod.

Method (reproducible, scripts were throwaway in `~/.lh-naming/`):
- src files: every non-test file under `src/`, grepped by import specifier across
  src/e2e/scripts/config; duplicate basenames re-checked by full alias path.
- routes: every `path=` in `src/App.tsx`, grepped for a link/navigate outside App.tsx.
- edge functions: each dir name grepped in src, supabase/functions, migrations (pg_cron
  / pg_net), .github, config.toml.
- DB: every Table/View/Function/Row column in types.ts counted as a word in
  src + supabase/functions (non-test); zero-hit items then checked for SQL callers in
  migrations (excluding CREATE/GRANT/REVOKE/INDEX/POLICY/COMMENT lines) and cron.
- CSS: every class selector in `src/**/*.css` (comments stripped) grepped across
  src/index.html/e2e/scripts.
- scripts: basename grepped in package.json, .github, .husky, scripts, src, e2e,
  supabase, .claude, CLAUDE.md, docs/OPEN.md.

---

## A) Names that don't match what the thing is

| # | Current name | Where | What it actually is | Suggested | User-visible | Blast radius |
|---|---|---|---|---|---|---|
| A1 | `jobs.customer_id` | DB column; 134 files / 493 lines in src+functions | The poster. App is not role-based; the UI says "poster" everywhere | `poster_id` | No | Very high: DB column, RLS, ~60 SQL fns, RPC `get_job_customer_id`, anonymisation list. Contract, not worth it pre-launch |
| A2 | `jobs.helper_id` (+ `helper_*` columns: `helper_completed_at`, `helper_confirmed_at`, `helpers_needed`) | DB; 162 files / 833 lines | The hired worker on this job (a per-job side, not an account type) | `worker_id` / `hired_user_id` | No | Very high, DB contract. Report only |
| A3 | `profiles.role` checks: `(p as {role?}).role !== "customer"` | `src/components/admin/adminusers/AdminUserRow.tsx:166`; `useAdminUsersFilter.ts:48` | `profiles` has NO `role` column (types.ts), roles live in `user_roles` and every signup is `'customer'` (`20260908002148…sql:607`). So `isHelper` is always true and the Denied-tab `role === "customer"` clause is always false: a retired role split kept alive by a cast | Delete the role branches (IDV/Stripe chips then just gate on `hasIdv`/`hasStripe`) | Admin only | 2 call sites, no contract |
| A4 | "helpers · customers" metric sub-label | `src/components/admin/AdminAnalytics.tsx:459` (+ `adminAnalyticsHelpers.ts:40-41`) | Users who have worked a job vs posted one; one person can be both, so the sum can exceed Total Users | "N worked · N posted" | Admin | 1 file |
| A5 | `DisputeLinkSide = "customer" \| "helper"` | `src/components/jobs/DisputeLink.tsx:41`; callers `CompletedStep.tsx:42`, `InProgressStep.tsx:76` | Poster side vs worker side of one job. Sibling `JobStepCard` already uses `"helper" \| "poster"` | `"poster" \| "helper"` | No | 3 files |
| A6 | `NpsRole = "customer" \| "helper"` | `src/lib/nps.ts:36,186`; `review-nag-cron/index.ts:276` | Which side of a job the NPS is about | `"poster" \| "helper"` | No (may be stored in `nps_responses` — check column values before renaming) | 2 files + possibly stored enum values |
| A7 | `get_job_customer_id(job_id)` | RPC; 2 SQL callers (`20260907060556_gate_helper_awa…`) | Returns the poster | `get_job_poster_id` | No | SQL only |
| A8 | "helper" in user-facing error copy | `supabase/functions/create-payment/index.ts:932` ("This helper hasn't set up their payout account…"); `auto-expire-jobs/index.ts:238` cancellation_reason "…no helper assigned" (stored, surfaced via `appliedJobCardHelpers.ts:130 describeCancellation`) | Brand noun is "Helpr" (`SavedHelpersTab.tsx:95` "Saved Helprs", `DisputeTimelineDialog.tsx:359` "Helpr") | "This Helpr…" / "…no Helpr assigned" | YES | 2 strings; the cancellation_reason is persisted in rows and matched by a test (`appliedJobCardHelpers.test.ts:107`) — change both, old rows keep old text |
| A9 | `CheckoutStep` copy "Helper earns $Y" | `src/components/postjob/CheckoutStep.tsx:210` | Inside a comment describing the copy; verify the rendered string on screen | "Helpr earns" if rendered | Possibly | 1 |
| A10 | `/dashboard` route + `Dashboard.tsx` | `src/App.tsx:182` | Nav label "Home" (`mobileNavHelpers.ts:40`, `DesktopSidebarNav.tsx:54`), page heading "Browse Jobs" (`Dashboard.tsx:361`) — three names for one screen | Route `/browse` (guest already uses it), component `BrowseJobs` | Route is in URLs/deep links | High: 1 route, many `navigate("/dashboard")`, AASA, email links; `/dashboard/post-login` redirect already exists |
| A11 | `DashboardGuest.tsx` on `/browse` | `src/App.tsx:336` | Public "Browse Jobs" page (`DashboardGuest.tsx:832`) | `BrowseJobsGuest` | No | 1 import |
| A12 | `Activity` page on `/my-jobs` + `/my-posts`; `ActivityLegacyRedirect` on `/activity` | `src/App.tsx:185-194` | Nav labels "Jobs" and "Posts"; no screen called Activity exists any more. Folder `src/pages/activity/`, `src/components/activity/` | `JobsAndPosts` (or split) | No (route names fine) | High: whole folder, many imports; rename only if touching anyway |
| A13 | `/saved-helpers` route, `profile?tab=saved_helpers`, `SavedHelpersTab`, table `favorite_helpers` | `src/App.tsx:350`, `SaveHelperButton.tsx:96`, `src/components/profile/SavedHelpersTab.tsx` | UI title is "Saved Helprs"; table says "favorite" while UI says "saved" | table `saved_helprs` not worth it; code `SavedHelprsTab` | URL yes | Route is a link target (1 caller); tab key may be in notifications links |
| A14 | `saved-helper-availability-push`, `get_approved_helpers`, `get_top_helpers_by_parish`, `helper_has_advanced_analytics`, `helper_credentials`, `review_helper_credential` | edge fn + RPCs/table | Apply to every account (not role-based); "helper" here means "any user" | `saved-helpr-…`, `user_has_advanced_analytics`, `user_credentials` | No | DB/cron contract; `saved-helper-availability-push` is invoked by pg_cron (10 migration refs) — rename needs cron repoint |
| A15 | `pet_profiles.is_evacuation_registered` | DB column (`20260612270000_pet_care_vertic…`) | Evacuation feature was removed (`App.tsx:432` comment); zero readers in src/functions | drop (see B) | No | 0 app refs |
| A16 | `jobs.scope_video_thumbnail_url` | added in `20260612340000_time_banking.sql` | Time-banking migration name (retired model) owns an unrelated column; 0 readers | drop (see B) | No | 0 |
| A17 | `instant-job-match` edge function | `supabase/functions/instant-job-match/` | Not "instant book"; it fans out new-job match notifications to all approved users | `new-job-match-push` | No | Cron/trigger contract + comment refs in `ProfileEditForm.tsx:302`, `useJobSubmit.ts:632` (excluded file) |
| A18 | `HomeHistory.tsx:145` / `HomeHistory.test.tsx:49` "INSTANT BOOK" branch comments | src | Instant Book dropped by `20260904034410`; the test fixture still models it | Remove the instant-book case from the test | No | 2 files |
| A19 | `send-marketing-blast` segment `"helpers"` | `supabase/functions/send-marketing-blast/index.ts:42,250` | Users with an application row | `"workers"` / `"applicants"` | Admin | 1 fn + admin UI caller |
| A20 | `src/pages/jobs/` folder (`jobsConstants.ts`, `types.ts`) | | No `Jobs` page exists; comment in `jobsConstants.ts` says the page was refactored away | fold into `src/lib/jobCategories.ts` | No | see B2/B3 |

Checked and clean: no `parish_pool`/`time_credit`/`instant_book` identifiers remain in
live code (comments only); `staging` hits are comments/unrelated verbs; no route path
contradicts its page title other than A10/A12.

---

## B) Unreachable / probably deletable

### Code

| # | Item | Evidence | Confidence |
|---|---|---|---|
| B1 | `e2e/prodSessions.ts` (76 lines) | 0 importers in e2e/scripts/src/playwright config/package.json/.github; only a comment mention in `scripts/audit/press-every-control.mjs:25`. Added 2026-09-12 — may be in-flight for the no-mock migration | PROBABLY DEAD (new today; confirm with owner of the no-mock work before deleting) |
| B2 | `src/pages/jobs/types.ts` (`PublicJob`) | 0 importers; `PublicJob` appears elsewhere only in a comment (`src/lib/jobDisplayPay.ts:27`) | PROVEN DEAD |
| B3 | `src/pages/jobs/jobsConstants.ts` | Only importer is `src/lib/jobCategories.test.ts:22`; the file itself says every other reader was refactored away | PROVEN DEAD in prod code (move `ALL_CATEGORIES` into the test or `jobCategories.ts`) |
| B4 | No other unimported `src/` component/page/hook | whole-tree import scan, duplicate basenames checked by full path | — |

### Routes (all `<Navigate>` redirects with 0 in-app links)

| # | Route | Evidence | Confidence |
|---|---|---|---|
| B5 | `/dashboard/post-login` → `/dashboard` (`App.tsx:437`) | 0 refs in src, supabase/functions, public, ios | PROBABLY DEAD (old OAuth return URL; check Supabase Auth redirect allow-list before removing) |
| B6 | `/settings/profile` → profile (`App.tsx:446`) | 0 refs | PROBABLY DEAD (old bookmarks only) |
| B7 | `/help-center` → `/help` (`App.tsx:413`) | 0 refs | PROBABLY DEAD (external links / App Store support URL could point here — check ASC metadata) |
| B8 | `/warnings` → `profile?tab=warnings` (`App.tsx:274`) | 0 in-app refs; only `public/robots.txt:40`. Stored `notifications.link` values may still carry it (not verified, DB unavailable) | PROBABLY DEAD → KEEP until `select count(*) from notifications where link like '/warnings%'` = 0 |
| — | `/earnings`, `/data-rights`, `/schedule`, `/availability`, `/saved-helpers`, `/settings`, `/gift-card`, short links | each has ≥1 ref (link, email, AASA or toast) | KEEP |

### Edge functions (72 dirs)

Every function has a caller except:

| # | Function | Evidence | Confidence |
|---|---|---|---|
| B9 | `apple-app-store-notifications` | 0 invokes (it is Apple's server-to-server webhook; `config.toml:85` verify_jwt=false; guarded by `src/test/appleIap.test.ts:225`) | KEEP if the URL is registered in App Store Connect; memory notes the Apple IAP path is booby-trapped — owner decision |
| — | `brand-asset` | used as `<img>` URL in email HTML | KEEP |
| — | `backfill-job-geocode`, `expiring-jobs-push`, `cleanup-notifications`, `marketing-token-health`, `saved-helper-availability-push` | 0 client invokes but scheduled from migrations (pg_cron/pg_net) | KEEP (verify rows exist in `cron.job` once MCP is authorized) |

### Database (from types.ts vs code; NOT verified live)

Tables with zero reader in src or supabase/functions:

| # | Object | SQL callers | Confidence |
|---|---|---|---|
| B10 | `pet_report_cards` table | only create + ban-gate trigger list; 0 app readers/writers | PROBABLY DEAD (the "output side" of pet care that was never wired, per `20260823160000_job_pets.sql:12`) |
| B11 | `subscription_cancel_reasons` table | only create + indexes; 0 writers | PROBABLY DEAD (cancel flow never writes it) |
| B12 | `user_strikes` table | create + anonymisation list only; strikes are handled elsewhere | PROBABLY DEAD — verify row count first; moderation data, do not drop blind |
| — | `job_views`, `profile_views`, `profile_search_rate_log` | written/read by SQL functions | KEEP |

RPCs with zero callers in src, functions, SQL and cron:

| # | RPC | Confidence |
|---|---|---|
| B13 | `get_public_avg_rating`, `get_public_completed_job_count`, `get_public_job_stories` (one-off `20260426095550`, anon-granted) | PROBABLY DEAD — also anon attack surface |
| B14 | `get_platform_benchmarks`, `get_marketplace_activity_count`, `get_hero_parishes`, `get_helper_parish_badges`, `get_approved_helpers`, `review_helper_credential`, `count_profiles`, `cron_dispatch_health` | PROBABLY DEAD (landing/marketing widgets and an admin credential review that no UI calls). `count_profiles` is anon-granted "for the public" per `20260505200000` but nothing calls it. `cron_dispatch_health` may be an operator query — ask |
| B15 | `get_recent_public_payouts`, `get_platform_impact_stats`, `get_monthly_profile_view_count` | only referenced in grant/revoke lists | PROBABLY DEAD |
| — | `sweep_*`, `prune_*`, `detect_suspicious_user_patterns`, `extend_boosts_with_no_applications`, `is_*`, `resolve_auto_tip`, `my_credential_tier`, `get_parish_for_city`, `job_expires_at_for_schedule`, `helper_has_advanced_analytics`, `get_top_helpers_by_parish`, `get_job_customer_id`, `fan_out_broadcast_to_notifications`, `get_service_role_key`, `log_cron_defect`, `profiles_locked_update_columns`, `sync_profiles_update_grants`, `redact_audit_snapshot`, `is_thread_muted`, `miles_between`, `user_has_pending_application`, `cleanup_observability_tables` | called from cron, triggers, RLS or other SQL | KEEP |

Columns with zero reader in src/functions and no SQL use beyond ADD COLUMN:

| # | Column | Confidence |
|---|---|---|
| B16 | `pet_profiles.is_evacuation_registered` (retired evacuation) | PROBABLY DEAD |
| B17 | `jobs.protection_opted_in` (only in `fixtureSchemaContract.test.ts:185`) | PROBABLY DEAD |
| B18 | `jobs.scope_video_thumbnail_url` | PROBABLY DEAD |
| B19 | `profiles.push_consent`, `profiles.sms_consent` (`20260708042035`) | PROBABLY DEAD — but consent columns may be a compliance record; KEEP unless owner says otherwise |
| B20 | `platform_settings.latest_build` | PROBABLY DEAD (superseded by `minSupportedBuild.ts`?) — check its source column |
| B21 | `pet_report_cards.*` (goes with B10) | PROBABLY DEAD |
| — | ~45 more zero-app-reader columns (`cron_work_expectations.*`, `helper_credentials.license_*`, `profiles.*_reviewed_at/_by`, `jobs.*_sent_at`, `profiles.hourly_rate`, `id_verification_status`, `has_applied_before`, `hybrid_idv_enabled`) | written/read by SQL functions, triggers or crons (10–45 migration refs each) | KEEP |

### Feature flags

No always-off client flag exists: `src/lib/featureFlags.ts` is already deleted
(`minSupportedBuild.ts:22`). `platform_settings.hybrid_idv_enabled` has no src/function
reader but 10 SQL refs — KEEP pending a live `pg_get_functiondef` read.

### Scripts with no caller (no package.json/CI/hook/doc reference)

| # | Script | Confidence |
|---|---|---|
| B22 | `scripts/dh-apply-shots.mjs`, `scripts/dh-nearby-shots.mjs` (lh-design-holes one-off screenshots, 2026-09-08) | PROBABLY DEAD |
| B23 | `scripts/probe-state-matrix.mjs` (lh-state-matrix one-off probe) | PROBABLY DEAD |
| B24 | `scripts/backfill-identity-fingerprints.mjs` ("One-off", 2026-09-07) | PROBABLY DEAD once confirmed run |
| B25 | `scripts/prerender.mjs` (2026-05-11, not in package.json build) | PROBABLY DEAD |
| — | `scripts/asc/*.mjs` (4), `scripts/build-app-icon.mjs`, `scripts/ios-state-probe.sh`, `scripts/form-inventory.mjs`, `scripts/probes/restrict-marketing-media.probe.mjs` | human operator tools | KEEP |

### CSS classes defined but never used (src/index.css)

Search the selector in `src/index.css`; 0 hits across src, index.html, e2e, scripts,
supabase, capacitor config (`safe-pt` string appears only in capacitor.config.ts comment context — verify).

| # | Classes | Confidence |
|---|---|---|
| B26 | `.safe-pb`, `.safe-px`, `.text-body-relaxed`, `.text-section-title`, `.text-card-title`, `.animate-slide-up`, `.animate-slide-down`, `.tier-gold-soft`, `.line-clamp-4`, `.doc-row-alt`, `.doc-section`, `.doc-rule`, `.plan-masthead-title`, `.plan-card-name`, `.plan-card-price` | PROVEN DEAD (0 refs; no dynamic class-string construction found for these prefixes) |
| B27 | `.app-bottom-nav`, `.app-shell-viewport` | PROBABLY DEAD — shell classes; confirm no `classList.add` template in native/iOS code |
| B28 | `.safe-pt` | PROBABLY DEAD (only a string hit in capacitor.config.ts) |
| — | `.leaflet-*` (8), `.lucide-arrow-right` | third-party DOM | KEEP |

---

## Totals

- A (naming): 20 mismatches — 3 user-visible copy (A8, A9, A10 URL), 5 admin-visible, 12 internal; 7 are DB/cron contracts.
- B (deletable): 28 rows covering ~60 objects.
  - PROVEN DEAD: 3 rows (B2, B3, B26 = 2 files + 15 CSS classes).
  - PROBABLY DEAD: 22 rows (1 e2e file, 4 routes, 3 tables, 14 RPCs, ~8 columns, 5 scripts, 3 CSS classes).
  - KEEP (human/external caller): apple-app-store-notifications, cron-driven edge fns, operator scripts, third-party CSS.
- Blocker to upgrading PROBABLY → PROVEN on DB items: Supabase MCP needs re-auth; run the
  `to_regprocedure`/`cron.job`/row-count checks on prod.

## Side finding (not naming)

A3 is a stale-concept bug shape rather than a live defect: because `profiles.role` does
not exist, the Denied tab and the IDV/Stripe chips behave as if the role check weren't
there. Harmless today, but it reads as if chips are hidden for "customers".

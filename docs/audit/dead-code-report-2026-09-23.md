# What the app no longer uses: dead-code report (Q41), 2026-09-23

REPORT ONLY. Nothing was deleted or changed. Measured on main @ d12ea4946 and on
live prod (`fncmgoasalhdgfwzhsqa`, read-only SQL + logs) between 13:30Z and 14:30Z.
Scratch scripts and raw outputs: `~/.lh-shots/q41/` (knip JSON, reference
counters `refs.py`, `edge.py`, `rpc.py`, `tables.py`, `scripts.py`, `docs.py`).

## Summary for the owner (plain English)

The app is in good shape here: the automatic tool (knip) finds **0 unused files**
and no unused packages. What is left is mostly **leftovers from design decisions
you already made**: screens you asked to remove whose code was kept, a few
database helpers nothing calls, and old one-off scripts and notes.

- **Group (a), safe to delete (about 1,200 lines of app code + tests, 1 database
  function).** Three screen pieces you removed on purpose are still in the code
  and only their own tests use them: the second "recent reviews" wall on public
  profiles (you chose "one list only"), and three small badges/pickers that no
  screen shows any more. Plus 97 names that are marked shareable but that
  nothing imports. Removing them changes nothing anyone can see.
- **Group (b), probably dead, your call (about 1,800 lines of app/server code,
  2 tables, 2 columns, plus 21 old scripts of 4,750 lines and 12 unlinked docs).**
  Things that look unused but belong to a product decision: the weekly schedule
  strip you took off the Earnings page (move it elsewhere, or delete?), the W-9
  tax form flow (nothing can turn it on), Apple Wallet pass and Apple in-app
  purchase code, the retired group-jobs buttons, two old redirect links, old
  audit scripts and notes. Two database clean-up jobs were written but never
  switched on, so old Stripe and analytics rows are not being pruned.
- **Group (c), dormant on purpose, KEEP.** Background checks (your decision:
  keep switched off), the idle sign-out (kept as a one-line switch), the ID
  upload leftovers (already work item Q40), the bond (already removed, Q141).

Why (a) is safe: each item was checked in every place that could use it (the
app's code, the server functions, the database, scheduled jobs, CI, scripts),
not with one search, and the commit that removed its last use is named.

## How it was measured

| Area | Method | Result |
|---|---|---|
| Unused files/exports | `npx knip --reporter json` with the repo config (`knip.json`; tests, e2e and scripts are entry points) | 0 files, 0 deps, **97 exports + 11 types** (= `scripts/deadcode-baseline.json`), 30 duplicate exports |
| Files only tests reach | knip again with a production-only config (`~/.lh-shots/q41/knip-prod.json`: entries = `src/main.tsx` + every edge `index.ts`, tests ignored) | **5 files** reachable only from tests; each then re-checked by grep of import/JSX lines and comments read |
| Unrendered components | `grep "<Name"` across src/e2e for every component export knip flagged | 4 components with 0 renders |
| Routes | every `path=` in `src/App.tsx` (45) counted as a quoted link in non-test `src/` (App.tsx excluded) and in `supabase/functions`, `public`, migrations (emails/push links); then `analytics_events` page paths, last 30 days | 2 routes with 0 links anywhere |
| Edge functions | `list_edge_functions` (73 deployed = 73 in repo); per function: name mentioned outside its own dir; then strict: `invoke("name")` / `functions/v1/name` / quoted name, comments stripped, tests excluded; `cron.job` (26 HTTP jobs); `function_edge_logs` per function id, 14 x 24h windows 2026-09-09..09-23 | 8 with no in-repo caller: 7 are called from outside (Stripe/Resend/Apple/IDV webhooks, the Supabase auth email hook, the unsubscribe link in emails), 1 (`helpr-pass-wallet`) by nothing. 2 (`claim-gift-card`, `stalled-completion-reminder`) had no log line in 14 days, yet both have callers (client, cron) |
| DB functions | 343 `public` functions (extension-owned excluded); per function: trigger (`pg_trigger`), other function bodies (public/private/auth/storage `prosrc`), `pg_policies`, views, column defaults + CHECKs, `cron.job`; zero-hit ones then grepped in non-test src, supabase/functions, scripts, e2e, .github for `.rpc("x")`, `/rpc/x`, quoted name or call | **5 with 0 callers anywhere** (+4 reached only by tests) |
| Tables | exact `count(*)` of all 88 public tables (pg_stat counters were reset, e.g. `job_completion_nudges` showed 0 but holds 13); 23 zero-row tables checked for `.from("x")` writers in client/edge and for DB function/view references | 2 with no writer anywhere |

**Caveat on logs (measured):** `function_edge_logs` is incomplete. The
`stalled-completion-reminder` cron dispatched OK on 09-20 14:00Z and that run
wrote rows (`job_completion_nudges` max `created_at` 2026-09-20 14:00:50Z), yet
the log stream has no line for that function id in 14 days. So "no log line"
is never used below as proof of dead; only code + DB callers are.

---

## (a) Safe to delete: 0 callers by every check listed

| # | Item | Size | Evidence (0 callers by these checks) |
|---|---|---|---|
| a1 | `src/components/profile/PublicReviewWall.tsx` + `PublicReviewWall.test.tsx` | 396 + 601 lines | knip-prod: reachable only from tests. Non-test mentions (5) are all comments (`UserProfile.tsx:691,717`, `ReviewsSection.tsx:8`, `reviewCard.tsx:9,19,25`, `useProfileTabData.ts:189`). Last render removed by 56e452c7b "VN-15: public profile shows one review list" (owner pop-up "One list only"). Also referenced by `src/test/reviewCardOneDesign.test.tsx`, `src/pages/user/singleReviewList.test.ts`, `src/test/controlInteractionLedger.json`: those need the entry dropped, not deleted. |
| a2 | `DashboardInProgressBadge` component (keep `inProgressBadgeTarget` in the same file; `ScheduleTab.tsx:28` uses it) | ~52 of 117 lines | knip: export unused; `grep "<DashboardInProgressBadge"` 0 in src/e2e. Last render removed by de9fe87d1 (home chrome). |
| a3 | `IdVerifiedPill` component (keep `IdVerifiedShield`, `ID_VERIFIED_*`; `RecognitionRow.tsx` imports those) | ~15 of 69 lines | knip: export unused; 0 JSX renders. Removed by 3d0d7a301 "VN-1/VN-2: drop ID-verified pill" and 096a75628 "one ID-verified badge". |
| a4 | `TimePickerSelect` component (keep `formatTime12`; `TimeRangeField.tsx:5` uses it) | ~70 of 87 lines | knip: export unused; 0 renders. Replaced by 02db3ed95 "Match Edit Job's start-time picker to Post-a-Job's design". |
| a5 | `PhotoProofStep` (end of `src/components/PhotoProof.tsx`) | ~62 of 693 lines | knip: export unused; 0 renders; comments at PhotoProof.tsx:33,357 still describe it and would need a line each. |
| a6 | `src/lib/proTiers.ts` (client re-export of `supabase/functions/_shared/proTiers`) | 14 lines | knip-prod: reached only by `proTiers.parity.test.ts`; point that test at the `_shared` module directly. |
| a7 | The remaining knip exports: 97 exports + 11 types in 54 files (full list `~/.lh-shots/q41/knip-exports.txt`). Fix = drop the `export` keyword (not the code) and lower `scripts/deadcode-baseline.json` in the same commit. | 108 names | knip (repo config, tests count as users). **Exclude** from "safe": the 5 `src/test/edge/mocks/*` files (25 names; they mirror a real module's surface on purpose) and the 12 email-template `default` exports (duplicates of the named export). |
| a8 | DB `fan_out_broadcast_to_notifications(uuid)` | 40 lines | 0 triggers, 0 function bodies (incl. `sweep_pending_broadcast_fan_outs`, which does its own fan-out inline), 0 policies/views/defaults, 0 cron; 0 `.rpc`/`/rpc/`/quoted uses in src, functions, scripts, e2e, CI. Other mentions: a label in `src/test/seedNeverNotifiesReal.test.ts:176`, generated `types.ts`, `scripts/audit/write-contract.snapshot.json` (each needs its entry dropped). proacl: postgres + service_role only. Needs a migration (`DROP FUNCTION IF EXISTS`). |

Not dead after all (flagged by a tool, kept): `src/config/showSeedJobs.ts`
(142 lines) is the registry the seed-visibility guard reads
(`showSeedJobs.parity.test.ts`, `scripts/launch-go.mjs`, `check-launch-flags.sh`);
`rate_limit_hit` looked uncalled by `.rpc(` but is called by
`_shared/rate-limit.ts:229` over `/rest/v1/rpc/`.

## (b) Probably dead: needs an owner decision

| # | Item | Size | Why it looks dead | Why it needs you |
|---|---|---|---|---|
| b1 | `src/components/profile/HelperScheduleStrip.tsx` + test | 435 + 272 lines | knip-prod: reachable only from tests; 0 renders. Taken off Earnings by 98635843e "VN-3 ... schedule strip off this page". | VN-3 said "off this page", not "remove". Show it elsewhere, or delete? |
| b2 | W-9 flow: `W9CollectionDialog.tsx`, table `helper_w9_records`, column `jobs.requires_w9`, `jobs.business_id` | 150 lines + 1 table + 2 columns | Nothing sets it: `requiresW9` is never passed by any caller of `jobSubmitHelpers.ts`; prod has 0 jobs with `requires_w9`, 0 with `business_id`, 0 W-9 rows. The dialog is still wired in `Activity.tsx:766`, so it is reachable only if a job has the flag. | Business accounts were removed; is W-9 collection coming back for launch (tax), or go? The table comment says W-9s are legally retained, so a drop is a real decision. |
| b3 | Group-job RPCs `rpc_group_member_confirm`, `rpc_group_member_mark_arrival`, `rpc_group_member_set_proof`, `rpc_poster_confirm_member_arrival` | 41 + 126 + 27 + 45 lines | 0 DB callers, 0 app callers; only one test each. Group jobs withdrawn 2026-09-01 (`reject_new_group_jobs` trigger). | Prod still has 1 group job and 2 `group_job_helpers` rows. Keep for a future group-jobs rebuild, or drop? |
| b4 | DB `cleanup_stripe_webhook_events()` and `cleanup_observability_tables()` | 6 + 6 lines | 0 callers anywhere and **no cron job runs them** (cron.job: 59 jobs, none). | Not dead code but a gap: three webhook functions say "`cleanup_stripe_webhook_events()` prunes at 30 days" (`stripe-webhook/index.ts:267`, `stripe-idv-webhook/index.ts:205`, `verification-webhook/index.ts:269`); prod holds 9 `stripe_webhook_events` rows older than 30 days (oldest 2026-07-08) and 221 `analytics_events` older than 90 days (oldest 2026-05-03). Schedule them or delete them (Q167). |
| b5 | DB `cron_dispatch_health()` | 41 lines | 0 callers anywhere. | A diagnostic for humans/agents (its comment says so). Keep as a tool or drop. |
| b6 | Table `user_strikes` | 9 columns, 0 rows | No writer: 0 app/edge writes, only `purge_user_data` (delete on account purge) and test/probe cleanup scripts. Strikes live in `user_violations` (4 rows). | Drop needs `purge_user_data` edited too; confirm nothing else is planned for it. |
| b7 | Edge `helpr-pass-wallet` (Apple/Google Wallet pass) | 228 lines | No client, cron, webhook or function caller (strict check); only its test. | Scaffold waiting on a Pass Type certificate. Keep for later or delete? |
| b8 | Apple IAP: edge `apple-app-store-notifications` (183 lines), `verify-apple-iap` (251), `src/lib/iap.ts` (`assertMayPurchase` unused) | ~430+ lines | The webhook has no in-repo caller (Apple calls it only if configured in App Store Connect). Memory: the `feat/apple-iap` branch is "booby-trapped, rebuild, never merge". | Is in-app purchase still planned? |
| b9 | Redirect routes `/help-center` -> `/help` and `/settings` -> `/profile` (`App.tsx:443,475`) | 2 lines | 0 in-app links, 0 links in emails/push/functions. analytics_events 30d: `/settings` 1 visit, `/help-center` 0. | Old bookmarks/emails might use them; removal saves nothing. Recommend keep unless you want them gone. (`/warnings`, `/earnings`, `/schedule`, `/availability`, `/saved-helpers` have server or in-app links: keep.) |
| b10 | Scripts no workflow, package.json, hook, script or test references: `scripts/asc/{fix-availability,inspect,screenshots}.mjs` (223 lines), `scripts/probes/{arrival-bad-pin,arrival-confirm-nudges,business-rename-rereview,default-client-grants,gift-card-rename,null-uid-guards}.probe.mjs` (1,224 lines) | 9 files, 1,447 lines | `~/.lh-shots/q41/scripts.py` over 196 scripts: basename/path searched in package.json, .github, .husky, .claude, scripts, src, e2e, supabase, docs. | Probes are the proof records behind past fixes; the asc tools are App Store Connect helpers. Delete or move to an archive folder? |
| b11 | Scripts referenced only from docs (12, 3,305 lines), e.g. `scripts/backfill-identity-fingerprints.mjs`, `scripts/ios-state-probe.sh`, `scripts/mapkit-token.mjs`, 9 `scripts/probes/*` named only in `docs/archive/OPEN-history-2026-09.md` | 12 files | same script | same question as b10 |
| b12 | Top-level docs nothing links to (12): CUSTOM_PRODUCT_PAGES (04-26), APPLE_SIGN_IN_SETUP (05-05), SENTRY_ALERT_RULES_PASTE_CHECKLIST (05-10), IOS_BUILD_RUNBOOK (05-18), polish-audit-blueprint (06-08), COWORK_AUDIT_PROMPT (08-23), SALES_TAX_ZERO_COLLECTED (09-04), SUPABASE_AUTO_DEPLOY_MIGRATIONS (09-06), MARKETING_AUTOPOSTER (09-06), PAYOUT_BUDGET_RAISE_GAP (09-12), function-grant-guard (09-15), LOGO_UPDATE_RUNBOOK (09-20) | 1,608 lines | `~/.lh-shots/q41/docs.py`: filename searched in docs, src, scripts, .github, e2e, .claude skills/agents, CLAUDE.md, AGENT-BRIEF (date = last commit). | Runbooks can be unlinked yet useful (IOS_BUILD_RUNBOOK, LOGO_UPDATE_RUNBOOK). Also `docs/FABLE_LEAD_AUDIT_PROMPT.md` describes a fable-led audit, which you have forbidden. Archive, delete or keep each. |
| b13 | Branches | 12 remote heads now; 87 local branches | Q150 owns this (triage file `~/.lh-backups/unmerged-branch-triage-20260923.txt`, 37 rows). Local merged branches are pruned by `.claude/hooks/git-hygiene.sh`. | Decisions stay in Q150. |

## (c) Dormant by decision: KEEP, not removable

| Item | Size | State measured | Decision |
|---|---|---|---|
| Background checks: `BackgroundCheckCard.tsx`, edge `create-bgc-payment`, edge `verification-webhook`, the `stripe-webhook` background_check branch, tables `verification_checks` / `verification_exceptions` | 191 lines (card) + 2 functions | 0 rows in both tables; `create-bgc-payment` and `verification-webhook` each had log lines only on 09-11/09-15 (audit sweeps). | Owner 2026-09-23: keep, switched off. |
| Idle sign-out: `src/hooks/useSessionTimeout.ts` + test, the "signed out for inactivity" banner in `Login.tsx:113-130` | 67 + 170 lines | knip-prod: test-only; `App.tsx:519-532` documents it as a deliberate one-line revert. | Kept on purpose (pre-launch testing). |
| ID upload to us (Q40): `profiles.id_document_url`, `id-documents` bucket, admin "ID Document" section, `complete-signup` `portfolioFiles` | see Q40 | 53 profiles hold `id_document_url` (52 seed, 1 not); bucket holds 1 object. | Already work item Q40. |
| Bond | n/a | Removed (Q141). | Done. |
| Seed-visibility registry `src/config/showSeedJobs.ts` | 142 lines | Read by a guard and launch scripts. | Test infrastructure, not app code. |

## Found on the way (not dead code)

- The unscheduled pruners in b4 are a real gap with a false claim in three
  code comments; filed as **Q167**.
- The 12 unlinked docs in b12 overlap **Q165** (archive stale reports).
- `function_edge_logs` misses real invocations (see caveat above); any future
  "dead edge function" check must not rely on it.

## Addendum 2026-09-23 (Q243, carried from the 09-14 audits) — REPORT ONLY, nothing deleted

| Code | Why it looks dead | Measured |
|---|---|---|
| `supabase/functions/_shared/slack-alerts.ts` transport 2 (`LOVABLE_API_KEY` + `SLACK_API_KEY` via connector-gateway.lovable.dev) | Kept "so an existing deployment configured that way keeps working"; transport 1 is the recommended path | The comment at lines 9-17 says so; whether prod still has `LOVABLE_API_KEY` set was not checked here |
| `stripe-webhook/handlers/checkoutSessionCompleted.ts` `repay` branch (`isRepay`, lines 781/901/911/927) | Reads `session.metadata.repay === "true"`, but no code mints a checkout with that metadata | `grep -rn repay supabase/functions src` finds only this reader and the unrelated chargeback `repayClawback` path |

Decision is the owner's (MORNING QUESTIONS 9 covers dead-code deletions).

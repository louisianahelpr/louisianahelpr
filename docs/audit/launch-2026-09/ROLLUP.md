# Launch audit — findings rollup

_Generated 2026-09-02T03:35:07.085Z from findings.jsonl. Do not hand-edit — run `node scripts/audit-bus.mjs rollup`._

**12 live findings** · 3 launch blockers · 1 retracted · 1 fixed

## HIGH (4)

| ID | Blocker | Status | Surface | Claim | Agent | Evidence |
|---|---|---|---|---|---|---|
| SI-001 | **YES** | filed | `worker_protection_credits` | Worker protection credits appear to be created but never issued/applied: table referenced by 1 src file (CancellationDialog.tsx) and 0 edge functions, yet has a pending->issued->applied->expired status machine | lh-schema-integrity | 2 |
| SI-005 | **YES** | filed | `create_business_api_key + business_* objects` | B2B tier is removed as a product but its SECURITY DEFINER API-key-minting RPC and related tables may still exist in prod: live attack surface for a product that no longer exists | lh-schema-integrity | 1 |
| O-001 |  | fixed | `.claude/commands/audit.md` | The /audit command still instructed every audit that there is 'no meaningful native code' - the exact sentence CLAUDE.md identifies as the cause of push being dead for the life of the project. FIXED during fleet setup. | lh-orchestrator | 1 |
| O-002 | **YES** | filed | `/my-posts (Activity posted tab)` | E2E happy-path is RED on main: three independent specs fail because /my-posts renders no job card for an authed customer - customer-post-job ('shows a posted job'), customer-sees-application ('surfaces the applicant count'), and activity-card-density ('No-Show appears once start time passed', timing out on boundingBox). Element(s) not found, both attempts and retries. | lh-orchestrator | 4 |

## MEDIUM (7)

| ID | Blocker | Status | Surface | Claim | Agent | Evidence |
|---|---|---|---|---|---|---|
| SI-002 |  | verified | `time_credits` | time_credits (time banking) has no product surface: referenced only by 2 test files in src/; balance_after is an app-maintained snapshot with no DB-level guarantee, so it can drift silently | lh-schema-integrity | 1 |
| SI-003 |  | filed | `businesses / business_* (deleted B2B tier)` | B2B tier is deleted but its objects may still exist in prod; migration history still contains business RPCs incl. create_business_api_key (SECURITY DEFINER). Needs live pg_proc/pg_tables verification, not a migration read | lh-schema-integrity | 1 |
| SI-004 |  | verified | `helper_circles / helper_circle_members` | Dead tables with zero references anywhere: 0 files in src/, 0 edge functions. Superseded by favorite_helpers + ?tab=saved_helpers | lh-schema-integrity | 1 |
| RW-001 |  | filed | `/str-settings` | Route comment says the page is public and 'renders read-only for guests (current plan shows Free)' so the footer Plans link resolves for logged-out visitors, but the Route wraps StrSettings in ProtectedRoute with no guest bypass and StrSettings.tsx has no guest branch. Either the docs are stale or the footer Plans link bounces every logged-out visitor to login. | lh-route-walker | 2 |
| RW-003 |  | filed | `/admin?view=map, /admin?view=parishtax` | Two ?view= values are referenced in src/ but are not keys in VIEW_LABELS, so Admin cannot render them. Code comments record that a stale ?view=parishtax link previously rendered the home dashboard WITH an AdminSectionHeader whose title was undefined - an empty h1 stacked on home's own, caught by the UI sweep as 'expected exactly 1 h1, found 2'. Confirm the isRealView guard covers both and that nothing still links to them. | lh-route-walker | 1 |
| O-003 |  | filed | `AASA / universal links` | zz-runtime-probe AASA tests failing: '3a AASA is served over HTTPS with the claimed paths' and '3a-defect apex louisianahelpr.com serves AASA without a redirect'. If AASA is not served correctly, universal links do not open the app. | lh-orchestrator | 1 |
| O-004 |  | filed | `profile earnings tab` | e2e 'earnings tab renders one view at a time' failing on main - suggests two earnings views render simultaneously or none does. Note ?tab=payment aliases ?tab=earnings, which is a plausible source of a double render. | lh-orchestrator | 1 |

## LOW (1)

| ID | Blocker | Status | Surface | Claim | Agent | Evidence |
|---|---|---|---|---|---|---|
| RW-002 |  | filed | `retired marketing routes` | 10 retired routes (/enterprise, /how-it-works, /parishes, /parish/:slug, /impact, /local-guide, /community, /browse-jobs, /evacuation, /become-a-partner) have no redirect stub and fall through to NotFound. Intentional per code comments, but any external link, sitemap entry or indexed URL still pointing at them now 404s. | lh-route-walker | 1 |

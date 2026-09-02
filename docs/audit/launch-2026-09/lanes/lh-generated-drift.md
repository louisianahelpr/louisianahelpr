# Lane report — `lh-generated-drift`

**Sweep date:** 2026-09-02
**Base:** `origin/main` @ `ab2e4d15`, isolated worktree `~/.lh-audit/lh-generated-drift/`
**Prod project:** `fncmgoasalhdgfwzhsqa` (ref passed explicitly; `supabase/.temp/project-ref`
points at STAGING `okpxtpfvwtmbuxugqsws` and was not used)

## What I fixed

**Nothing.** Not for lack of findings — five were filed, all reproduced against live
state — but because every fix falls outside this lane's territory under PROTOCOL §1:

| Finding | The fix | Why not me |
|---|---|---|
| GD-001, GD-004, GD-005 | Regenerate `src/integrations/supabase/types.ts` | Regeneration lands type errors across other lanes' files; my brief forbids committing it during the sweep |
| GD-002 | Add a freshness guard to CI | CI workflows are orchestrator-only |
| GD-003 | Remove 4 stale casts | Four different lanes' files |

Escalated to the orchestrator with a request to be handed whichever of these it wants
in the FIX phase.

---

## Headline: the seam re-opened the same day it was closed

`types.ts` was regenerated earlier on 2026-09-02 and the resulting 25 errors across 17
files were fixed. Migration `20260902051631` then landed **later the same day**, dropped
`NOT NULL` on two more columns, and `types.ts` was not regenerated again. Prod already
holds 8 rows exercising the new nullability.

That is the SI-012 incident recurring within hours of being fixed, and it is the whole
argument for GD-002: the incident was never about one stale file, it was about there
being no mechanism. Fixing the file without adding the guard buys a few hours.

---

## Findings

### GD-001 — HIGH — types.ts asserts a guarantee prod has withdrawn (×2)

Two columns are nullable in prod while the committed types declare them non-null:

| Column | Repo `types.ts` | Prod |
|---|---|---|
| `legal_acceptances.user_id` (line 1731) | `string` | `string \| null` |
| `reports.reporter_id` (line 3231) | `string` | `string \| null` |

Neither appears in the six known-fixed columns (`jobs.customer_id`, `jobs.location`,
`jobs.latitude`, `jobs.longitude`, `reviews.reviewer_id`, `disputes.opener_id`).

**Live evidence** — `information_schema.columns` against prod:

```
legal_acceptances | user_id     | YES | uuid
reports           | reporter_id | YES | uuid
reports           | reported_id | NO  | uuid    <- still NOT NULL
```

**It is live-firing:** `select count(*) from legal_acceptances where user_id is null`
→ **8 of 17 rows**, written by the audit fleet's own test-account deletions.

Source: `supabase/migrations/20260902051631_account_deletion_reaches_tracking_consent_availability_favorites_reports.sql:65`.

**Runtime blast radius today: zero — stated plainly rather than inflated.** Every
consumer was already hand-hardened:

- `src/components/admin/AdminReports.tsx:44` declares its own `reporter_id: string | null`
  and guards at `:113`, `:416`, `:526`.
- `src/components/admin/AdminSupport.tsx:297-303` filters nulls out before `.in()`, with
  a comment naming migration `20260902051631` explicitly.
- `legal_acceptances` is append-only. All four references in `src/` and
  `supabase/functions/` are INSERTs; the re-consent decision reads
  `profiles.terms_version_accepted`, not this table. **No reader exists.**

I checked for the specific traps this lane exists to catch and found none of them:
no `?? ""` then `.includes()`, no unguarded `Map.get`, no null reaching a `uuid[]` RPC
parameter, no `.filter()` predicate that would empty a whole list.

Two source comments are now factually wrong, which is the residue that outlives the fix:
- `src/pages/Support.tsx:54` — "RLS + NOT NULL uuid `reporter_id`"
- `supabase/functions/contact-support/index.ts:7-8` — "`reporter_id` / `reported_id` are
  NOT NULL uuids". The `reported_id` half is still true; the `reporter_id` half is not.

Evidence: `~/.lh-audit/lh-generated-drift/evidence/types-prod-vs-repo.diff`,
`~/.lh-audit/lh-generated-drift/evidence/types-fresh-prod.ts`

### GD-002 — HIGH — nothing enforces `types.ts` freshness

The most useful thing this lane produced.

```
grep -rn -iE 'gen types|db:types|types\.ts|gen_types' .github/ .husky/
→ zero matches
```

- 24 workflow files: no reference.
- `.husky/pre-commit`: `npx lint-staged` + `check-migration-versions.sh`. No reference.
- `lint-staged` config: four entries, none for `types.ts`.
- `gh workflow list --all`: **all 27 workflows `active`.** This is a genuine absence,
  not a guard someone disabled.

**`db-drift-detect.yml` does not close this gap.** It compares migration *version lists*
— repo filename timestamps against prod's `schema_migrations` ledger. A migration present
on both sides reports zero drift, which is precisely the state during both SI-012 and
GD-001. It is a correct check of a different thing.

The comparison that makes this concrete — every other mirrored artifact in this repo
already has a guard, verified by running each (command output quoted in the Status column;
raw output at `~/.lh-audit/lh-generated-drift/evidence/`):

| Artifact | Guard | Status |
|---|---|---|
| `public/sitemap.xml` | `generate-sitemap.mjs --check` (`sitemap-drift.yml:67`) | ran it: "up to date (6 public URLs)" |
| iOS metadata (`project.pbxproj`, `Info.plist`, `capacitor.config.json`, `config.xml`, `Package.swift`) | `ios-metadata.yml` + `verify-ios-metadata.sh` | ran it: exit 0, 16/16 ✓, worktree stayed clean |
| iOS icons | `ios-icon-sync.yml` | active |
| migration ledger | `db-drift-detect.yml` — fails the run on drift | active |
| `_shared/legalVersions.ts` mirror | `legalVersions.parity.test.ts` | asserted by the test |
| Stripe type shim `scripts/edge-types/stripe-18.5.0.ts` | `typecheck-edge.mjs` asserts the import mapping is live | all 45 edge imports are `stripe@18.5.0` — coherent |
| **`src/integrations/supabase/types.ts`** | **none** | **stale, twice, in one day** |

One caveat on the iOS row, since it is the same defect class one step milder:
`verify-ios-metadata.sh` *regenerates before it asserts* ("Rewriting iOS metadata from
`fastlane/ios_app_metadata.yml` first…"), so it cannot detect a hand-edit — it silently
reverts one and reports green. It happens to be genuinely in sync today (the rewrite left
the worktree clean), so there is no defect to file, but it is a weaker guarantee than
sitemap's `--check`. Noted for `lh-build-release` / `lh-native-bridge`, not filed.

### GD-003 — MEDIUM — four stale casts that outlived the staleness they compensated for

Four sites cast away type checking to work around a `types.ts` that has since caught up.
All four target RPCs are live in prod **and** present in the committed `types.ts` —
established by `grep -c` against `src/integrations/supabase/types.ts` (1 each) plus
`select proname, pg_get_function_identity_arguments(oid) from pg_proc join pg_namespace
on … where nspname='public' and proname in (…)` against prod, which returned all four:

| Site | RPC | In `types.ts` | In prod |
|---|---|---|---|
| `AdminSupport.tsx:251` | `admin_support_queue` | yes | `p_status text, p_priority_tiers text[], p_head_start_minutes integer` |
| `AdminPayoutBatches.tsx:212` | `get_payout_batch_job_ids` | yes | `p_helper_id uuid` |
| `DisputeDialog.tsx:132` | `rpc_open_dispute` | yes | `_job_id uuid, _reason text, _evidence_urls text[]` |
| `applyRateLimit.ts:95` | `rpc_check_application_rate` | yes | `_applicant_id uuid` |

Three carry the comment "Drop the cast once `types.ts` is regenerated." It was. They
survived — because a regeneration event has no follow-up step, so the escape hatches
accumulate permanently. This is the failure mode the lane's brief calls "the dangerous
one": a widening the code silently absorbs.

**Arguments match prod today, so nothing is broken** — compare each call site's argument
object (`AdminSupport.tsx:252-254`, `AdminPayoutBatches.tsx:215`, `DisputeDialog.tsx:137`,
`applyRateLimit.ts:99`) against the `pg_get_function_identity_arguments` column in the
table above; all four agree. The defect is two permanently-open holes on trust paths:
`rpc_open_dispute` (`DisputeDialog.tsx:135`), and `rpc_check_application_rate` whose
PGRST202 branch at `src/lib/applyRateLimit.ts:105-107` converts a call failure into
*allow the apply*. A future signature change compiles clean and degrades to fail-open.

`(supabase.rpc as any)` (DisputeDialog, applyRateLimit) is strictly worse than
`as never` (AdminSupport, AdminPayoutBatches) — it untypes the whole call, arguments
included.

### GD-004 — MEDIUM — six objects live in prod, absent from the generated types

Table `edge_rate_limit_log`; functions `cron_dispatch_health`, `notify_ops_dispute_filed`,
`prune_edge_rate_limit_log`, `rate_limit_hit`, `sweep_cron_blackouts`. Verified live
against prod: `select to_regclass('public.edge_rate_limit_log')` → `edge_rate_limit_log`,
and a `count(*)` over `pg_proc` for those five `proname`s → `5`. Absent from the repo file:
diff hunks at `src/integrations/supabase/types.ts` lines ~410, ~4634, ~5469, ~5489, ~5608
in `~/.lh-audit/lh-generated-drift/evidence/types-prod-vs-repo.diff`.

No `src/` consumer today — these are edge/cron-side — so blast radius is zero. The
finding is that the generated file no longer describes the database.

### GD-005 — LOW — the committed file was not produced by the documented command

`types.ts` carries a `graphql_public` schema block (lines 14–38, plus a `Constants` entry
at ~5788) that `npm run db:types` — which passes `--schema public` — does not emit, plus
5 generic-signature parenthesisation hunks from a different CLI version. The next person
running the documented command gets ~40 lines of spurious diff unrelated to any schema
change: exactly the noise that makes a real drift hunk easy to wave past.

Nothing in `src/`, `supabase/` or `scripts/` consumes `graphql_public`, so it is safe to
drop.

---

## Evidence index

Saved artifacts, all re-checkable:

| File | What it proves |
|---|---|
| `~/.lh-audit/lh-generated-drift/evidence/types-fresh-prod.ts` | the prod schema as of 2026-09-02 11:00, generated with the documented `--schema public` command against the prod ref |
| `~/.lh-audit/lh-generated-drift/evidence/types-prod-vs-repo.diff` | 272-line diff vs `origin/main` — every hunk behind GD-001, GD-004, GD-005 |
| `~/.lh-audit/lh-generated-drift/evidence/no-types-guard-in-ci.out` | the GD-002 grep over `.github/` + `.husky/` — empty, exit 1 |
| `~/.lh-audit/lh-generated-drift/evidence/gh-workflow-list.out` | all 27 workflows `active` — GD-002's absence is real, not a disabled guard |
| `~/.lh-audit/lh-generated-drift/evidence/sitemap-check.out` | `generate-sitemap.mjs --check` → "up to date (6 public URLs)" |
| `~/.lh-audit/lh-generated-drift/evidence/verify-ios-metadata.out` | `verify-ios-metadata.sh` → exit 0, 16/16 ✓ |

Live-database claims were made through read-only `execute_sql` against
`fncmgoasalhdgfwzhsqa` and the queries are quoted inline at each finding, so each is
re-runnable as written.

> Note on `npm run check:audit-evidence`: it reports 12/13 claims unevidenced against this
> report. The checker matches artifacts per-line, and every flagged line is the opening
> line of a claim whose artifact sits on the following line or in the adjacent table. The
> tool says so itself ("heuristic, not a verdict"). I left the prose readable rather than
> reflowing it to satisfy a line-based grep; the artifacts are above and inline.

## Coverage manifest

Every artifact enumerated before any was graded.

| Artifact | Regenerated by | Current? | Guard |
|---|---|---|---|
| `src/integrations/supabase/types.ts` | `npm run db:types` | **NO** — GD-001/004/005 | **none** (GD-002) |
| `public/sitemap.xml` | `scripts/generate-sitemap.mjs` | yes (ran `--check`) | `sitemap-drift.yml` |
| `ios/App/App.xcodeproj/project.pbxproj` | `npm run sync:ios-metadata` | yes (ran verify, exit 0) | `ios-metadata.yml` |
| `ios/App/App/Info.plist` | same | yes | same |
| `ios/App/App/capacitor.config.json` | same | yes | same |
| `ios/App/App/config.xml` | same | yes | same |
| `ios/App/CapApp-SPM/Package.swift` | same | yes | same |
| iOS app icons | `scripts/generate-ios-icons.mjs` | assumed — see UNVERIFIED | `ios-icon-sync.yml` |
| `scripts/edge-types/stripe-18.5.0.ts` | hand-written shim, pinned | yes — all 45 edge imports are `stripe@18.5.0` | `typecheck-edge.mjs` asserts mapping |
| `supabase/functions/_shared/legalVersions.ts` | hand-mirrored from `legalSections.ts` | not re-verified — see UNVERIFIED | `legalVersions.parity.test.ts` |
| `scripts/generated/og-shell.js` | `scripts/build-og-shell.mjs` | n/a — gitignored (`.gitignore:130`) build output | n/a |
| `docs/audit/launch-2026-09/SURFACE.md` | `scripts/audit-surface.mjs` | regenerated today (`d0e47a4f`, 10:47) | none — audit-internal |
| `public/sw.js` | hand-written, not generated | n/a | n/a |
| Edge-function shared types | **none exist** — no edge function imports `types.ts` or a `Database` generic; `supabase-js` is used untyped there | n/a | n/a |

Files opened: `package.json`, `.husky/pre-commit`, all 24 `.github/workflows/*.yml`
(grepped; `db-drift-detect.yml`, `schedule-heartbeat.yml`, `sitemap-drift.yml`,
`ios-metadata.yml`, `ios-icon-sync.yml` read in full), `scripts/sync-ios-metadata.mjs`,
`scripts/edge-typecheck.deno.json`, `scripts/edge-types/stripe-18.5.0.ts`,
`src/integrations/supabase/types.ts`, `src/components/admin/AdminSupport.tsx`,
`src/components/admin/AdminReports.tsx`, `src/components/admin/useAdminUserSummaries.ts`,
`src/components/admin/AdminPayoutBatches.tsx`, `src/components/DisputeDialog.tsx`,
`src/components/TermsReconsentDialog.tsx`, `src/lib/applyRateLimit.ts`,
`supabase/functions/_shared/legalVersions.ts`,
`supabase/migrations/20260902051631_*.sql`.

## UNVERIFIED — could not reach, and why

- **Error count a regeneration would produce.** The sizing number the orchestrator needs
  (SI-012's was 25 across 17 files). Requires `npm run typecheck` in my worktree; the
  orchestrator owns the gate and I asked for it rather than running it under parallel-lane
  load. Requested, not yet granted.
- **iOS app icons byte-level currency.** `ios-icon-sync.yml` is active and the metadata
  sibling verified clean, but I did not run `generate-ios-icons.mjs` and diff the PNGs.
  Low value relative to cost; stating it rather than implying coverage.
- **`legalVersions.ts` ↔ `legalSections.ts` parity.** A parity test guards it; I did not
  run the test (gate discipline) and did not diff by hand. Guarded artifact, so the risk
  is that the *test* is weak, not that the mirror is stale — that is `lh-test-ci`'s call.
- **Staging (`okpxtpfvwtmbuxugqsws`) drift.** Out of lane scope; `types.ts` is generated
  from prod by definition. Named so nobody reads its absence as coverage.

## Out-of-scope conclusions (PROTOCOL §6)

- **Realm / CoreData / offline sync / SDWebImage / IAP receipts / XCTest / SwiftUI /
  role-gating.** None applicable and none searched for. This lane's surface is generated
  files versus their source of truth; none of these produce one.
- **Certificate pinning / RASP / i18n extraction.** No generated artifact involved.
  No conclusion offered — not this lane's call.
- **Apex universal links.** Deliberately staged. The iOS metadata artifacts I verified do
  not include the entitlement files and I did not touch them.
- **`worker_protection_credits`.** Confirmed absent from the fresh prod generation
  (`grep -c worker_protection_credits ~/.lh-audit/lh-generated-drift/evidence/types-fresh-prod.ts`
  → `0`), which independently corroborates the SI-001 retraction from a second source.

## Note on a false lead I pre-empted

Migration `20260902051631`'s own header states "ALL EIGHT hold a non-null `ip_address`
AND `user_agent`." That is the **pre-migration census**, not current state. Current prod:

```
anon_rows = 8 | anon_with_ip = 0 | anon_with_ua = 0
```

The backfill ran. Any residual-PII finding built from that comment is false. Relayed to
the orchestrator for `lh-account-lifecycle` and `lh-compliance-store`.

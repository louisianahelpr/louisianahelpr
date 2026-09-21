# Guard burn-down — can every check actually fail?

**Updated as work lands. This file is the score.**

A guard that cannot fail is why defects recur while everything looks green. Owner,
2026-09-20: *"none of these errors should recur. when you say youre fixing it that
means youre fixing it for good."*

## The score

| scope | files | proven able to fail | remaining |
|---|---|---|---|
| `src/test/*.test.ts*` (the ratchet) | 190 | **101** | **89** |
| `src/test/edge/` | 53 | 0 | 53 |
| Playwright `e2e/**/*.spec.ts` | 60 | 0 | 60 |
| colocated beside components | 336 | 0 | 336 |
| **total** | **639** | **101** | **538** |

Only the first row is enforced today (`.github/workflows/vacuity.yml`, on every push
and PR, plus a full mutation sweep nightly at 06:10 UTC). The ratchet's baseline may
only shrink, so row 1 cannot regress. **Rows 2–4 are invisible to it**: a hollow test
there is not even listed as unproven.

## Order of work (owner: least to greatest)

| bucket | count | status |
|---|---|---|
| MONEY | 4 | **DONE** — 129 → 125. Two real vacuities found. |
| BROWSE | 5 | **DONE** — 125 → 120. One real vacuity found. |
| VISUAL | 7 | **DONE** — 120 → 113. One real vacuity + one false-positive-prone guard fixed. |
| AUTHZ | 11 | **DONE** — 113 → 102. Three more real vacuities, two of them the worst found. |
| SCHEMA | 13 | **DONE** — 102 → 89. One hollow (comment-satisfiable), one unregisterable. |
| OTHER | 89 | 35 done, 21 running, 33 queued |

Then the 53 edge, the 60 e2e, the 336 colocated — all now IN the ratchet and
baselined, so none can grow while the backlog shrinks.

`example.test.ts` was DELETED, not proved: its body was `expect(true).toBe(true)`.
A scaffold in the denominator makes the safety net look bigger than it is. 639 → 638.

## What the first bucket found — why this is worth doing

Proving four money guards red exposed **two that were protecting nothing**:

1. **A live-location spoof surface was unguarded.** The `job_tracking` INSERT policy
   test sliced the SQL from its policy name *to the end of the file*, so it was
   satisfied by a different policy further down. Deleting the entire job-membership
   check left the test **green**.
2. **Free urgent placement could be restored silently.** Every text pin was
   satisfiable by a comment: `OR (true) -- <original text>` passed, and dropping the
   urgent-fee floor from $5 to $0.01 passed.

**BROWSE then found a third.** `seedDisputeFixture` asserted
`src.toContain("retireStuckSeedSplits()")` — which the function's own DEFINITION
line satisfies. Deleting the actual CALL from `apply()` makes the whole retirement
dead code, so a fake stuck dispute stays on prod, and the guard **stayed green**
(9 passed). It now looks for the call inside `apply()`'s body, comments stripped.

A second, partial hollowness in the same bucket: `mapMarkerAccessibleName` floored
its FILE list rather than its construct inventory, so after the Leaflet→MapKit port
two of its three branches matched nothing and a file pinned in the floor
contributed zero constructs. Given a construct-count floor.

**VISUAL found a fourth, on the owner's own primary-button rule.**
`glossyPrimaryInvariant` counts occurrences of the shared gloss class over RAW
source. Repainting the real CTA in `button.tsx` from `btn-grad-primary` to a flat
`bg-primary` — the app's actual primary button going flat — left it **GREEN**,
because a *comment* ("all three applied btn-grad-primary") supplied the second
occurrence the `>= 2` count needed. Comments are now stripped first.

Same bucket: `twoFontTypeSystem` scanned raw lines, so prose naming `font-serif`
reported itself — the false positive that bit this repo earlier in the month. Now
blanks comments while preserving line numbers, and has an inventory floor; an empty
`walk()` would have passed both of its scans vacuously.

**AUTHZ found the two worst.**

`adminEndpointAuthz` passed **16/16** with the entire admin check replaced by
`const isAdmin = true` — an endpoint that deletes ANY account for ANY caller
holding ANY valid JWT. It was satisfied by a `// Use has_role RPC` comment above
the hole plus an error string naming has_role. Now strips comments and requires a
real `.rpc()` call.

`banEvasionSurface` passed **6/6** with the whole pardon-release `DELETE FROM
public.retained_bans` removed — so an admin lifting a ban leaves the fingerprints
on file and the pardoned person is silently re-banned at next signup, quoting the
original reason. Its `liveDefinition()` returned the WHOLE migration file, and a
repair block elsewhere supplied the strings. Now bounded at the function's own
`$$…$$` body.

A seventh: `roleNeutralCopy`'s allowlist test was named "carries a reason AND still
matches something" but the second half was never implemented, so a stale exemption
could not fail. It went red immediately on an entry standing open over every string
in `src/` naming the company.

LIVE STATE VERIFIED for all of them — the guards were blind, the systems were
correct: `job_tracking`'s INSERT policy carries the job-membership check; the
urgent-fee constraints are intact; `enforce_retained_ban` carries the pardon
release and the email/phone checks; the deployed `admin-delete-user` makes a real
`has_role` RPC call and writes `admin_audit_log`; prod holds 0 stuck seed splits;
the real CTA computes to a genuine `radial-gradient`.

Also recorded: `giftCardNaming.test.ts` is a regex for a retired product name. It
never sees an amount and **could not have caught** the same-day bug where the client
sent `10.555`, the server charged `$10.56`, and the buyer was shown `$10.555`.
Client/server rounding agreement is an **uncovered class**, not a gap in that guard.

## The other two gaps — measured, not assumed

Proving a test CAN fail is one of three questions. Owner, 2026-09-20: *"fill the
gaps also. nothing should be left unturned."*

**Gap 2 — guards that pass honestly but check the wrong thing.** `giftCardNaming`
proves red fine: it really does catch a retired product name. It never sees an
AMOUNT, so it could not have caught the same-day bug where the client sent
`10.555`, the server charged `$10.56`, and the buyer was shown `$10.555`.
Client/server rounding agreement is an **uncovered class**. Lanes now report these
as they surface; they are not hollow guards and must not be counted as such.

**Gap 3 — source with no test at all.** The ratchet inspects TEST files, so code
nobody tests has no guard to prove hollow. It is invisible to this exercise by
construction. Measured 2026-09-20 (every `src/` + `supabase/functions/` `.ts`/`.tsx`
that is not itself a test, against every identifier referenced by any test file):

| | files |
|---|---|
| source files | 1053 |
| referenced by at least one test | 739 |
| **never referenced by any test** | **314** |

    components 134 · admin UI 49 · lib 38 · pages 38 · edge functions 37 · hooks 16

**37 untested edge functions is the line that matters** — that is where money moves.
Full list: `scripts/` measurement is reproducible; regenerate rather than trusting
this snapshot.

So at 639/639 what is known is: *every test in the repo has been shown capable of
failing.* NOT: every behaviour is tested. Gap 3 is the larger number and needs its
own plan.

## Hollow guards found so far: 20 of 100 proven (1 in 5)

Money, privacy, admin authorization, ban evasion, prod fixtures, the primary
button, universal links, and the brand rule have each had one. Every live system
behind them has checked out CORRECT when verified against prod — the exposure was
to future changes sliding through, not to damage already done.

**Two more live-leak guards, batch H:** `openJobsLocationMasking` passed **4/4**
with the street address published raw to every logged-out visitor, and
`offeredHelperPrivacy` passed **13/13** with `offered_to_helper_id` projected raw
into the browse feed — the owner-decided privacy fix, undone, green. Both were the
comment shape: the deleted call survived as `-- <original>` and the regex matched it.

**The worst three:**
- an admin endpoint guard passed **16/16** with the entire authorization replaced
  by `const isAdmin = true` — satisfied by a `// Use has_role RPC` comment;
- a **privacy** guard passed **5/5** with the gate deleted, putting flagged contact
  details back on a helper's screen — both its slices ran to end-of-file, one
  because its end marker lived inside a comment its own stripper removed first;
- a **money** guard passed **3/3** with a live `transfer_group` tag commented out,
  which makes that transfer invisible to every duplicate-transfer check.

## The rule for each guard

Make the smallest real change to the **guarded file** that should turn the test red.
Run it. Confirm red. Revert. Register `@mutate`. Remove the baseline entry.

**If a guard cannot be made to fail, that is the finding.** Rewrite it so it can, or
recommend deleting it — a guard nobody can break is worse than none, because it is
counted as protection.

## SCHEMA, second half — the migration/RPC six (102 → 89 with the first half)

An eighth real hole, shape (b) again, and the first guard that **could not be
registered at all**.

**`migrationRaiseCodesPreserved` was satisfiable by a comment.**
`scripts/check-migration-raise-codes.mjs` parsed raw SQL, so on
20260919195158 replacing the live
`RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';` in
`enforce_job_tracking_arrival_gate` with
`NULL; -- RAISE EXCEPTION 'job_not_found' …` **deleted the guard on
job_tracking's arrival gate and left the test GREEN (5 passed)** — both
`raiseCodes` and the `body.includes('<code>')` fallback read the dead comment
as the live guard. It now blanks `--` comments first (leaving `--` inside
single-quoted literals alone) and the registered mutation *is* the comment
form, so both shapes are pinned. LIVE STATE VERIFIED, read-only against prod:
`pg_get_functiondef('public.enforce_job_tracking_arrival_gate()')` carries
`job_not_found`, `tracker_not_assigned_helper` and
`tracker_requires_before_photo`. The guard was blind; the system was correct.

**`migrationVersions` could not be registered — its inventory is FILENAMES.**
No file's *contents* feed it, and the mutation gate can only replace source
text, so no `@mutate` could ever exist. It was shown red by hand first (a
second file on prefix `20260919195158`: 2 tests failed, naming the colliding
pair), then its matchers moved to `scripts/check-migration-versions.mjs` with
synthetic cases per rule — four mutations kill it now. Its frozen
`LEGACY_INVALID_STAMPS` list is also floored against the real tree: an entry
naming no migration is a failure, so it may only shrink.

Two partial hollownesses fixed: `rpcCastsOnDeclaredRpcs` and
`staleRpcCastComments` both walked `src/` with **no inventory floor**, so an
empty walk would have passed them by describing nothing.

**Every one of these six is a SOURCE-TEXT PIN and none can see prod.** They
read migration files and the generated `types.ts`, never `pg_policies`,
`pg_proc.proacl`, `information_schema.role_table_grants` or
`pg_get_functiondef`. A privilege granted or a function replaced outside a
migration is invisible to all six. `migrationRelationGrants` in particular
judges whether a migration *writes* a GRANT, not whether prod *has* one —
and none of the six sees the `FROM PUBLIC` vs `FROM PUBLIC, anon` distinction
at all (that is `anonGrantsClassCheck` + `db-smoke`, which do query the live
catalog). Live-state coverage of grants remains an **uncovered class** for
this file set, not a gap in any one of them.

## Hollow shapes already found in this repo

- **satisfiable by a comment** — strip comments before any source scan, EXCEPT where
  the data itself contains comment syntax (stripping `//` from a base64 blob deleted
  the asset and hashed the empty string)
- **a list that is both input and oracle** — derive from the world, then diff
- **an empty inventory passing vacuously** — floor every scan
- **`.includes()` where exact was meant** — `"space-y-4 px-3"` passes `.includes("space-y-4")`
- **pinning a defect's measurement**, so it asserts the bug still exists
- **interpolating a Tailwind class into an assertion** — Tailwind scans `./src/**` as
  raw text and will DELETE that class from the build
- **keyed on `file:line`** — rots when any unrelated edit shifts a line
- **counting instances instead of measuring** — the contrast guard pins counts, not ratios
- **writing evidence where the runner deletes it** — the review log lived in
  `test-results/`, which Playwright wipes; `review:report` goes green on an empty log
- **measuring the wrong box** — `getBoundingClientRect` includes transforms; adding
  padding+border to a `border-box` computed height double-counts. Both directions
  produced false reds here.

## Constraints

- **At most 3 browsers at once** (owner, 2026-09-20). Most of these guards parse
  source and need none — only run one where the guard genuinely drives a page.
- Concurrent prod-driving lanes degrade the free-tier project and manufacture
  failures: `profiles` was measured swinging 1s → 25s timeout and
  `/auth/v1/admin/generate_link` returning 504 while several lanes drove prod.
- ~10 minutes per lane. N items means N/4 lanes, not one lane with a list in it.

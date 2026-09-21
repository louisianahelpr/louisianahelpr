# Guard burn-down — can every check actually fail?

**Updated as work lands. This file is the score.**

A guard that cannot fail is why defects recur while everything looks green. Owner,
2026-09-20: *"none of these errors should recur. when you say youre fixing it that
means youre fixing it for good."*

## The score

| scope | files | proven able to fail | remaining |
|---|---|---|---|
| `src/test/*.test.ts*` (the ratchet) | 190 | **88** | **102** |
| `src/test/edge/` | 53 | 0 | 53 |
| Playwright `e2e/**/*.spec.ts` | 60 | 0 | 60 |
| colocated beside components | 336 | 0 | 336 |
| **total** | **639** | **88** | **551** |

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
| SCHEMA | 13 | |
| OTHER | 89 | |

Then the 53 edge, the 60 e2e, the 336 colocated.

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

## The rule for each guard

Make the smallest real change to the **guarded file** that should turn the test red.
Run it. Confirm red. Revert. Register `@mutate`. Remove the baseline entry.

**If a guard cannot be made to fail, that is the finding.** Rewrite it so it can, or
recommend deleting it — a guard nobody can break is worse than none, because it is
counted as protection.

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

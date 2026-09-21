# Guard burn-down — can every check actually fail?

**Updated as work lands. This file is the score.**

A guard that cannot fail is why defects recur while everything looks green. Owner,
2026-09-20: *"none of these errors should recur. when you say youre fixing it that
means youre fixing it for good."*

## The score

| scope | files | proven able to fail | remaining |
|---|---|---|---|
| `src/test/*.test.ts*` (the ratchet) | 188 | **63** | **125** |
| `src/test/edge/` | 53 | 0 | 53 |
| Playwright `e2e/**/*.spec.ts` | 60 | 0 | 60 |
| colocated beside components | 336 | 0 | 336 |
| **total** | **637** | **63** | **574** |

Only the first row is enforced today (`.github/workflows/vacuity.yml`, on every push
and PR, plus a full mutation sweep nightly at 06:10 UTC). The ratchet's baseline may
only shrink, so row 1 cannot regress. **Rows 2–4 are invisible to it**: a hollow test
there is not even listed as unproven.

## Order of work (owner: least to greatest)

| bucket | count | status |
|---|---|---|
| MONEY | 4 | **DONE** — 129 → 125. Found two real vacuities, below. |
| BROWSE | 5 | |
| VISUAL | 7 | |
| AUTHZ | 11 | |
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

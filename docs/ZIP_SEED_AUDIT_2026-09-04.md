# The ZIP→parish seed is 11% wrong, and 8 rows never made it in at all

**Status:** open · **Audited:** 2026-09-04 · Supersedes
`docs/ZIP_SEED_THIBODAUX_PARISH.md`, which found one row of this.

All 260 rows checked against two independent pipelines — the GeoNames US postal
dataset (programmatic diff, 0 not-found) and the US Census 2020 ZCTA-to-County
relationship file via four parallel research passes. **Both flagged the same 32
rows.** Verified 260 of 260; unverified 0.

## What is live

| | |
|---|---|
| Rows in the `INSERT` | 260 |
| Rows **actually inserted** | **252** ✅ *confirmed against prod* |
| Rows silently discarded by `ON CONFLICT (zip_code) DO NOTHING` | **8** |
| Inserted rows fully correct | 203 |
| Right parish, wrong city label | 21 |
| **Wrong parish** | **28 — 11% of live rows** |

## The duplicate-key defect is separate, and nastier

`zip_code` is the PRIMARY KEY. Eight rows collide, and `DO NOTHING` means
**first-in-file wins**. For three of those collisions the row that won is the
wrong one and **the correct row was thrown away** — with no error, because
`DO NOTHING` is exactly the instruction not to complain.

| ZIP | inserted | discarded | outcome |
|---|---|---|---|
| 71019 | `DeSoto / Grand Cane` | `Red River / Coushatta` ✅ | **correct row lost** |
| 71055 | `Claiborne / Lisbon` | `Webster / Minden` ✅ | **correct row lost** |
| 71366 | `LaSalle / Olla` | `Tensas / Newellton` ✅ | **correct row lost** |
| 70592 · 70788 · 71302 · 71469 | correct row won | — | ok |
| 70058 | identical duplicate | — | harmless |

Confirmed live: `70301 → Terrebonne/Thibodaux`, `71019 → DeSoto/Grand Cane`,
`71055 → Claiborne/Lisbon`, `71366 → LaSalle/Olla`. All four are the wrong row.

**Minden** (seat of Webster, pop. ~11.5k) and **Coushatta** (seat of Red River)
are both filed under the wrong parish because the correct row lost a primary-key
race.

### Red River can never be returned correctly

All 64 parishes appear in the table, so a naive coverage check passes. But Red
River's only surviving row is `71068 / Ringgold`, and Ringgold is really in
**Bienville**. Its other ZIP, 71019, was lost above. So:

- a Coushatta resident (genuinely Red River) resolves to **DeSoto**
- a Ringgold resident (genuinely Bienville) resolves to **Red River**

`get_parish_for_zip` never returns a correct Red River for anyone.

## Why no test caught any of this

`src/lib/parishes.test.ts` re-derives the parish registry **from this same
migration** and asserts they match. It therefore proves the registry and the seed
agree with each other, and it cannot see the seed disagreeing with Louisiana.
The test's input and its definition of correctness come from one place.

It also could not have caught the eight dropped rows: it parses the migration
**text**, so it sees all 260 `INSERT` tuples, including the eight the database
rejected. **The file and the table disagree, and the test only ever reads the
file.**

This is the third instance of that shape recorded in this repo, after the dead
agent names and the `marketing_metrics` table.

## Blast radius

`jobs.parish` and `profiles.parish` are both written from `get_parish_for_zip`.

**Not tax.** `parish_tax_rates` does not exist in prod, nothing reads it, and
Stripe computes tax from the address via `automatic_tax`. Nobody has been taxed
under the wrong parish, and nobody will be.

**Discovery, targeting and analytics.** A job posted in Thibodaux files under
Terrebonne, so a Lafourche filter misses it. Parish-keyed analytics attribute it
wrongly. Marketing targeted by parish inherits every one of the 28 errors.

Zero rows affected today — production is entirely seed and test data. Which makes
this cheap to fix now and expensive after launch.

## Fixing it

Three distinct problems, and the second is the one that will be missed:

1. **Correct the 28 wrong parishes.** The definitive list is in the audit output;
   they cluster in north and central Louisiana (21 of 28), which is consistent
   with a hand-written file getting less careful further from the author.
2. **Resolve the 8 primary-key collisions**, choosing the right row rather than
   the first. Three currently discard the correct one. A straight re-run of a
   corrected `INSERT … ON CONFLICT DO NOTHING` will **not** fix these — the
   conflicting row is already present, so `DO NOTHING` will skip the fix too.
   The migration must `DO UPDATE`, or delete first.
3. **Give the registry a check that reads the world.** `parishes.test.ts` should
   additionally assert against the **table**, not only the migration text, so a
   dropped row is visible. The full geographic check belongs in a one-off diff
   against an authoritative source, not in the unit suite.

One genuine straddle worth not "fixing": `71469 / Robeline` sits across
Natchitoches and Sabine. ZIP codes are postal routes, not civic boundaries, and
several of these will have a majority parish rather than a single correct one.

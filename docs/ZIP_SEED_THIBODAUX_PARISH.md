# ZIP 70301 (Thibodaux) is seeded to the wrong parish

**Status:** open · **Found:** 2026-09-03 · **Severity:** low, but it silently
corrupts every parish-keyed read for that ZIP.

## The error

`supabase/migrations/20260418042714_4ba9bea1-….sql:109`

```sql
('70301','Terrebonne','Thibodaux'), ('70360','Terrebonne','Houma'), …
```

**70301 is Thibodaux, which is the parish seat of Lafourche.** The Lafourche
block three lines below (`:112-113`) carries Galliano, Golden Meadow, Lockport
and Raceland — but not its own seat.

Worth verifying against an authoritative source before the fix lands: ZIP
boundaries can straddle parish lines, so the correct remedy may be "Lafourche"
or may be that 70301 genuinely spans both. Do not fix it from this file alone.

## What it does and does not affect

**It does NOT affect tax.** This was the first thing to rule out, because
`jobs.parish` is written from `get_parish_for_zip` and a wrong jurisdiction would
be a money bug. It is not:

- `parish_tax_rates` **does not exist in prod** and nothing in the repo reads it.
  The only mention is a comment in `src/lib/salesTax.ts`.
- The charge is computed by Stripe with `automatic_tax: { enabled: true }`
  (`create-payment/index.ts:191,425`), from the address — not from `jobs.parish`.

So nobody has been taxed under the wrong parish, and nobody will be.

**It DOES affect discovery and targeting.** `jobs.parish` and `profiles.parish`
are both written from this table. So a job posted in Thibodaux is tagged
Terrebonne: a Lafourche filter misses it, parish-keyed analytics attribute it to
the wrong place, and any marketing targeted by parish inherits the same mistake.
Nothing errors — the row is simply filed under the wrong heading, which is the
quiet failure mode this repo keeps running into.

## Blast radius today

Zero rows affected. Prod has no real jobs or profiles carrying `parish =
'Terrebonne'` from a Thibodaux ZIP, because the production database is entirely
seed and owner-test data. This is worth fixing before real users arrive, not
after.

## Also worth a pass while someone is in there

The seed was hand-written and this is the kind of error that rarely appears
alone. `src/lib/parishes.test.ts` re-derives the parish registry from this
migration on every run, so it guarantees the registry and the seed **agree with
each other** — it cannot catch the seed disagreeing with Louisiana. That is the
registries-checked-against-themselves pattern again: the test's input and its
definition of correctness come from the same place.

A real check would diff the whole seed against an authoritative ZIP→parish
source. 260 rows, one pass, and it would find any sibling of this bug.

## How it surfaced

A marketing agent writing small-town posts wanted to name Thibodaux, went to
confirm which parish stem to tag it with, found the seed and reality disagreeing,
and stopped to ask rather than picking one. It was told to verify every place
name against the seed before using it — the instruction was about protecting the
copy, and it caught a data error instead.

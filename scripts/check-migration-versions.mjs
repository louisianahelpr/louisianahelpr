#!/usr/bin/env node
/**
 * Migration versions must be unique, strictly increasing, and a real UTC stamp.
 *
 * `schema_migrations` has a primary key on the version string, so two files
 * sharing a `YYYYMMDDHHMMSS` prefix merge cleanly in git and then fail
 * `supabase db push` in prod with
 *   duplicate key value violates unique constraint "schema_migrations_pkey"
 * which aborts the push, rolls the migration back, and reds the deploy for
 * everyone — including the lane that did nothing wrong. It happened three times
 * in one day across parallel lanes.
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE TEST. The guard's whole inventory is
 * FILENAMES, and a filename cannot be broken by editing any file's contents —
 * so `src/test/migrationVersions.test.ts` could only ever be shown able to fail
 * by hand-creating a colliding file (done 2026-09-20: two tests red). The
 * mutation gate (`npm run vacuity`) can only break source text, so the matchers
 * moved here, where breaking one turns the test red on its synthetic cases.
 *
 * Prevention side: `npm run migration:new -- <slug>` stamps the clock and
 * refuses a version that already exists. Never hand-type a timestamp.
 *
 *   node scripts/check-migration-versions.mjs    # check the tree, exit 1 on a problem
 */
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Legacy Lovable-era files are named `<version>_<uuid>.sql`, so the slug half
 * allows hyphens too. The 14-digit version prefix is the part that matters.
 */
export const FILENAME = /^(\d{14})_([A-Za-z0-9_-]+)\.sql$/;

/**
 * Versions that are NOT a real UTC clock time — hour 24, 25, 26… — from the era
 * when stamps were hand-typed as a "+1 hour" counter. They are already applied
 * in prod's `schema_migrations`, and renaming an applied migration breaks the
 * ledger far worse than the sloppy stamp does. So they are frozen rather than
 * fixed. The list must never grow: anything new that lands in it was hand-typed,
 * which is the habit this whole file exists to end.
 */
export const LEGACY_INVALID_STAMPS = new Set([
  "20260612240000", "20260612250000", "20260612260000", "20260612270000",
  "20260612280000", "20260612290000", "20260612300000", "20260612310000",
  "20260612320000", "20260612330000", "20260612340000", "20260612350000",
  "20260612360000", "20260612370000", "20260612380000", "20260612390000",
  "20260612400000", "20260612410000", "20260612420000", "20260612430000",
  "20260612440000", "20260612450000", "20260612460000", "20260612470000",
  "20260612480000", "20260612490000", "20260612500000", "20260612510000",
  "20260612520000", "20260612530000", "20260612540000",
  "20260824238000", "20260824241000", "20260824243000", "20260824245000",
  "20260824247000", "20260824251000", "20260824253000", "20260824255000",
  "20260824257000", "20260824261000", "20260824263000", "20260824267000",
]);

/** Filenames that are not `<14-digit-version>_<slug>.sql`. */
export function badFilenames(files) {
  return files.filter((f) => !FILENAME.test(f));
}

/** `[[version, [file, …]], …]` for every version claimed by more than one file. */
export function versionCollisions(files) {
  const byVersion = new Map();
  for (const f of files) {
    const m = FILENAME.exec(f);
    if (!m) continue;
    byVersion.set(m[1], [...(byVersion.get(m[1]) ?? []), f]);
  }
  return [...byVersion.entries()].filter(([, group]) => group.length > 1);
}

/** Neighbours, in sorted order, whose versions do not strictly increase. */
export function notIncreasing(files) {
  const versions = [...files]
    .sort()
    .map((f) => FILENAME.exec(f))
    .filter(Boolean)
    .map((m) => ({ version: m[1], file: m[0] }));
  const out = [];
  for (let i = 1; i < versions.length; i += 1) {
    if (versions[i].version <= versions[i - 1].version) {
      out.push(
        `${versions[i].file} (${versions[i].version}) does not come after ` +
          `${versions[i - 1].file} (${versions[i - 1].version})`,
      );
    }
  }
  return out;
}

/** Is a 14-digit version a real UTC clock stamp? */
export function isRealUtcStamp(version) {
  const [y, mo, d, h, mi, se] = [
    version.slice(0, 4), version.slice(4, 6), version.slice(6, 8),
    version.slice(8, 10), version.slice(10, 12), version.slice(12, 14),
  ].map(Number);
  return (
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 &&
    h <= 23 && mi <= 59 && se <= 59 && y >= 2020 &&
    new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() === mo - 1
  );
}

/** Versions that are not a real UTC stamp, minus the frozen legacy set. */
export function bogusStamps(files, legacy = LEGACY_INVALID_STAMPS) {
  return files
    .map((f) => FILENAME.exec(f))
    .filter(Boolean)
    .filter((m) => !legacy.has(m[1]))
    .filter((m) => !isRealUtcStamp(m[1]))
    .map((m) => `${m[0]} → ${m[1]} is not a real UTC timestamp`);
}

export function migrationFilenames(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
  const files = migrationFilenames(dir);
  const problems = [
    ...badFilenames(files).map((f) => `not <version>_<slug>.sql: ${f}`),
    ...versionCollisions(files).map(([v, g]) => `duplicate version ${v}: ${g.join(", ")}`),
    ...notIncreasing(files),
    ...bogusStamps(files),
  ];
  for (const p of problems) console.error(`::error::${p}`);
  console.log(`migration-versions: ${files.length} file(s), ${problems.length} problem(s).`);
  process.exit(problems.length ? 1 : 0);
}

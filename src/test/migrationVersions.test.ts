import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import * as check from "../../scripts/check-migration-versions.mjs";

/**
 * Migration versions must be unique and strictly increasing.
 *
 * `schema_migrations` has a primary key on the version string. Two files
 * sharing a `YYYYMMDDHHMMSS` prefix merge cleanly in git and then fail
 * `supabase db push` in prod with
 *   duplicate key value violates unique constraint "schema_migrations_pkey"
 * which aborts the push, rolls the migration back, and reds the deploy for
 * everyone — including the lane that did nothing wrong. It happened three
 * times in one day across parallel lanes.
 *
 * This test is deliberately FILENAMES-ONLY: no database, no network, no
 * Supabase CLI. That is what lets it run in CI on every push and fail in
 * milliseconds, before the collision can reach prod.
 *
 * SHOWN ABLE TO FAIL, 2026-09-20. Copying a migration to a second file with the
 * same 14-digit prefix turned this red (2 failed: the collision test and the
 * strictly-increasing test), with the colliding pair named. That is the real
 * repro; it cannot be registered with the mutation gate because the guard's
 * whole inventory is FILENAMES and no file's CONTENTS feed it. So the matchers
 * moved to scripts/check-migration-versions.mjs, which the `@mutate` lines at
 * the foot of this file break — each one turns the synthetic cases below red.
 *
 * Prevention side: `npm run migration:new -- <slug>` stamps the clock and
 * refuses a version that already exists. Never hand-type a timestamp.
 */

const migrationsDir = resolve(__dirname, "../../supabase/migrations");
const files: string[] = check.migrationFilenames(migrationsDir);

describe("the matchers can see a bad tree", () => {
  // The real tree is (and must stay) clean, so every assertion below it would
  // pass on a matcher that returns nothing. These synthetic names are the
  // floor: each rule is shown catching the shape it exists for.
  const COLLIDING = ["20260919195158_a.sql", "20260919195158_b.sql"];

  it("catches two files sharing a version — the shape that reds the prod deploy", () => {
    expect(check.versionCollisions(COLLIDING)).toEqual([["20260919195158", COLLIDING]]);
    expect(check.versionCollisions(["20260919195158_a.sql", "20260919195159_b.sql"])).toEqual([]);
  });

  it("catches a version that does not come after its neighbour", () => {
    // Filenames sort by their fixed-width numeric prefix, so the only way two
    // neighbours fail to strictly increase is a shared version — which is
    // exactly the prod-deploy collision, named a second way.
    expect(check.notIncreasing(COLLIDING)).toHaveLength(1);
    expect(check.notIncreasing(["20260101000000_b.sql", "20260919195158_a.sql"])).toEqual([]);
  });

  it("catches a hand-typed stamp that is not a real UTC clock time", () => {
    expect(check.bogusStamps(["20260919250000_plus_one_hour.sql"])).toHaveLength(1);
    expect(check.bogusStamps(["20260919195158_real.sql"])).toEqual([]);
    // …and the frozen legacy set is not a licence to add more.
    expect(check.bogusStamps(["20260612240000_legacy.sql"])).toEqual([]);
    expect(check.bogusStamps(["20260612240000_legacy.sql"], new Set())).toHaveLength(1);
  });

  it("catches a filename that is not <version>_<slug>.sql", () => {
    expect(check.badFilenames(["fix_the_thing.sql"])).toEqual(["fix_the_thing.sql"]);
    expect(check.badFilenames(["20260919195158_ok.sql"])).toEqual([]);
  });
});

describe("supabase migration versions", () => {
  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every filename is <14-digit-version>_<slug>.sql", () => {
    const bad = check.badFilenames(files);
    expect(
      bad,
      `Migration filenames that do not match <YYYYMMDDHHMMSS>_<slug>.sql:\n` +
        bad.map((f: string) => `  - ${f}`).join("\n") +
        `\n\nFix: rename the file, or create it with\n` +
        `  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });

  it("no two migrations share a version", () => {
    const collisions = check.versionCollisions(files);
    expect(
      collisions,
      `Duplicate migration versions — \`supabase db push\` WILL fail on these with\n` +
        `"duplicate key value violates unique constraint \\"schema_migrations_pkey\\"",\n` +
        `rolling the migration back and reddening the prod deploy:\n` +
        collisions
          .map(
            ([version, group]: [string, string[]]) =>
              `  version ${version}:\n` + group.map((f) => `    - ${f}`).join("\n"),
          )
          .join("\n") +
        `\n\nFix: keep the OLDEST file as-is and re-stamp the other(s). Do not\n` +
        `hand-type a new timestamp — run:\n` +
        `  npm run migration:new -- <slug>\n` +
        `then move your SQL into the file it prints and delete the colliding one.`,
    ).toEqual([]);
  });

  it("versions are strictly increasing", () => {
    const notIncreasing: string[] = check.notIncreasing(files);
    expect(
      notIncreasing,
      `Migration versions are not strictly increasing. Migrations replay in\n` +
        `version order, so a back-dated file runs BEFORE migrations it may\n` +
        `depend on and can abort a from-scratch rebuild:\n` +
        notIncreasing.map((s) => `  - ${s}`).join("\n") +
        `\n\nFix: re-stamp the offending file with\n  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });

  it("new versions stamp a real UTC clock time", () => {
    const bogus: string[] = check.bogusStamps(files);
    expect(
      bogus,
      `Migration versions that are not a real UTC clock stamp (hour > 23, month\n` +
        `> 12, …). A hand-typed stamp is exactly how two lanes collide:\n` +
        bogus.map((s) => `  - ${s}`).join("\n") +
        `\n\nFix: never type a timestamp — run\n  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });

  it("the frozen legacy-stamp list has not grown", () => {
    // Every frozen stamp must still be a file in the tree: an entry standing for
    // nothing is a licence nobody is using, and the list may only shrink.
    const present = new Set(files.map((f: string) => f.slice(0, 14)));
    const orphans = [...check.LEGACY_INVALID_STAMPS].filter((v) => !present.has(v as string));
    expect(orphans, "these frozen stamps name no migration — remove them").toEqual([]);
    expect(check.LEGACY_INVALID_STAMPS.size).toBeLessThanOrEqual(43);
  });
});

// @mutate scripts/check-migration-versions.mjs | return [...byVersion.entries()].filter(([, group]) => group.length > 1); | return [];
// @mutate scripts/check-migration-versions.mjs | if (versions[i].version <= versions[i - 1].version) { | if (false) {
// @mutate scripts/check-migration-versions.mjs | h <= 23 && mi <= 59 && se <= 59 && y >= 2020 && | h <= 99 && mi <= 59 && se <= 59 && y >= 2020 &&
// @mutate scripts/check-migration-versions.mjs | return files.filter((f) => !FILENAME.test(f)); | return [];

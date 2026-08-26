import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

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
 * Prevention side: `npm run migration:new -- <slug>` stamps the clock and
 * refuses a version that already exists. Never hand-type a timestamp.
 */

const migrationsDir = resolve(__dirname, "../../supabase/migrations");

// Legacy Lovable-era files are named <version>_<uuid>.sql, so the slug half
// allows hyphens too. The 14-digit version prefix is the part that matters.
const FILENAME = /^(\d{14})_([A-Za-z0-9_-]+)\.sql$/;

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("supabase migration versions", () => {
  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every filename is <14-digit-version>_<slug>.sql", () => {
    const bad = files.filter((f) => !FILENAME.test(f));
    expect(
      bad,
      `Migration filenames that do not match <YYYYMMDDHHMMSS>_<slug>.sql:\n` +
        bad.map((f) => `  - ${f}`).join("\n") +
        `\n\nFix: rename the file, or create it with\n` +
        `  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });

  it("no two migrations share a version", () => {
    const byVersion = new Map<string, string[]>();
    for (const f of files) {
      const m = FILENAME.exec(f);
      if (!m) continue;
      const list = byVersion.get(m[1]) ?? [];
      list.push(f);
      byVersion.set(m[1], list);
    }

    const collisions = [...byVersion.entries()].filter(
      ([, group]) => group.length > 1,
    );

    expect(
      collisions,
      `Duplicate migration versions — \`supabase db push\` WILL fail on these with\n` +
        `"duplicate key value violates unique constraint \\"schema_migrations_pkey\\"",\n` +
        `rolling the migration back and reddening the prod deploy:\n` +
        collisions
          .map(
            ([version, group]) =>
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
    const versions = files
      .map((f) => FILENAME.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ version: m[1], file: m[0] }));

    // `files` is sorted lexicographically, which for a fixed-width numeric
    // prefix is also version order — so neighbours can only fail to strictly
    // increase via a duplicate, which the test above names in full detail.
    const notIncreasing: string[] = [];
    for (let i = 1; i < versions.length; i++) {
      if (versions[i].version <= versions[i - 1].version) {
        notIncreasing.push(
          `${versions[i].file} (${versions[i].version}) does not come after ` +
            `${versions[i - 1].file} (${versions[i - 1].version})`,
        );
      }
    }

    expect(
      notIncreasing,
      `Migration versions are not strictly increasing. Migrations replay in\n` +
        `version order, so a back-dated file runs BEFORE migrations it may\n` +
        `depend on and can abort a from-scratch rebuild:\n` +
        notIncreasing.map((s) => `  - ${s}`).join("\n") +
        `\n\nFix: re-stamp the offending file with\n  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });

  /**
   * Versions that are NOT a real UTC clock time — hour 24, 25, 26… — from the
   * era when stamps were hand-typed as a "+1 hour" counter. They are already
   * applied in prod's schema_migrations, and renaming an applied migration
   * breaks the ledger far worse than the sloppy stamp does. So they are frozen
   * here rather than fixed. The list must never grow: anything new that lands
   * in it was hand-typed, which is the habit this whole file exists to end.
   */
  const LEGACY_INVALID_STAMPS = new Set([
  "20260612240000",
  "20260612250000",
  "20260612260000",
  "20260612270000",
  "20260612280000",
  "20260612290000",
  "20260612300000",
  "20260612310000",
  "20260612320000",
  "20260612330000",
  "20260612340000",
  "20260612350000",
  "20260612360000",
  "20260612370000",
  "20260612380000",
  "20260612390000",
  "20260612400000",
  "20260612410000",
  "20260612420000",
  "20260612430000",
  "20260612440000",
  "20260612450000",
  "20260612460000",
  "20260612470000",
  "20260612480000",
  "20260612490000",
  "20260612500000",
  "20260612510000",
  "20260612520000",
  "20260612530000",
  "20260612540000",
  "20260824238000",
  "20260824241000",
  "20260824243000",
  "20260824245000",
  "20260824247000",
  "20260824251000",
  "20260824253000",
  "20260824255000",
  "20260824257000",
  "20260824261000",
  "20260824263000",
  "20260824267000",
  ]);

  it("new versions stamp a real UTC clock time", () => {
    const bogus = files
      .map((f) => FILENAME.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter(({ 1: version }) => !LEGACY_INVALID_STAMPS.has(version))
      .map(({ 0: file, 1: version }) => {
        const [y, mo, d, h, mi, se] = [
          version.slice(0, 4), version.slice(4, 6), version.slice(6, 8),
          version.slice(8, 10), version.slice(10, 12), version.slice(12, 14),
        ].map(Number);
        const real =
          mo >= 1 && mo <= 12 && d >= 1 && d <= 31 &&
          h <= 23 && mi <= 59 && se <= 59 && y >= 2020 &&
          new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() === mo - 1;
        return real ? null : `${file} → ${version} is not a real UTC timestamp`;
      })
      .filter(Boolean);

    expect(
      bogus,
      `Migration versions that are not a real UTC clock stamp (hour > 23, month\n` +
        `> 12, …). A hand-typed stamp is exactly how two lanes collide:\n` +
        bogus.map((s) => `  - ${s}`).join("\n") +
        `\n\nFix: never type a timestamp — run\n  npm run migration:new -- <slug>`,
    ).toEqual([]);
  });
});

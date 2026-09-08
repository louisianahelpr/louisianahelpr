import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PARISHES, parishBySlug, parishByName, parishLabel, parishForCity } from "./parishes";

/**
 * These tests re-derive the parish registry from the ZIP→parish seed migration
 * and compare. The point is that the assertion's INPUT is not the thing under
 * test: `PARISHES` is checked against the SQL the database was actually built
 * from, so a parish added to (or renamed in) the seed fails here instead of
 * silently shipping copy that names a market the database has never heard of.
 *
 * The failure this guards is quiet: `jobs.parish` is populated by
 * `get_parish_for_zip`, which reads `louisiana_zip_parishes`. If a name here
 * drifts by so much as the "St." prefix, a parish-targeted post links to an
 * empty query and reads as a cold market rather than a bug.
 */
const SEED_SQL = "supabase/migrations/20260418042714_4ba9bea1-f204-429a-bda3-b6edd663f3c5.sql";
/**
 * The 2026-09-04 correction pass. 28 ZIPs were filed under the wrong parish and
 * 19 carried a wrong city label — 11% of the seed — found by checking all 260
 * rows against GeoNames and the Census ZCTA-to-County file. See
 * docs/ZIP_SEED_AUDIT_2026-09-04.md.
 *
 * Read here because the seed alone is no longer what the database holds, and a
 * registry derived from the seed alone would now be stale in exactly the places
 * that were wrong. Later migrations win, as they do in Postgres.
 */
const FIX_SQL = "supabase/migrations/20260904211910_correct_zip_parish_seed.sql";
/**
 * The 2026-09-06 completion pass. The table was a SAMPLE — 252 of Louisiana's
 * 720 ZIP codes, 35% — and that was invisible from the inside because all 64
 * parishes were present, so every coverage check that counted parishes passed.
 * The other 468 ZIPs resolved to a NULL parish, and a NULL parish is a member
 * no job fan-out reaches — it matches on `p.parish = NEW.parish` and consults
 * no coordinate, so a device fix does not rescue them even when there is one.
 *
 * Read here for the same reason FIX_SQL is: later migrations win, as they do in
 * Postgres, and a registry derived from the earlier files alone would now claim
 * Orleans has 17 ZIPs when the database says 56.
 */
const FULL_SQL = "supabase/migrations/20260907051306_complete_louisiana_zip_parish_table.sql";

interface SeedRow { zip: string; parish: string; city: string }

/**
 * The seed as the DATABASE holds it: the original INSERT, then the corrections.
 *
 * Two things this deliberately reproduces, because the file and the table
 * disagree in both:
 *
 *   1. `zip_code` is the PRIMARY KEY and the original INSERT contains eight
 *      colliding rows under `ON CONFLICT DO NOTHING`, so FIRST-in-file wins and
 *      the later row is silently dropped. Reading the file naively yields 260
 *      rows; the table holds 252. For three of those collisions the discarded
 *      row was the correct one — which is why nothing caught Minden and
 *      Coushatta being filed under the wrong parish.
 *   2. The correction migration then re-points 47 of the survivors.
 */
const readSeed = (): SeedRow[] => {
  const byZip = new Map<string, SeedRow>();
  const sql = readFileSync(SEED_SQL, "utf8");
  for (const m of sql.matchAll(/\('(\d{5})','([^']+)','([^']+)'\)/g)) {
    // First write wins — ON CONFLICT (zip_code) DO NOTHING.
    if (!byZip.has(m[1])) byZip.set(m[1], { zip: m[1], parish: m[2], city: m[3] });
  }
  // Corrections are `(zip, parish, city)` tuples in the UPDATE ... FROM (VALUES)
  // blocks. The verification block at the end of that file holds two-column
  // tuples, which this pattern does not match.
  const fix = readFileSync(FIX_SQL, "utf8");
  for (const m of fix.matchAll(/\('(\d{5})', '([^']+)', '([^']+)'\)/g)) {
    const row = byZip.get(m[1]);
    if (row) { row.parish = m[2]; row.city = m[3]; }
  }
  // The completion pass is `ON CONFLICT (zip_code) DO UPDATE`, so unlike the
  // original seed it both adds and overwrites — set, don't skip.
  //
  // Its tuples are FIVE columns, not three: `('70001','Jefferson','Metairie',
  // 29.982705,-90.169068)`. Hence the trailing comma in the pattern rather than
  // a closing paren — matching on `')` here would silently match NOTHING, the
  // derived set would fall back to the 252-row sample, and every comparison
  // below would fail with a confusing diff rather than an obvious one. (The
  // "reads a non-trivial seed" test exists precisely to catch that.)
  const full = readFileSync(FULL_SQL, "utf8");
  for (const m of full.matchAll(/\('(\d{5})','([^']+)','([^']+)',/g)) {
    byZip.set(m[1], { zip: m[1], parish: m[2], city: m[3] });
  }
  return [...byZip.values()];
};

describe("PARISHES registry", () => {
  const seed = readSeed();

  it("reads a non-trivial seed (guards the regex silently matching nothing)", () => {
    // Without this, every set-comparison below would pass vacuously if the
    // migration were reformatted and the regex stopped matching.
    expect(seed.length).toBe(720); // every Louisiana ZIP code
    expect(new Set(seed.map((r) => r.parish)).size).toBe(64);
  });

  it("covers Louisiana, not a sample of it", () => {
    // The defect this file is the memorial to: the table held 252 rows and
    // looked complete because all 64 parishes were represented. Counting
    // parishes cannot see a missing ZIP, so count ZIPs — and assert the shape
    // of the ZIP space itself, which a truncated re-seed would break.
    const zips = seed.map((r) => r.zip).sort();
    expect(new Set(zips).size).toBe(720);
    // Louisiana's ZIP prefixes run 700xx–714xx, plus 71749 (Junction City,
    // which straddles the Arkansas line and is filed under Union).
    for (const zip of zips) expect(Number(zip)).toBeGreaterThanOrEqual(70001);
    for (const zip of zips) expect(Number(zip)).toBeLessThanOrEqual(71749);
    // Every parish must hold at least one ZIP, or someone there is unreachable.
    for (const parish of PARISHES) expect(parish.zipCount, parish.name).toBeGreaterThan(0);
  });

  it("covers exactly the parish names the seed writes", () => {
    const fromSeed = [...new Set(seed.map((r) => r.parish))].sort();
    expect(PARISHES.map((p) => p.name).sort()).toEqual(fromSeed);
  });

  it("lists exactly the seeded cities for each parish", () => {
    for (const parish of PARISHES) {
      const expected = [...new Set(seed.filter((r) => r.parish === parish.name).map((r) => r.city))].sort();
      expect([...parish.cities].sort(), `cities for ${parish.name}`).toEqual(expected);
    }
  });

  it("reports each parish's true seeded ZIP count", () => {
    for (const parish of PARISHES) {
      expect(parish.zipCount, `zipCount for ${parish.name}`).toBe(
        seed.filter((r) => r.parish === parish.name).length,
      );
    }
  });

  it("names primaryCity as a city that parish actually contains", () => {
    for (const parish of PARISHES) {
      expect(parish.cities, `primaryCity for ${parish.name}`).toContain(parish.primaryCity);
    }
  });

  it("has unique, URL-safe slugs", () => {
    const slugs = PARISHES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("parish lookups", () => {
  it("resolves by slug, case-insensitively", () => {
    expect(parishBySlug("orleans")?.name).toBe("Orleans");
    expect(parishBySlug("ORLEANS")?.name).toBe("Orleans");
    expect(parishBySlug("st-tammany")?.name).toBe("St. Tammany");
  });

  it("round-trips every parish slug and DB name", () => {
    for (const parish of PARISHES) {
      expect(parishBySlug(parish.slug)).toBe(parish);
      expect(parishByName(parish.name)).toBe(parish);
    }
  });

  it("answers null for unknown or absent input rather than throwing", () => {
    expect(parishBySlug("not-a-parish")).toBeNull();
    expect(parishBySlug(undefined)).toBeNull();
    expect(parishBySlug("")).toBeNull();
    // `jobs.parish` is nullable — an anonymised job carries no parish at all.
    expect(parishByName(null)).toBeNull();
    expect(parishByName(undefined)).toBeNull();
    // The DB stores the bare stem; the suffixed form must NOT resolve.
    expect(parishByName("Orleans Parish")).toBeNull();
  });

  it("adds the word Louisiana uses when rendering a name", () => {
    expect(parishLabel(parishBySlug("orleans")!)).toBe("Orleans Parish");
    expect(parishLabel(parishBySlug("east-baton-rouge")!)).toBe("East Baton Rouge Parish");
  });
});

describe("parishForCity (signup ZIP/city sanity hint)", () => {
  it("resolves a listed city to its parish, case-insensitively", () => {
    expect(parishForCity("Baton Rouge")?.name).toBe("East Baton Rouge");
    expect(parishForCity("baton rouge")?.name).toBe("East Baton Rouge");
    expect(parishForCity("  Shreveport  ")?.name).toBe("Caddo");
  });

  it("refuses to guess New Orleans, which is a Jefferson Parish city too", () => {
    // This used to assert Orleans, and that was safe only while the registry
    // was a 252-ZIP sample. Complete, it shows five ZIPs whose USPS city is
    // "New Orleans" but which sit in JEFFERSON — 70121 (Harahan), 70123
    // (Elmwood) and three PO-box ZIPs. Resolving the name to Orleans would
    // hand every one of those residents a mismatch warning telling them their
    // own correct address is wrong. Silence is the right answer here, and it
    // is the ambiguity rule working on real data rather than a regression.
    expect(parishForCity("New Orleans")).toBeNull();
  });

  it("returns null for a city not in the registry — NOT evidence of a mismatch", () => {
    // The registry only lists a handful of cities per parish (see the header
    // comment); a real, correctly-matched small town absent from it must
    // read as \"unknown\", never as \"wrong\". This is the exact distinction
    // the signup mismatch hint's own logic depends on to avoid false
    // positives — it only flags a match against a DIFFERENT parish.
    expect(parishForCity("Some Tiny Unlisted Town")).toBeNull();
  });

  it("returns null for empty/null/undefined input", () => {
    expect(parishForCity("")).toBeNull();
    expect(parishForCity(null)).toBeNull();
    expect(parishForCity(undefined)).toBeNull();
  });

  it("every UNAMBIGUOUS city (listed under exactly one parish) resolves back to that parish", () => {
    // Some real city names are seeded under more than one parish (border
    // towns) — parishForCity deliberately returns null for those rather than
    // guessing, so this only asserts the round-trip for names that appear
    // under a single parish across the whole registry.
    const countsByCity = new Map<string, number>();
    for (const parish of PARISHES) {
      for (const city of parish.cities) {
        const key = city.toLowerCase();
        countsByCity.set(key, (countsByCity.get(key) ?? 0) + 1);
      }
    }
    for (const parish of PARISHES) {
      for (const city of parish.cities) {
        if (countsByCity.get(city.toLowerCase())! > 1) continue;
        expect(parishForCity(city)?.name, `${city} -> ${parish.name}`).toBe(parish.name);
      }
    }
  });

  it("returns null (not a guess) for ANY city seeded under more than one parish", () => {
    // This used to assert that a duplicate exists, naming Robeline — and its own
    // comment anticipated needing rework "if the registry ever stops containing
    // a genuine duplicate". It has.
    //
    // Not because border towns stopped existing: `zip_code` is the seed table's
    // PRIMARY KEY, so a town straddling two parishes can only ever hold one row,
    // and the registry is now derived from the 252 rows the DATABASE holds
    // rather than the 260 tuples in the migration text. Robeline's second row —
    // the Sabine one — is among the eight the primary key discarded.
    //
    // So the assertion is now over whatever duplicates exist rather than over a
    // named town: if one appears, `parishForCity` must refuse to guess.
    //
    // Completing the table to all 720 ZIPs (20260907051306) produced exactly
    // one: "New Orleans", which is the USPS city for five Jefferson Parish ZIPs
    // as well as for all 56 Orleans ones. Legitimate data, not a regression —
    // see the dedicated test above.
    const countsByCity = new Map<string, number>();
    for (const parish of PARISHES) {
      for (const city of parish.cities) {
        const key = city.toLowerCase();
        countsByCity.set(key, (countsByCity.get(key) ?? 0) + 1);
      }
    }
    const duplicated = [...countsByCity.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    for (const city of duplicated) {
      expect(parishForCity(city), `${city} is under >1 parish and must not be guessed`).toBeNull();
    }
  });

  it("refuses to guess a city it has never seen", () => {
    // The non-vacuous half of the pair above: whatever the data contains,
    // `parishForCity` must answer null rather than a nearest match.
    expect(parishForCity("Nacogdoches")).toBeNull();
    expect(parishForCity("Not A Real Town")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PARISHES, parishBySlug, parishByName, parishLabel } from "./parishes";

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

interface SeedRow { zip: string; parish: string; city: string }

const readSeed = (): SeedRow[] => {
  const sql = readFileSync(SEED_SQL, "utf8");
  return [...sql.matchAll(/\('(\d{5})','([^']+)','([^']+)'\)/g)].map((m) => ({
    zip: m[1],
    parish: m[2],
    city: m[3],
  }));
};

describe("PARISHES registry", () => {
  const seed = readSeed();

  it("reads a non-trivial seed (guards the regex silently matching nothing)", () => {
    // Without this, every set-comparison below would pass vacuously if the
    // migration were reformatted and the regex stopped matching.
    expect(seed.length).toBeGreaterThan(200);
    expect(new Set(seed.map((r) => r.parish)).size).toBeGreaterThan(60);
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

/**
 * AL-006: purge_user_data() anonymises a profile (anonymized_at = now()) and
 * the purge then deletes the auth user, whose CASCADE removes the row. When
 * that last step fails the anonymised row survives, and get_safe_profiles
 * served it as a live profile at /user/:id. The LATEST migration that defines
 * get_safe_profiles must exclude anonymised rows (verified 3x in PGlite:
 * anonymised row dropped, live row kept).
 *
 * @mutate supabase/migrations/20260924055509_get_safe_profiles_hide_anonymized.sql | AND p.anonymized_at IS NULL; | ;
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "supabase/migrations";
const defining = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.get_safe_profiles\(/i.test(readFileSync(`${dir}/${f}`, "utf8")));

describe("get_safe_profiles never emits a deleted person (AL-006)", () => {
  it("the inventory is real", () => {
    expect(defining.length).toBeGreaterThan(3);
  });

  it("the latest definition excludes anonymised profiles", () => {
    const latest = readFileSync(`${dir}/${defining[defining.length - 1]}`, "utf8");
    const where = latest.slice(latest.search(/\bWHERE \(p\.user_id = ANY/));
    expect(where).toMatch(/AND p\.anonymized_at IS NULL/);
  });
});

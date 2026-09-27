/**
 * ME-017 (7): edge functions read platform_settings with `.limit(1)` and no
 * order, which is only correct while the table can hold one row. The
 * singleton index (migration 20260927060123) is what makes that true; this
 * fails if it is ever dropped or the migration removed.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase/migrations");

describe("platform_settings stays one row", () => {
  it("a migration creates the singleton unique index and none drops it", () => {
    const sql = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(DIR, f), "utf8"));
    expect(sql.some((s) => /CREATE UNIQUE INDEX[^;]*platform_settings_singleton\s+ON public\.platform_settings \(\(true\)\)/i.test(s))).toBe(true);
    expect(sql.some((s) => /DROP INDEX[^;]*platform_settings_singleton/i.test(s))).toBe(false);
  });
});

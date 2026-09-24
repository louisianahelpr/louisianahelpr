/**
 * DH-006: report_helper_no_show reopens the job, so a poster can re-hire and
 * the second Helpr can also fail to show. GUARD 3a was job-wide and refused
 * that second report. The LATEST migration defining the function must scope
 * GUARD 3a, and the reported_by attribution UPDATE, to user_id = v_helper_id
 * (verified 3x in PGlite: second Helpr recorded, repeat refused, both attributed).
 *
 * @mutate supabase/migrations/20260924060512_report_no_show_per_helper.sql | AND user_id = v_helper_id  -- DH-006 per-Helpr guard | -- guard removed
 * @mutate supabase/migrations/20260924060512_report_no_show_per_helper.sql | AND user_id = v_helper_id  -- DH-006 this Helpr's row only | -- scope removed
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "supabase/migrations";
const defining = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.report_helper_no_show\(/i.test(readFileSync(`${dir}/${f}`, "utf8")));
const latest = readFileSync(`${dir}/${defining[defining.length - 1]}`, "utf8");

describe("a no-show report is one per (job, Helpr) (DH-006)", () => {
  it("the inventory is real", () => {
    expect(defining.length).toBeGreaterThan(2);
  });
  it("GUARD 3a is scoped to the reported Helpr", () => {
    const guard = latest.slice(latest.indexOf("GUARD 3a"), latest.indexOf("RAISE EXCEPTION 'already_reported'"));
    expect(guard).toMatch(/AND user_id = v_helper_id/);
  });
  it("the attribution UPDATE only stamps this Helpr's row", () => {
    const upd = latest.slice(latest.indexOf("UPDATE public.user_violations"), latest.indexOf("reported_by IS NULL;"));
    expect(upd).toMatch(/AND user_id = v_helper_id/);
  });
});

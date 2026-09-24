/**
 * IB-002: every free-text job field a browsing Helpr reads before hire must be
 * scanned for contact details by reject_contact_leak_in_job. special_requirements
 * was shown on the job but never scanned. Source of truth: the LAST migration
 * that (re)creates the trigger; replay order is filename order.
 *
 * @mutate supabase/migrations/20260924045813_job_special_requirements_contact_scan.sql | UPDATE OF title, description, special_requirements ON | UPDATE OF title, description ON
 * @mutate supabase/migrations/20260924045813_job_special_requirements_contact_scan.sql | v_reason := public.contact_leak_reason(NEW.special_requirements); | v_reason := NULL;
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Poster-written text shown on the public job page and browse card.
// (location is hidden until hire and is an address, so it is not scanned.)
const PUBLIC_JOB_TEXT = ["title", "description", "special_requirements"];

const dir = "supabase/migrations";
const defining = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /CREATE TRIGGER trg_reject_contact_leak_in_job/i.test(readFileSync(`${dir}/${f}`, "utf8")));
const latest = defining[defining.length - 1];
const sql = readFileSync(`${dir}/${latest}`, "utf8");

describe("public job text is contact-scanned (IB-002)", () => {
  it("found the trigger's latest definition", () => {
    expect(defining.length).toBeGreaterThan(0);
    expect(latest).toBeTruthy();
  });
  const cols = (sql.match(/UPDATE OF ([\w,\s]+?) ON public\.jobs/i)?.[1] ?? "").split(",").map((s) => s.trim());
  it.each(PUBLIC_JOB_TEXT)("%s re-scans on update and is checked in the function", (col) => {
    expect(cols).toContain(col);
    expect(sql).toContain(`public.contact_leak_reason(NEW.${col})`);
  });
  it("every public text field is present on the post-job form's insert", () => {
    const submit = readFileSync("src/pages/postjob/useJobSubmit.ts", "utf8");
    for (const c of PUBLIC_JOB_TEXT) expect(submit).toMatch(new RegExp(`\\b${c}\\b`));
  });
});

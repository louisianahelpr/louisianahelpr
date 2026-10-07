/**
 * IB-002: every free-text job field a browsing Helpr reads before hire must be
 * scanned for contact details by reject_contact_leak_in_job. special_requirements
 * was shown on the job but never scanned. Source of truth: the LAST migration
 * that (re)creates the trigger; replay order is filename order.
 *
 * Q1461 (20261006204113): the poster's notes moved out of
 * special_requirements. The materials note is public (jobs.materials_note) and
 * is scanned here; the access and parking notes are private
 * (job_access_notes) and are scanned by their own write trigger, as they were
 * while they lived in special_requirements. special_requirements stays in the
 * scan for a client that still sends the combined text.
 *
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | UPDATE OF title, description, special_requirements, materials_note ON | UPDATE OF title, description, special_requirements ON
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | v_reason := public.contact_leak_reason(NEW.special_requirements); | v_reason := NULL;
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | v_reason := public.contact_leak_reason(NEW.materials_note); | v_reason := NULL;
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | v_reason := public.contact_leak_reason(NEW.notes); | v_reason := NULL;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";

// Poster-written text shown on the public job page and browse card.
// (location is hidden until hire and is an address, so it is not scanned.)
const PUBLIC_JOB_TEXT = ["title", "description", "materials_note"];
// Scanned too: the retired column a pre-Q1461 client may still write.
const SCANNED = [...PUBLIC_JOB_TEXT, "special_requirements"];

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
  // The trigger's OWN column list: the same file may create other jobs triggers.
  const cols = (sql.match(/CREATE TRIGGER trg_reject_contact_leak_in_job\s+BEFORE INSERT OR UPDATE OF ([\w,\s]+?) ON public\.jobs/i)?.[1] ?? "")
    .split(",").map((s) => s.trim());
  it.each(SCANNED)("%s re-scans on update and is checked in the function", (col) => {
    expect(cols).toContain(col);
    expect(sql).toContain(`public.contact_leak_reason(NEW.${col})`);
  });
  it("every public text field is present on the post-job form's insert", () => {
    const submit =
      readFileSync("src/pages/post-job/useJobSubmit.ts", "utf8") + readFileSync("src/pages/post-job/jobSubmitHelpers.ts", "utf8");
    for (const c of PUBLIC_JOB_TEXT) expect(submit).toMatch(new RegExp(`\\b${c}\\b`));
  });
  it("the private access and parking notes are scanned by their own write trigger (Q1461)", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /FUNCTION public\.enforce_job_access_notes_write\(/.test(readFileSync(`${dir}/${f}`, "utf8")));
    expect(files.length).toBeGreaterThan(0);
    const body = readFileSync(`${dir}/${files[files.length - 1]}`, "utf8");
    expect(body).toContain("public.contact_leak_reason(NEW.notes)");
    expect(body).toMatch(/CREATE TRIGGER trg_job_access_notes_write\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.job_access_notes/);
  });
});

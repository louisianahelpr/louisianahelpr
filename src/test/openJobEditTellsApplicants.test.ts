/**
 * Board 66/172 slice 4 (owner defaults 2 and 3, 2026-10-21): editing an OPEN job that people applied to tells each
 * waiting applicant what changed (at most hourly), and the category is locked once anyone has applied. Behaviour:
 * src/test/pglite/openJobEditTellsApplicants.pglite.mjs. This pins the trigger the migrations leave, its rules,
 * and the poster's words.
 */
// @mutate supabase/migrations/20261021111723_open_job_edit_tells_applicants.sql |   IF OLD.last_edit_notice_at > now() - interval '1 hour' AND OLD.last_edit_notice_at <= now() THEN |   IF false THEN
// @mutate supabase/migrations/20261021111723_open_job_edit_tells_applicants.sql |     NEW.last_edit_notice_at := OLD.last_edit_notice_at;\n |
// @mutate supabase/migrations/20261021111723_open_job_edit_tells_applicants.sql |     RAISE EXCEPTION 'category_locked_after_applications' |     RAISE NOTICE 'category_locked_after_applications'
// @mutate src/pages/posts/EditJobDialog.tsx | disabled={hasHelper \|\| hasApplicants}> | disabled={hasHelper}>
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";

const MIG = join(process.cwd(), "supabase/migrations");
const inv = triggerInventory(migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") })));
const defs = effectiveDefs(MIG);

describe("editing an open job tells its applicants; the category stays once people applied", () => {
  const trg = inv.get("jobs.trg_jobs_open_edit_tells_applicants");
  const body = bodyOf(defs.get(trg?.fn ?? "")?.stmt ?? "").replace(/\s+/g, " ");
  it("the trigger is a BEFORE UPDATE on jobs", () => {
    expect(trg, "trg_jobs_open_edit_tells_applicants is gone").toBeDefined();
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/UPDATE/);
  });
  it("only pending applicants, at most hourly, and the hour is the server's", () => {
    expect(body).toContain("a.status = 'pending'");
    expect(body).toContain("OLD.last_edit_notice_at > now() - interval '1 hour'");
    expect(body).toContain("NEW.last_edit_notice_at := OLD.last_edit_notice_at;");
  });
  it("the category change is refused once anyone applied", () => {
    expect(body).toContain("RAISE EXCEPTION 'category_locked_after_applications'");
  });
  it("the poster reads plain words, and the editor greys the picker", () => {
    expect(lifecycleErrorMessage({ message: "category_locked_after_applications" })).toMatch(/so the category stays/);
    expect(readFileSync(join(process.cwd(), "src/pages/posts/EditJobDialog.tsx"), "utf8")).toContain("disabled={hasHelper || hasApplicants}>");
  });
});

/**
 * F297 (whole-app audit 11-10, Worker 2, Low): after a Helpr withdrew, the poster's bell still said "<Name> applied ...
 * Next: review and pick a Helpr" and the job said "No applicants yet". Migration 20261111195445 adds an AFTER DELETE
 * trigger on applications: the applicant's own delete of a pending row on an open job (no block) tells the poster
 * "Application withdrawn" with the next step, and marks the stale "applied" notice read.
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked) and the newest CREATE TRIGGER.
 * Behaviour (real Postgres): src/test/pglite/withdrawnApplicationTellsThePoster.pglite.mjs (10 PASS; 5 FAIL with
 * NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111195445_withdrawn_application_tells_the_poster.sql |   IF OLD.status IS DISTINCT FROM 'pending'::application_status OR auth.uid() IS DISTINCT FROM OLD.helper_id THEN |   IF OLD.status IS DISTINCT FROM 'pending'::application_status THEN
 * @mutate supabase/migrations/20261111195445_withdrawn_application_tells_the_poster.sql |   IF COALESCE(public.are_users_blocked(OLD.helper_id, v_job.customer_id), true) THEN |   IF false THEN
 * @mutate supabase/migrations/20261111195445_withdrawn_application_tells_the_poster.sql |   AFTER DELETE ON public.applications |   AFTER UPDATE ON public.applications
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const defs = effectiveDefs(DIR);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("a withdrawn application tells the poster (F297)", () => {
  it("only the applicant's own delete of a pending row, on an open job, with no block, sends it", () => {
    const b = flat(defs.get("notify_poster_on_application_withdrawn")?.stmt ?? "");
    expect(b.length).toBeGreaterThan(1000);
    expect(b).toContain("IF OLD.status IS DISTINCT FROM 'pending'::application_status OR auth.uid() IS DISTINCT FROM OLD.helper_id THEN RETURN OLD;");
    expect(b).toContain("v_job.status <> 'open' THEN RETURN OLD;");
    expect(b).toContain("IF COALESCE(public.are_users_blocked(OLD.helper_id, v_job.customer_id), true) THEN RETURN OLD;");
    expect(b).toContain("'Application withdrawn'");
    expect(b).toContain("SET read = true");
  });

  it("the trigger fires after a DELETE on applications", () => {
    let last = "";
    for (const f of migrationFiles(DIR)) {
      const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
      for (const m of sql.matchAll(/CREATE TRIGGER trg_notify_poster_on_application_withdrawn\s+([\s\S]*?);/gi)) last = m[1];
    }
    expect(last.replace(/\s+/g, " ")).toContain("AFTER DELETE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_application_withdrawn()");
  });
});

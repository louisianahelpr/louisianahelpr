// @mutate supabase/migrations/20260923205811_close_pending_applications_on_job_cancel.sql | WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status) | WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
// @mutate supabase/migrations/20260923205811_close_pending_applications_on_job_cancel.sql | SET status = 'rejected',\n         closed_reason = 'job_cancelled'\n   WHERE job_id = NEW.id | SET status = 'rejected'\n   WHERE job_id = NEW.id
// @mutate supabase/migrations/20260923205811_close_pending_applications_on_job_cancel.sql | IF NEW.closed_reason = 'job_cancelled' THEN | IF false THEN
// @mutate src/components/job-card/jobStatusLine.ts | if (app.status === "rejected" && app.closed_reason !== "job_cancelled") return "not_selected"; | if (app.status === "rejected") return "not_selected";
// @mutate src/pages/jobs/AppliedJobCard.tsx | {app.closed_reason === "job_cancelled" | {app.closed_reason === "never"
// @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | {app.status === "rejected" && app.closed_reason !== "job_cancelled" && ( | {app.status === "rejected" && (
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { deriveHelperWait } from "@/components/job-card/jobStatusLine";
import type { AppliedApp } from "@/components/job-card/activityConstants";

/**
 * Q274: cancelling a job must close its PENDING applications, and must not
 * tell anyone they were turned down.
 *
 * Measured on prod 2026-09-23: create-payment cancel_escrow cancelled a job
 * and its applicant's row stayed 'pending' (20 such rows on cancelled jobs).
 * poster_cancel_job and every other path into 'cancelled' had the same gap.
 * The rule now lives on `jobs` (one AFTER UPDATE trigger, whatever path
 * cancels), closes with the only closing enum value ('rejected') plus
 * closed_reason='job_cancelled', and every reader of 'rejected' that would say
 * "not selected" / "Declined" checks that marker first.
 *
 * Behaviour (red on the old state, green 3x) is proven in
 * src/test/pglite/closeApplicationsOnJobCancel.pglite.mjs. This pins the
 * wiring against the NEWEST definition of each object, any dollar-quote tag,
 * comments blanked.
 */

const ROOT = resolve(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8"));

function newestFunction(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const file of files) {
    const sql = sqlOf(file);
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      found = { file, body: rest.slice(open, rest.indexOf(tag[1], open)) };
    }
  }
  return found;
}

/** The newest CREATE TRIGGER statement of this name, or null if a later DROP removed it. */
function newestTrigger(name: string): string | null {
  let stmt: string | null = null;
  for (const file of files) {
    const sql = sqlOf(file);
    const re = new RegExp(`(DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${name}\\b[^;]*;)|(CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;)`, "gi");
    for (const m of sql.matchAll(re)) stmt = m[2] ?? null;
  }
  return stmt;
}

const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("Q274: a cancelled job closes its pending applications, truthfully", () => {
  it("reads a real migration history (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("jobs carries an AFTER UPDATE trigger that fires on the move INTO cancelled", () => {
    const t = newestTrigger("trg_close_pending_applications_on_job_cancel");
    expect(t, "the trigger is created and not dropped by a later migration").not.toBeNull();
    expect(t!).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.jobs/i);
    expect(t!).toMatch(/WHEN\s*\(\s*NEW\.status\s*=\s*'cancelled'\s+AND\s+OLD\.status\s+IS\s+DISTINCT\s+FROM\s+NEW\.status\s*\)/i);
    expect(t!).toMatch(/EXECUTE\s+FUNCTION\s+public\.close_pending_applications_on_job_cancel\(\)/i);
  });

  it("the trigger function closes PENDING rows only, with the job_cancelled marker", () => {
    const f = newestFunction("close_pending_applications_on_job_cancel");
    expect(f).not.toBeNull();
    const b = f!.body.replace(/\s+/g, " ");
    expect(b).toMatch(/UPDATE public\.applications SET status = 'rejected', closed_reason = 'job_cancelled' WHERE job_id = NEW\.id AND status = 'pending'/);
  });

  it("the newest notify_on_application says the job was cancelled, never 'not selected', for that close", () => {
    const f = newestFunction("notify_on_application");
    expect(f).not.toBeNull();
    const b = f!.body;
    const marker = b.indexOf("NEW.closed_reason = 'job_cancelled'");
    const notSelected = b.indexOf("was not selected");
    expect(marker, `${f!.file}: no job_cancelled branch`).toBeGreaterThan(-1);
    expect(notSelected).toBeGreaterThan(marker);
    expect(b.slice(marker, notSelected)).toMatch(/was cancelled, so your application is closed/);
  });

  it("My Jobs' status line lets the job speak for a job-cancel close, and still says 'not picked' for a real decline", () => {
    const base = { id: "a", job_id: "j", helper_id: "h", job: { status: "cancelled" } } as unknown as AppliedApp;
    expect(deriveHelperWait({ ...base, status: "rejected", closed_reason: "job_cancelled" } as AppliedApp)).toBe("cancelled");
    expect(deriveHelperWait({ ...base, status: "rejected", closed_reason: null, job: { status: "open" } } as unknown as AppliedApp)).toBe("not_selected");
  });

  it("the applied card and the poster's Applicants panel read the marker before saying Not selected / Declined", () => {
    const card = src("src/pages/jobs/AppliedJobCard.tsx");
    expect(card).toMatch(/app\.closed_reason === "job_cancelled"\s*\?\s*"Job cancelled"/);
    const panel = src("src/pages/posts/postedJobs/ApplicantsPanel.tsx");
    expect(panel).toMatch(/app\.status === "rejected" && app\.closed_reason !== "job_cancelled" && \(/);
  });
});

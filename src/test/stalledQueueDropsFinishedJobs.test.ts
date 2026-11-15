/**
 * Q2789 (ledger a0597e872e21, "job stalled — nobody marked it done"): a stuck job that both sides finish themselves
 * after it was escalated must leave the admin's open Stuck jobs list and stop holding its Slack item open.
 *
 * Measured on prod 2026-11-15 (read-only): job 7b1da54b was escalated 2026-11-10 and completed by both sides
 * 2026-11-14, but job_completion_nudges.resolved_at stayed NULL, so admin_queue_still_pending('stalled-job') kept the
 * ledger item open and admin_stalled_job_queue(false) still listed the finished job.
 *
 * Both readers must ask the sweep's own predicate (completionStalled in supabase/functions/_shared/stalledCompletion.ts):
 * status in_progress and neither done stamp on. Behaviour in real Postgres:
 * src/test/pglite/stalledQueueDropsFinishedJobs.pglite.mjs (12 PASS; 5 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261115185124_stalled_queue_drops_finished_jobs.sql |          AND j.status::text = 'in_progress' |          AND true
 * @mutate supabase/migrations/20261115185124_stalled_queue_drops_finished_jobs.sql |          OR (j.status::text = 'in_progress' AND j.helper_completed_at IS NULL AND j.poster_completed_at IS NULL)) |          OR true)
 * @mutate supabase/functions/_shared/stalledCompletion.ts |   if (job.helper_completed_at \|\| job.poster_completed_at) return false; |   if (job.helper_completed_at) return false;
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

/** The trap, as the sweep defines it: every clause the server readers must repeat. */
const TRAP = [
  "j.status::text = 'in_progress'",
  "j.helper_completed_at IS NULL",
  "j.poster_completed_at IS NULL",
];

describe("a stuck job finished after escalation leaves the admin queue (Q2789)", () => {
  it("reads the newest definitions (inventory floor)", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(defs.get("admin_queue_still_pending")?.stmt.length ?? 0).toBeGreaterThan(1000);
    expect(defs.get("admin_stalled_job_queue")?.stmt.length ?? 0).toBeGreaterThan(500);
  });

  it("the sweep's predicate is still in_progress + neither done stamp (the rule the server copies)", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/_shared/stalledCompletion.ts"), "utf8"));
    const fn = src.slice(src.indexOf("export function completionStalled"), src.indexOf("export function stalledCompletionStage"));
    expect(fn).toContain('if (job.status !== "in_progress") return false;');
    expect(fn).toContain("if (job.helper_completed_at || job.poster_completed_at) return false;");
  });

  it("the 'stalled-job' close rule holds the alert open only while the job is still in the trap", () => {
    const body = flat(defs.get("admin_queue_still_pending")?.stmt ?? "");
    const at = body.indexOf("p_rule = 'stalled-job'");
    expect(at).toBeGreaterThan(-1);
    const branch = body.slice(at, body.indexOf("ELSIF", at + 10));
    for (const clause of TRAP) expect(branch, clause).toContain(clause);
    expect(branch).toContain("n.resolved_at IS NULL");
  });

  it("the open Stuck jobs list (and its rail badge) holds only jobs still in the trap", () => {
    const body = flat(defs.get("admin_stalled_job_queue")?.stmt ?? "");
    expect(body).toContain(
      "AND (coalesce(p_include_resolved, false) OR (j.status::text = 'in_progress' AND j.helper_completed_at IS NULL AND j.poster_completed_at IS NULL))",
    );
    expect(body).toContain("public.has_role(auth.uid(), 'admin')");
  });
});

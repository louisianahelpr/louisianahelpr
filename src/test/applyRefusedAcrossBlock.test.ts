/**
 * Q341 — applying across a block (either direction) is refused on EVERY write
 * path, not only the one the app does not use.
 *
 * WHAT WAS BROKEN (prod, 2026-09-24): the INSERT policy on `applications`
 * tested NOT are_users_blocked(...), but the app applies through apply_to_job,
 * which is SECURITY DEFINER and bypasses RLS; neither it nor any BEFORE INSERT
 * trigger looked at user_blocks. An applicant who had blocked the poster on
 * 2026-09-11 applied to that poster's job on 2026-09-22.
 *
 * The rule now lives in the BEFORE INSERT trigger enforce_application_job_state
 * (C10), which every path runs through — apply_to_job, the client's direct
 * INSERT fallback, respond_to_direct_offer and raw PostgREST. This reads the
 * EFFECTIVE definition the migrations leave in the database (not merely the
 * newest text), and pins:
 *   - the block test is on NEW.helper_id vs the job's customer_id (a test on
 *     auth.uid() would miss the SECURITY DEFINER paths);
 *   - it raises a code with helper-facing copy;
 *   - it sits AFTER the server-context early return (a cron is not a helper)
 *     and BEFORE the job-status checks (the reason the helper can act on).
 *   - the trigger is actually attached BEFORE INSERT on applications.
 *
 * Behavioural proof, red-before/green-after on a prod-shaped schema:
 * scripts/probes/apply-across-block.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { resolveApplyErrorCopy } from "@/pages/home/applyErrorCopy";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

describe("Q341: apply across a block is refused by the applications BEFORE INSERT trigger", () => {
  const defs = effectiveDefs(MIG_DIR);
  const def = defs.get("enforce_application_job_state");

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(def, "enforce_application_job_state not defined by any migration").toBeTruthy();
  });

  const body = blankSqlComments(def?.stmt ?? "");

  it("tests the block on NEW.helper_id against the job's poster, and raises applicant_blocked", () => {
    expect(body).toMatch(
      /if\s+(public\.)?are_users_blocked\s*\(\s*new\.helper_id\s*,\s*v_job\.customer_id\s*\)\s+then\s+raise\s+exception\s+'applicant_blocked'/i,
    );
  });

  it("sits after the server-context return and before the job-status check", () => {
    const server = body.search(/is_server_context\s*\(\s*\)/i);
    const block = body.search(/are_users_blocked/i);
    const status = body.search(/'job_not_open'/i);
    expect(server).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(server);
    expect(block).toBeLessThan(status);
  });

  it("the refusal has helper-facing copy that does not say who blocked whom", () => {
    const copy = resolveApplyErrorCopy("applicant_blocked");
    expect(copy).toBeTruthy();
    expect(copy).not.toMatch(/block/i);
  });

  it("the trigger is attached BEFORE INSERT on applications", () => {
    let attached = false;
    for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      if (/drop\s+trigger\s+(if\s+exists\s+)?trg_application_job_state\b/i.test(sql)) attached = false;
      if (
        /create\s+(or\s+replace\s+)?trigger\s+trg_application_job_state\s+before\s+insert\s+on\s+(public\.)?applications[\s\S]*?execute\s+function\s+(public\.)?enforce_application_job_state\s*\(/i.test(
          sql,
        )
      )
        attached = true;
    }
    expect(attached).toBe(true);
  });
});

// The C10 block check removed from the trigger.
// @mutate supabase/migrations/20260924020956_applications_refuse_and_hide_across_block.sql | IF public.are_users_blocked(NEW.helper_id, v_job.customer_id) THEN | IF false THEN
// The check written on auth.uid(), which the SECURITY DEFINER paths would miss.
// @mutate supabase/migrations/20260924020956_applications_refuse_and_hide_across_block.sql | are_users_blocked(NEW.helper_id, v_job.customer_id) | are_users_blocked(auth.uid(), v_job.customer_id)

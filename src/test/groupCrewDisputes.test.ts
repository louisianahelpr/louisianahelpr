import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * THE CLASS: a dispute rule that decides "is the caller the Helpr?" by
 * comparing them to jobs.helper_id with `<>` / `!=`.
 *
 * A crew has no lead (Q407, 20260925154606): jobs.helper_id is NULL on every
 * group job, and `_uid <> NULL` is NULL, so a party check written
 * `IF _uid <> _customer AND _uid <> _helper THEN RAISE` never raises on a
 * crew. open_dispute_as and rpc_escalate_dispute were exactly that: ANY
 * signed-in account could open or escalate a dispute on any booked crew job
 * and freeze its escrow (docs/OPEN.md Q409; red on the before state in
 * src/test/pglite/groupCrewDisputes.pglite.mjs R1/R2). The fix
 * (20260925234055) checks the roster, NULL-safe, and gives a crew its own
 * decision: each member's FROZEN share is paid or refunded
 * (rpc_decide_crew_dispute), executed only by process-scheduled-payouts' crew
 * fan-out and closed only by mark_crew_dispute_executed.
 *
 * Standing guards, read from the world (effective definitions, newest):
 *   1. no function anywhere compares a caller to a helper with <> / != (the
 *      class, repo-wide), and the two dispute party checks read the roster;
 *   2. rpc_decide_dispute refuses a crew before its first write;
 *   3. the crew decision is priced on the frozen share and nowhere re-derived;
 *   4. only the fan-out's one writer closes a crew decision, and it is
 *      service-only; the lock trigger is installed;
 *   5. the PGlite proof runs the effective definitions, red-before.
 */

// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql |   IF NOT _system\n     AND _uid IS DISTINCT FROM _customer\n     AND (_helper IS NULL OR _uid IS DISTINCT FROM _helper)\n     AND NOT _on_crew THEN |   IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql |   _on_crew := _is_group IS TRUE AND EXISTS (\n    SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid); |   _on_crew := false;
// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql |   IF _is_group IS TRUE THEN\n    RAISE EXCEPTION 'group_dispute_needs_crew_decision' |   IF false THEN\n    RAISE EXCEPTION 'group_dispute_needs_crew_decision'
// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql |   SELECT _dispute_id, _job_id, g.helper_id, g.slot_no, g.share_cents, |   SELECT _dispute_id, _job_id, g.helper_id, g.slot_no, (round(_job.budget * 100) / _members)::integer,
// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql | REVOKE ALL ON FUNCTION public.mark_crew_dispute_executed(uuid, integer, integer, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.mark_crew_dispute_executed(uuid, integer, integer, text) FROM PUBLIC, anon;
// @mutate supabase/migrations/20260925234055_group_crew_disputes.sql |      AND COALESCE(current_setting('app.crew_fanout_settle', true), '') <> '1' THEN |      AND false THEN

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const THIS = "20260925234055_group_crew_disputes.sql";
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");
const thisSql = () => blankSqlComments(readFileSync(resolve(MIGRATIONS, THIS), "utf8"));

/** A caller compared to a helper with <> / != : NULL on a crew, so it never refuses. */
const CALLER_NOT_HELPER =
  /\b(?:_uid|v_uid|_caller|v_caller|auth\.uid\(\)|\(select auth\.uid\(\)\))\s*(?:<>|!=)\s*(?:_helper|v_helper|_helper_id|v_helper_id|(?:\w+\.)?helper_id)\b/i;
/** The NULL-safe spelling the fix uses. */
const CALLER_DISTINCT_FROM_HELPER = /\b_uid IS DISTINCT FROM _helper\b/;

/**
 * Matches of the pattern that compare the caller to a function ARGUMENT, not
 * to a job's helper. EXACT and two-way: a fixed one fails until removed.
 */
const NOT_A_JOB_HELPER: Record<string, string> = {
  get_helper_earnings_export:
    "`auth.uid() <> _helper_id` compares the caller to its own _helper_id ARGUMENT; a NULL argument passes the check but its `helper_id = _helper_id` query matches no rows (a NULL-argument finding, docs/OPEN.md Q427, not a crew hole)",
};

describe("disputes on a crew (Q409)", () => {
  it("1. no function compares a caller to a helper with <> / != (NULL on a crew), and the dispute party checks read the roster", () => {
    const offenders = [...EFFECTIVE.entries()]
      .filter(([, d]) => CALLER_NOT_HELPER.test(blankSqlComments(d.stmt)))
      .map(([n]) => n)
      .sort();
    expect(offenders, "a party check that a NULL helper_id (every crew) silently passes").toEqual(Object.keys(NOT_A_JOB_HELPER).sort());

    // Inventory floor: the NULL-safe party check exists where the class lived.
    const safe = [...EFFECTIVE.entries()].filter(([, d]) => CALLER_DISTINCT_FROM_HELPER.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(safe.length).toBeGreaterThan(1);
    for (const fn of ["open_dispute_as", "rpc_escalate_dispute"]) {
      const b = body(fn);
      expect(b, `${fn} lost its NULL-safe party check`).toMatch(/_uid IS DISTINCT FROM _customer\s+AND \(_helper IS NULL OR _uid IS DISTINCT FROM _helper\)\s+AND NOT _on_crew THEN\s+RAISE EXCEPTION 'not authorized for this job'/);
      expect(b, `${fn} no longer reads the roster`).toMatch(/_on_crew := [^;]*EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = _job_id AND g\.helper_id = _uid\)/);
    }
  });

  it("2. rpc_decide_dispute refuses a crew before its first write", () => {
    const b = body("rpc_decide_dispute");
    const refuse = b.indexOf("IF _is_group IS TRUE THEN");
    expect(refuse).toBeGreaterThan(-1);
    expect(b.slice(refuse, refuse + 200)).toMatch(/RAISE EXCEPTION 'group_dispute_needs_crew_decision'/);
    const firstWrite = b.search(/\bUPDATE public\.(disputes|jobs)\b|\bINSERT INTO\b/);
    expect(firstWrite).toBeGreaterThan(refuse);
  });

  it("3. a crew decision is priced on each member's FROZEN share and refuses a member without one", () => {
    const b = body("rpc_decide_crew_dispute");
    expect(b).toMatch(/SELECT _dispute_id, _job_id, g\.helper_id, g\.slot_no, g\.share_cents,/);
    expect(b).toMatch(/g\.share_cents IS NULL OR g\.slot_no IS NULL\)\) THEN\s+RAISE EXCEPTION 'crew_share_not_frozen'/);
    expect(b, "a crew decision must not re-derive a share from budget / helpers_needed").not.toMatch(/helpers_needed|\/\s*_members/);
    expect(b).toMatch(/execution_status = 'crew_fanout'/);
    expect(b).toMatch(/crew_dispute_all_refunded/);
    expect(b).toMatch(/admin_is_party/);
    // Only the decision writes the outcomes.
    const writers = [...EFFECTIVE.entries()]
      .filter(([, d]) => /INSERT INTO public\.crew_dispute_member_outcomes/i.test(blankSqlComments(d.stmt)))
      .map(([n]) => n);
    expect(writers).toEqual(["rpc_decide_crew_dispute"]);
  });

  it("4. only the payout fan-out closes a crew decision, through one service-only writer, behind a lock trigger", () => {
    const sql = thisSql();
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.mark_crew_dispute_executed(uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.mark_crew_dispute_executed\(uuid, integer, integer, text\) TO service_role;/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.rpc_decide_crew_dispute(uuid, text, uuid[]) FROM PUBLIC, anon;");
    expect(sql).toMatch(/CREATE TRIGGER trg_crew_fanout_dispute_lock\s+BEFORE UPDATE ON public\.disputes\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_crew_fanout_dispute_lock\(\)/);
    expect(body("enforce_crew_fanout_dispute_lock")).toMatch(/NEW\.execution_status IS DISTINCT FROM OLD\.execution_status\s+AND COALESCE\(current_setting\('app\.crew_fanout_settle', true\), ''\) <> '1' THEN\s+RAISE/);
    // Every setter of the flag is the one writer.
    const setters = [...EFFECTIVE.entries()]
      .filter(([, d]) => /set_config\('app\.crew_fanout_settle', '1'/.test(blankSqlComments(d.stmt)))
      .map(([n]) => n);
    expect(setters).toEqual(["mark_crew_dispute_executed"]);

    // The edge side: the fan-out skips a refunded member, refunds on the
    // dispute's key, and closes through the RPC; nothing else calls it.
    const pay = blankComments(readFileSync(resolve(root, "supabase/functions/process-scheduled-payouts/index.ts"), "utf8"));
    expect(pay).toMatch(/if \(refundedByDecision\.has\(helperId\)\) continue;/);
    expect(pay).toMatch(/idempotencyKey: decision \? `crew-dispute-refund-\$\{decision\.disputeId\}`/);
    expect(pay).toMatch(/rpc\("mark_crew_dispute_executed"/);
    expect(pay).toMatch(/checkUnsettledDispute\(supabaseAdmin, job\.id, \{ crewFanout: job\.is_group_job === true \}\)/);
    const unsettled = blankComments(readFileSync(resolve(root, "supabase/functions/_shared/unsettledDispute.ts"), "utf8"));
    expect(unsettled).toMatch(/opts\.crewFanout\s*\?\s*"execution_status\.is\.null,and\(execution_status\.neq\.executed,execution_status\.neq\.crew_fanout\)"\s*:\s*"execution_status\.is\.null,execution_status\.neq\.executed"/);
  });

  it("5. the PGlite proof exists, runs the effective definitions and is red-before", () => {
    const proof = resolve(root, "src/test/pglite/groupCrewDisputes.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["R1 an outsider opens a dispute", "R2 an outsider escalates", "R4 rpc_decide_dispute records a 50/50 split on a crew", "A9 admin decides", "A13 once the fan-out is due"]) {
      expect(src).toContain(c);
    }
  });
});

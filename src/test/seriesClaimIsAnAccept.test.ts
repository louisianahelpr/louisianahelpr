/**
 * Q1214 (2) (lh-authz-rls review of Q1187/Q1188): every write that CONFIRMS a
 * Helpr on a job (stamps jobs.helper_confirmed_at) is an accept RPC that sets
 * app.accept_rpc for that one UPDATE, and the award gate grants no other way
 * through. Before 20261007051854 the gate exempted "the caller taking an open
 * job and confirming it at once" (claim_series_dates' pickup), leaning on
 * trg_hire_columns_rpc_only to refuse a client's helper_id.
 *
 * Read from the NEWEST definition of each function across the migrations
 * (effectiveDefs). Inventory: the SQL functions whose UPDATE of public.jobs
 * sets helper_confirmed_at to a time. Live check 2026-10-07 found exactly two
 * (complete_job_accept, claim_series_dates). PGlite before/after proof:
 * ~/.lh-pglite/q1214.mjs (before: allowed without the flag; after: refused
 * without it, allowed with it).
 *
 * @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql |         PERFORM set_config('app.accept_rpc', '1', true);\n        UPDATE public.jobs | UPDATE public.jobs
 * @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql |     RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501',\n      HINT = 'An offer is accepted with Accept | IF auth.uid() IS NULL THEN RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501',\n      HINT = 'An offer is accepted with Accept
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const CONFIRMING_UPDATE = /UPDATE\s+public\.jobs\s+SET[^;]*?helper_confirmed_at\s*=\s*(?:now\(\)|clock_timestamp\(\)|current_timestamp)[^;]*;/gi;

describe("Q1214 (2): confirming a Helpr is always a flagged accept", () => {
  const writers = [...defs.keys()].filter((n) => CONFIRMING_UPDATE.test(body(n)) && (CONFIRMING_UPDATE.lastIndex = 0, true));

  // Exact, both ways (lh-authz-rls review of Q1214 (2)): a new writer must be
  // added here, and must set the flag (the next test).
  it("the confirming writers are exactly the two accept RPCs", () => {
    expect([...writers].sort()).toEqual(["claim_series_dates", "complete_job_accept"]);
  });

  // @mutate supabase/migrations/20261007051854_series_claim_is_an_accept.sql |          WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;\n        PERFORM set_config('app.accept_rpc', '0', true); |          WHERE id = v_child_id AND status = 'open' AND helper_id IS NULL;
  it("each turns the flag back off right after its confirming UPDATE", () => {
    const bad = writers.filter((n) => {
      const src = body(n);
      return [...src.matchAll(CONFIRMING_UPDATE)].some((m) => {
        const after = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 200);
        // complete_job_accept reads FOUND first (v_done := FOUND;), which the PERFORM would reset.
        return !/^\s*(?:\w+\s*:=\s*FOUND\s*;\s*)?PERFORM set_config\(\s*'app\.accept_rpc'\s*,\s*'0'\s*,\s*true\s*\)\s*;/.test(after);
      });
    });
    expect(bad).toEqual([]);
  });

  it("each sets app.accept_rpc to '1' right before its confirming UPDATE", () => {
    const bad: string[] = [];
    for (const n of writers) {
      const src = body(n);
      for (const m of src.matchAll(CONFIRMING_UPDATE)) {
        // The flag is the statement immediately before the UPDATE (comments blanked).
        const before = src.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
        if (!/set_config\(\s*'app\.accept_rpc'\s*,\s*'1'\s*,\s*true\s*\)\s*;\s*$/.test(before)) bad.push(n);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the award gate refuses every other confirming UPDATE, with no exemption", () => {
    const gate = body("enforce_helper_award_gate");
    expect(gate).toMatch(/IF TG_OP = 'UPDATE' AND current_setting\('app\.accept_rpc', true\) IS DISTINCT FROM '1' THEN\s*RAISE EXCEPTION 'accept_required'/);
    expect(gate).not.toMatch(/v_takes_open_job/);
  });
});

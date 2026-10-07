/**
 * Q1244 — no open/withdraw loop on a dispute.
 *
 * Each NEW dispute pages Slack as critical and notifies the other party and
 * the admins; rpc_open_dispute + rpc_withdraw_dispute let one party repeat that
 * as often as they liked. 20261005062746 makes the people's door refuse a NEW
 * filing by the same person on the same job within 10 minutes of a dispute
 * they withdrew there. This pins the NEWEST definition (effectiveDefs replays
 * every migration) and that the code has a sentence in the app on both paths
 * that reach it (DisputeDialog's rpc_open_dispute and Cancel Job's
 * helper_abort_job). Behaviour: src/test/pglite/disputeRefileCooldown.pglite.mjs
 * (3 FAILED on the live body, ALL PASS applied 3x).
 *
 * Q1330 (owner 2026-10-07, option (a)): 20261007040226 makes the wait GROW per
 * withdrawal by the same person on the same job: 10 minutes, 1 hour, then 24
 * hours. Behaviour: src/test/pglite/disputeRefileCooldownEscalates.pglite.mjs
 * (NEW_MIGRATION=skip: 4 FAILED on the live body; ALL PASS applied 3x).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261007040226_dispute_refile_cooldown_escalates.sql |       WHEN _withdrawn >= 3 THEN interval '24 hours' |       WHEN _withdrawn >= 3 THEN interval '10 minutes'
// @mutate supabase/migrations/20261007040226_dispute_refile_cooldown_escalates.sql |       WHEN _withdrawn = 2 THEN interval '1 hour' |       WHEN _withdrawn = 2 THEN interval '10 minutes'
// @mutate supabase/migrations/20261007040226_dispute_refile_cooldown_escalates.sql |       AND d.opener_id = _uid |       AND d.opener_id IS NOT NULL
// @mutate supabase/migrations/20261007040226_dispute_refile_cooldown_escalates.sql |       RAISE EXCEPTION 'dispute_refile_cooldown' |       RAISE NOTICE 'dispute_refile_cooldown'
// @mutate src/lib/lifecycleErrors.ts |     // Q1244 (20261005062746): no open/withdraw loop on one job.\n    dispute_refile_cooldown: |     // Q1244 (20261005062746): no open/withdraw loop on one job.\n    dispute_refile_cooldown_gone:
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = blankSqlComments(defs.get("rpc_open_dispute")?.stmt ?? "");

describe("Q1244: rpc_open_dispute refuses a re-file loop", () => {
  it("the newest definition is found", () => {
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(defs.size).toBeGreaterThan(200);
  });

  it("refuses a NEW filing too soon after the caller's own withdrawals on the job, growing per repeat, before filing", () => {
    const flat = body.replace(/\s+/g, " ");
    const count = flat.search(
      /SELECT count\(\*\), max\(d\.decided_at\) INTO _withdrawn, _last_withdrawn FROM public\.disputes d WHERE d\.job_id = _job_id AND d\.opener_id = _uid AND d\.status = 'withdrawn'/i,
    );
    expect(count, "the per-person withdrawal count is not in the newest rpc_open_dispute").toBeGreaterThan(-1);
    expect(flat).toMatch(/WHEN _withdrawn >= 3 THEN interval '24 hours' WHEN _withdrawn = 2 THEN interval '1 hour' ELSE interval '10 minutes'/i);
    const refuse = flat.search(/IF _withdrawn > 0 AND _last_withdrawn > now\(\) - _cooldown THEN RAISE EXCEPTION 'dispute_refile_cooldown'/i);
    const files = flat.search(/RETURN public\.open_dispute_as\(/i);
    expect(refuse).toBeGreaterThan(count);
    expect(files).toBeGreaterThan(refuse);
  });

  it("an append to a still-open dispute is not refused (only a NEW filing is)", () => {
    expect(body).toMatch(/IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.disputes\s+d\s+WHERE\s+d\.job_id\s*=\s*_job_id\s+AND\s+d\.status\s*=\s*'open'\s*\)/i);
  });

  it("the app says what happened on both paths that reach it", () => {
    const err = { code: "P0001", message: "dispute_refile_cooldown" };
    for (const rpc of ["rpc_open_dispute", "helper_abort_job"] as const) {
      expect(rpcErrorMessage(rpc, err), rpc).toMatch(/withdrew a dispute on this job/);
    }
  });
});

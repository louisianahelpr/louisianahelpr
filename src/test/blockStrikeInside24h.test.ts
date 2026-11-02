/**
 * Q2675 + Q2692 (audit 1102e row 8; lead verdict 11-02): block_user_and_settle's single-Helpr path.
 *  - A poster who blocks their committed Helpr is struck only inside 24 hours of the start (is_late_cancellation),
 *    the rule poster_cancel_job follows (JOBS-14, owner 10-30); it was struck at any distance.
 *  - A hired Helpr who blocks the poster no longer prices a late fee onto the poster's job; it is treated like
 *    helper_cancel_booking: fee 0, and the Helpr's strike (apply_job_denial_consequence) inside 24 hours only.
 * Behaviour, red then green with planted defects: src/test/pglite/blockStrikeInside24h.pglite.mjs.
 *
 * @mutate supabase/migrations/20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql | AND v_committed AND public.is_late_cancellation(v_committed, v_hours) THEN | AND v_committed THEN
 * @mutate supabase/migrations/20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql |       WHEN v_helpr_blocks THEN 0\n |
 * @mutate supabase/migrations/20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql |     v_helpr_blocks := v_job.helper_id = v_user; |     v_helpr_blocks := false;
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DIR = resolve(__dirname, "../../supabase/migrations");
const def = effectiveDefs(DIR).get("block_user_and_settle");
const body = blankSqlComments(def?.stmt ?? "");

describe("a block strikes and charges like a cancel (Q2675, Q2692)", () => {
  it("reads the newest definition", () => {
    expect(def?.file).toBe("20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql");
    expect(body.length).toBeGreaterThan(5000);
  });

  it("the poster's strike is gated on the 24-hour rule", () => {
    expect(body).toMatch(/IF\s+v_ladder_present\s+AND\s+v_job\.customer_id\s*=\s*v_user\s+AND\s+v_committed\s+AND\s+public\.is_late_cancellation\(v_committed,\s*v_hours\)\s+THEN\s+PERFORM\s+public\.apply_cancellation_violation_consequence\(/);
  });

  it("a Helpr's block prices no fee for the poster, and strikes the Helpr only inside 24 hours", () => {
    expect(body).toMatch(/v_helpr_blocks\s*:=\s*v_job\.helper_id\s*=\s*v_user;/);
    expect(body).toMatch(/v_fee\s*:=\s*CASE\s+WHEN\s+v_helpr_blocks\s+THEN\s+0\s+WHEN/);
    expect(body).toMatch(/IF\s+v_helpr_blocks\s+AND\s+v_job\.helper_confirmed_at\s+IS\s+NOT\s+NULL\s+AND\s+public\.is_late_cancellation\(true,\s*v_hours\)\s+THEN\s+PERFORM\s+public\.apply_job_denial_consequence\(\s*v_user,\s*v_job\.id,/);
  });
});

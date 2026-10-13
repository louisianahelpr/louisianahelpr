/**
 * Q1415 (f): a ban review's decision never weakens a stricter retained
 * judgment applied during the review (lh-authz-rls re-review of f2644839e,
 * 2026-10-06; and its review of this fix's first build, 2026-10-12).
 *
 * THE BUG: while a card/bank review is open, enforce_retained_ban can apply a
 * stricter retained judgment from another identity signal (exact ID, phone or
 * email), recorded in ban_evasion_matches with auto_banned. The confirm wrote
 * the REVIEW's judgment over it (a permanent identity ban could come out
 * temporary), and a lift of the CARD match erased it.
 *
 * The class, from the NEWEST definitions (any dollar tag, comments blanked):
 *   - every function that DECIDES a review (it sets ban_settlement_queue's
 *     review_state to 'confirmed' or 'lifted') and writes profiles.ban_status
 *     takes ban_review_retained_floor(...) before that write;
 *   - the floor counts only standing judgments applied during the review:
 *     auto_banned, not cleared, a live retained row, recorded (or re-applied)
 *     since the review opened, and not a spent suspension; and it keeps a
 *     no-end suspension over a dated one.
 * Behaviour (real Postgres, prod's bodies md5-checked; live 6 FAIL, fixed
 * ALL PASS applied 3x): src/test/pglite/banReviewConfirmStrictest.pglite.mjs.
 *
 * @mutate supabase/migrations/20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql |   v_floor := public.ban_review_retained_floor(p_user_id, v_review.created_at);\n  IF v_floor IS NOT NULL THEN\n    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_final) THEN |   v_floor := NULL;\n  IF v_floor IS NOT NULL THEN\n    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_final) THEN
 * @mutate supabase/migrations/20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql |   v_floor := public.ban_review_retained_floor(p_user_id, v_review.created_at);\n  IF v_floor IS NOT NULL THEN\n    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_status) THEN |   v_floor := NULL;\n  IF v_floor IS NOT NULL THEN\n    IF public.ban_standing_rank(v_floor ->> 'ban_status') > public.ban_standing_rank(v_status) THEN
 * @mutate supabase/migrations/20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql |        AND (m.created_at >= p_since OR rb.reapplied_at >= p_since) |        AND true
 * @mutate supabase/migrations/20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql |        AND (rb.expires_at IS NULL OR rb.expires_at > now()) |        AND true
 */
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const FLOOR = "ban_review_retained_floor";

describe("a ban review's decision keeps the strictest standing judgment (Q1415 f)", () => {
  const defs = effectiveDefs(MIG);
  const decides = [...defs].filter(([, d]) =>
    /update\s+public\.ban_settlement_queue\b[^;]*?\bset\s+review_state\s*=\s*'(confirmed|lifted)'/i.test(blankSqlComments(d.stmt)));

  it("inventory: the review's decisions are found", () => {
    const names = decides.map(([n]) => n).sort();
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual(expect.arrayContaining(["admin_confirm_ban_settlement", "lift_ban_settlement_review"]));
  });

  it("each decision that writes the standing takes the retained floor first", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const [name, d] of decides) {
      const body = blankSqlComments(d.stmt);
      const write = body.search(/update\s+public\.profiles\b[^;]*?\bset\s+ban_status\s*=/i);
      if (write < 0) continue; // a decision that writes no standing
      checked++;
      const floor = body.search(new RegExp(String.raw`:=\s*public\.${FLOOR}\(\s*p_user_id\s*,\s*v_review\.created_at\s*\)`, "i"));
      const applied = /if\s+v_floor\s+is\s+not\s+null\s+then\s+if\s+public\.ban_standing_rank\(\s*v_floor\s*->>\s*'ban_status'\s*\)\s*>/i.test(body);
      if (floor < 0 || floor > write || !applied) bad.push(`${name} (${d.file})`);
    }
    expect(checked).toBeGreaterThan(1);
    expect(bad).toEqual([]);
  });

  it("the floor counts only standing judgments applied during the review", () => {
    const def = defs.get(FLOOR);
    expect(def, `no ${FLOOR} in the migrations`).toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/m\.auto_banned/i);
    expect(body).toMatch(/m\.cleared_at\s+is\s+null/i);
    expect(body).toMatch(/join\s+public\.retained_bans\s+rb\s+on\s+rb\.id\s*=\s*m\.retained_ban_id/i);
    expect(body).toMatch(/\(\s*rb\.expires_at\s+is\s+null\s+or\s+rb\.expires_at\s*>\s*now\(\)\s*\)/i);
    expect(body).toMatch(/\(\s*m\.created_at\s*>=\s*p_since\s+or\s+rb\.reapplied_at\s*>=\s*p_since\s*\)/i);
    expect(body).toMatch(/original_expires_at\s*<=\s*now\(\)/i);
    // A no-end suspension is never replaced by a dated one.
    expect(body).toMatch(/v_until\s+is\s+not\s+null\s+and\s+\(\s*v_m\.ex\s+is\s+null\s+or\s+v_m\.ex\s*>\s*v_until\s*\)/i);
  });
});

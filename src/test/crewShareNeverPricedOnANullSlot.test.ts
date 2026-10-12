/**
 * Q1380 (lh-money-escrow review, 2026-10-05): a crew member's share is never
 * priced on a NULL slot.
 *
 * crew_slot_share_cents(total, needed, NULL) is 0. A roster row from before
 * the slots existed (20260925154606) has no slot_no and no share_cents, so
 * block_user_and_settle priced a late block on it at $0: the member was owed
 * nothing and not even the "fee owed by hand" alert fired. poster_cancel_job
 * already fell back to the hire-order position.
 *
 * THE CLASS: every effective SQL function that calls crew_slot_share_cents
 * passes a slot that cannot be a bare (nullable) slot_no column: a variable,
 * a COALESCE, or a position expression. Inventory from the effective
 * definitions (later rewrites applied), comments blanked. Behaviour:
 * src/test/pglite/crewBlockSlotlessShare.pglite.mjs.
 *
 * @mutate supabase/migrations/20261012124103_crew_block_slotless_share_by_hire_order.sql | COALESCE(v_crew.helpers_needed, 1), v_hire_ix)); | COALESCE(v_crew.helpers_needed, 1), v_crew.slot_no));
 * @mutate supabase/migrations/20261012124103_crew_block_slotless_share_by_hire_order.sql |                     ELSE x.joined_at < v_crew.member_joined_at |                     ELSE x.id < v_crew.slot_id
 * @mutate supabase/migrations/20261012124103_crew_block_slotless_share_by_hire_order.sql | THEN x.joined_at IS NOT NULL OR x.id < v_crew.slot_id | THEN x.id < v_crew.slot_id
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));

/** The third argument of every crew_slot_share_cents( call, per caller. */
function slotArgs(): Array<{ fn: string; slot: string }> {
  const out: Array<{ fn: string; slot: string }> = [];
  for (const [fn, d] of defs) {
    if (fn === "crew_slot_share_cents") continue;
    const c = blankSqlComments(d.stmt);
    for (const m of c.matchAll(/crew_slot_share_cents\s*\(/gi)) {
      // Split the call's arguments at depth 0.
      let depth = 1, i = m.index! + m[0].length, start = i;
      const args: string[] = [];
      for (; i < c.length && depth > 0; i++) {
        const ch = c[i];
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) args.push(c.slice(start, i)); }
        else if (ch === "," && depth === 1) { args.push(c.slice(start, i)); start = i + 1; }
      }
      out.push({ fn, slot: (args[2] ?? "").trim() });
    }
  }
  return out;
}

describe("a crew share is never priced on a NULL slot (Q1380)", () => {
  const calls = slotArgs();

  it("finds the callers (inventory floor)", () => {
    expect(calls.map((c) => c.fn)).toEqual(expect.arrayContaining(["block_user_and_settle", "poster_cancel_job", "accept_group_application"]));
    expect(calls.length).toBeGreaterThan(3);
  });

  it("no caller passes a bare slot_no column", () => {
    const bad = calls.filter((c) => /^\(?\s*\w+\.slot_no\s*\)?$/i.test(c.slot));
    expect(bad, "fall back to the hire-order position (poster_cancel_job) instead of a nullable slot_no").toEqual([]);
  });

  it("the block's fallback is the hire order poster_cancel_job uses (joined_at NULLS LAST, then id)", () => {
    const body = blankSqlComments(defs.get("block_user_and_settle")?.stmt ?? "");
    expect(body).toMatch(/v_hire_ix\s*:=\s*v_crew\.slot_no\s*;\s*IF\s+v_hire_ix\s+IS\s+NULL\s+THEN/i);
    // A blocked row with no joined_at sorts LAST: every row with one is before it.
    expect(body).toMatch(/WHEN\s+v_crew\.member_joined_at\s+IS\s+NULL\s+THEN\s+x\.joined_at\s+IS\s+NOT\s+NULL\s+OR\s+x\.id\s*<\s*v_crew\.slot_id/i);
    expect(body).toMatch(/ELSE\s+x\.joined_at\s*<\s*v_crew\.member_joined_at\s+OR\s+\(x\.joined_at\s*=\s*v_crew\.member_joined_at\s+AND\s+x\.id\s*<\s*v_crew\.slot_id\)/i);
    expect(blankSqlComments(defs.get("poster_cancel_job")?.stmt ?? "")).toMatch(/row_number\(\)\s+OVER\s+\(ORDER\s+BY\s+g\.joined_at\s+NULLS\s+LAST,\s*g\.id\)/i);
  });
});

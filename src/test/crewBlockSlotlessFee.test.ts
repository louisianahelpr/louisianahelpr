/**
 * Q1380 (lh-money-escrow review, 2026-10-05): a poster blocking a member of a
 * crew whose roster row has no slot_no (legacy) owed $0, because
 * block_user_and_settle priced crew_slot_share_cents(..., NULL). Like
 * poster_cancel_job, it now prices the row's hire-order slot.
 *
 * Static half: the newest block_user_and_settle reads a hire-order fallback
 * for slot_no (row_number over joined_at NULLS LAST, id). Behaviour (real
 * Postgres): src/test/pglite/crewSlotlessBlockFee.pglite.mjs (PASS applied 3x;
 * RED with --before, the live definition: owed $0.00).
 *
 * @mutate supabase/migrations/20261007131605_crew_block_slotless_fee_by_hire_order.sql |           COALESCE(g.slot_no, ( |           COALESCE(NULL, (
 */
import { describe, it, expect } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const block = blankSqlComments(defs.get("block_user_and_settle")?.stmt ?? "");
const cancel = blankSqlComments(defs.get("poster_cancel_job")?.stmt ?? "");

describe("Q1380: a slotless crew row's block fee is priced by hire order", () => {
  it("inventory: both functions are found (floor)", () => {
    expect(block.length).toBeGreaterThan(2000);
    expect(cancel.length).toBeGreaterThan(2000);
  });

  it("block_user_and_settle falls back to the hire-order slot, as poster_cancel_job does", () => {
    expect(cancel).toMatch(/row_number\(\) OVER \(ORDER BY g\.joined_at NULLS LAST, g\.id\)/);
    expect(block).toMatch(/COALESCE\(g\.slot_no, \(\s*SELECT \(r\.rn - 1\)::integer FROM \(\s*SELECT g2\.id, row_number\(\) OVER \(ORDER BY g2\.joined_at NULLS LAST, g2\.id\) AS rn/);
  });
});

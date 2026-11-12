/**
 * Preorder words (20261108184654): the product page's label and goal progress, the charge and refund words, the
 * buyer's cancel words, and the shop's ready-from date. Each number matches the SQL's own limit
 * (src/test/shopsPreorders.test.ts reads those).
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  goalProgressText,
  preorderCancelText,
  preorderChargeText,
  preorderClosedText,
  preorderLabel,
  preorderReadyFrom,
  type ItemPreorder,
} from "./preorders";

const P: ItemPreorder = {
  item_id: "i", ready_by: "2026-12-15", goal: 20, goal_by: "2026-12-01", cap: 30, ordered: 12,
  goal_met: false, goal_missed: false, moved: false, open: true,
};

describe("preorder words", () => {
  it("label and goal progress", () => {
    expect(preorderLabel(P)).toBe("Preorder · ready by Dec 15");
    expect(goalProgressText(P)).toBe("12 of 20 ordered · ends Dec 1");
    expect(goalProgressText({ ...P, goal_met: true, ordered: 21 })).toBe("Goal reached: 21 ordered");
    expect(goalProgressText({ ...P, goal_missed: true })).toBe("Didn't reach 20 by Dec 1. Everyone was refunded.");
    expect(goalProgressText({ ...P, goal: null, goal_by: null })).toBeNull();
  });

  it("charge and refund words: charged now, the goal's refund, the late refund, the cancel", () => {
    expect(preorderChargeText(P)).toEqual([
      "You're charged now, in full.",
      "If it doesn't reach 20 by Dec 1, you get a full refund automatically.",
      "If the shop doesn't have it ready by Dec 22, you get a full refund automatically.",
      "You can cancel until the shop marks it ready, for a full refund.",
    ]);
    // No goal (or a goal already met): no goal refund line.
    expect(preorderChargeText({ ...P, goal: null, goal_by: null })).toHaveLength(3);
    expect(preorderChargeText({ ...P, goal_met: true })).toHaveLength(3);
  });

  it("closed, full and missed", () => {
    expect(preorderClosedText(P)).toBeNull();
    expect(preorderClosedText({ ...P, open: false, ordered: 30 })).toBe("This preorder is full.");
    expect(preorderClosedText({ ...P, open: false, goal_missed: true })).toBe("This preorder didn't reach its goal.");
    expect(preorderClosedText({ ...P, open: false })).toBe("This preorder is closed.");
  });

  it("S2-019: the buyer's own cancel before ready gets everything back, the setup fee its charge carried too", () => {
    const o = { total_cents: 2170, ready_date: "2026-12-15", preorder_moved_at: null };
    expect(preorderCancelText(o, "2026-12-01")).toBe("You get everything you paid back: $21.70. The shop is told.");
    expect(preorderCancelText({ ...o, setup_fee_cents: 200, setup_fee_state: "claimed" }, "2026-12-01")).toBe("You get everything you paid back: $23.70. The shop is told.");
    expect(preorderCancelText({ ...o, preorder_moved_at: "2026-12-10T00:00:00Z" }, "2026-12-01")).toBe("You get everything you paid back: $21.70. The shop is told.");
    // The sweep's late time: the end of ready-by + 7 (Dec 22), so from Dec 23.
    expect(preorderCancelText(o, "2026-12-22")).not.toContain("card processing cost");
    expect(preorderCancelText(o, "2026-12-23")).toBe("You get everything you paid back: $21.70. The shop is told.");
  });

  it("the shop's ready tap opens 14 days before ready-by (the server's shop_handovers_preorder_ready_guard)", () => {
    expect(preorderReadyFrom("2026-12-15")).toBe("2026-12-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

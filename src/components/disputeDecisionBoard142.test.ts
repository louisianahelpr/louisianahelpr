/**
 * Board 142: the dispute decision reads per side, from the admin's split, and
 * promises nothing the server does not do (no decide-by date, no bank timing,
 * no second look, no staff name: lead 10-21, members see "Helpr Support").
 *
 * @mutate src/components/disputeTimeline/DisputeDecisionCard.tsx |   if (side === "helpr") return poster >= 1 ? "No payment" : poster <= 0 ? "Paid in full" : "Partial payment"; |   if (side === "helpr") return poster >= 1 ? "Full refund" : poster <= 0 ? "No refund" : "Partial refund";
 * @mutate src/components/disputeTimeline/DisputeDecisionCard.tsx | <>— Helpr Support</> | <>— Ask once for a second look</>
 * @mutate src/components/DisputeTimelineDialog.tsx |   const heldNow = paymentStatus === "escrow" && !decidedAt && !withdrawn; |   const heldNow = !decidedAt && !withdrawn;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { outcomeHeadline } from "@/components/disputeTimeline/DisputeDecisionCard";

describe("board 142: decision headline per side", () => {
  it.each([
    ["poster", { poster: 1, helper: 0 }, "Full refund"],
    ["poster", { poster: 0.5, helper: 0.5 }, "Partial refund"],
    ["poster", { poster: 0, helper: 1 }, "No refund"],
    ["helpr", { poster: 1, helper: 0 }, "No payment"],
    ["helpr", { poster: 0.5, helper: 0.5 }, "Partial payment"],
    ["helpr", { poster: 0, helper: 1 }, "Paid in full"],
    [null, { poster: 0.5, helper: 0.5 }, "Split decision"],
    ["poster", null, "Decided"],
  ] as const)("%s %j -> %s", (side, split, want) => {
    expect(outcomeHeadline(side, split)).toBe(want);
  });

  // Before the viewer's amount is stamped, name the decision, never a result.
  it.each([
    ["helpr", { poster: 0, helper: 1 }, "Decision: full payment to you"],
    ["poster", { poster: 1, helper: 0 }, "Decision: full refund"],
    ["helpr", { poster: 0.5, helper: 0.5 }, "Decision: partial payment to you"],
  ] as const)("unsettled %s %j -> %s", (side, split, want) => {
    expect(outcomeHeadline(side, split, false)).toBe(want);
  });

  it("the held-money note shows only while the job's payment is in escrow", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/DisputeTimelineDialog.tsx"), "utf8"));
    expect(src).toContain(`const heldNow = paymentStatus === "escrow" && !decidedAt && !withdrawn;`);
    expect(src).toMatch(/\{heldNow && \(\s*<MoneyNote>/);
  });

  it("the dialog promises no decide-by date, bank timing or second look", () => {
    const src = ["src/components/DisputeTimelineDialog.tsx", "src/components/disputeTimeline/DisputeDecisionCard.tsx"]
      .map((f) => blankComments(readFileSync(join(process.cwd(), f), "utf8"))).join("\n");
    expect(src).toContain("— Helpr Support");
    for (const re of [/second look/i, /business days/i, /decide by/i, /card ending/i]) expect(src).not.toMatch(re);
  });
});

/**
 * F266a (owner 11-11 ~2:10 PM): the Money page shows ONE stack for the Helpr: "On its way / Waiting for approval /
 * Held in a dispute". "On its way" is the approved pay not sent yet (comingToYou, unchanged); the other two come from
 * earningsTabHelpers.moneyStack over the same earnings read, priced as the Helpr's take-home. Home's strip keeps
 * "Coming to you" alone (the hook half: homeMoneyGating.test.tsx). Definitions: DECISIONS-FOR-OWNER-1111.md "## Builder 3".
 *
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   j.payment_status === "escrow" && (j.status === "disputed" \|\| (j.has_active_dispute === true && !j.dispute_resolved_at)); |   j.payment_status === "escrow" && j.status === "disputed";
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   !isHeldInDispute(j) &&\n | \n
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   !j.poster_completed_at &&\n | \n
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts | const AWAITING_SIGN_OFF_JOB_STATUSES: readonly string[] = ["in_progress", "pending_approval", "accepted"]; | const AWAITING_SIGN_OFF_JOB_STATUSES: readonly string[] = ["in_progress", "pending_approval", "accepted", "revision_requested"];
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |       {stack && stack.disputeCents > 0 && ( |       {false && (
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   const comingLabel = placement === "money" ? t("mt.onItsWay") : t("mt.comingToYou"); |   const comingLabel = t("mt.comingToYou");
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { isHeldInDispute, isWaitingForApproval, moneyStack } from "@/components/profile/earningsTab/earningsTabHelpers";
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";

// A $100 job at a 10% fee (no flat stamp): take-home $90.00.
const job = (over: Record<string, unknown> = {}) => ({
  id: "j", status: "in_progress", payment_status: "escrow", budget: 100, helper_fee_percent: 10,
  helper_fee_flat_cents: null, helper_completed_at: "2026-11-10T18:00:00Z", poster_completed_at: null,
  has_active_dispute: false, dispute_resolved_at: null, is_group_job: false, ...over,
});

describe("F266a: what each row of the stack counts", () => {
  it("waiting for approval: held, marked done by the Helpr, not approved by the poster, no dispute", () => {
    expect(isWaitingForApproval(job())).toBe(true);
    expect(isWaitingForApproval(job({ status: "pending_approval" }))).toBe(true);
    expect(isWaitingForApproval(job({ helper_completed_at: null }))).toBe(false); // not done yet
    expect(isWaitingForApproval(job({ poster_completed_at: "2026-11-11T00:00:00Z" }))).toBe(false); // approved
    expect(isWaitingForApproval(job({ payment_status: "payout_pending", status: "completed" }))).toBe(false); // On its way
    expect(isWaitingForApproval(job({ status: "revision_requested" }))).toBe(false); // back with the Helpr
    expect(isWaitingForApproval(job({ has_active_dispute: true }))).toBe(false); // in a dispute instead
  });

  it("held in a dispute: held and disputed, until the dispute is resolved", () => {
    expect(isHeldInDispute(job({ status: "disputed" }))).toBe(true);
    expect(isHeldInDispute(job({ has_active_dispute: true }))).toBe(true);
    expect(isHeldInDispute(job({ has_active_dispute: true, dispute_resolved_at: "2026-11-11T00:00:00Z" }))).toBe(false);
    expect(isHeldInDispute(job({ status: "disputed", payment_status: "refunded" }))).toBe(false); // money gone back
  });

  it("each row is the Helpr's take-home, in cents", () => {
    const s = moneyStack([job(), job({ budget: 50 }), job({ status: "disputed", budget: 200 }), job({ helper_completed_at: null })] as never, 10);
    expect(s).toEqual({ waitingCents: 9000 + 4500, disputeCents: 18000 });
  });
});

describe("F266a: You > Money draws one stack; Home does not", () => {
  const COMING = { cents: 12500, at: null, overdue: false, severalDates: false, hasPayoutAccount: true };
  const draw = (money: Record<string, unknown>, placement: "money" | "main") =>
    render(<MemoryRouter><HomeMoneyTiles money={money as never} placement={placement} /></MemoryRouter>);

  it("On its way, then Waiting for approval and Held in a dispute, in one tile", () => {
    draw({ coming: COMING, held: null, stack: { waitingCents: 13500, disputeCents: 18000 } }, "money");
    const tile = screen.getByRole("button", { name: /^On its way/ });
    expect(tile.textContent).toContain("$125.00");
    expect(tile.querySelector('[data-money-stack="waiting"]')?.textContent).toBe("Waiting for approval$135.00");
    expect(tile.querySelector('[data-money-stack="dispute"]')?.textContent).toBe("Held in a dispute$180.00");
  });

  it("a row with no money is not drawn; nothing approved yet still shows the stack", () => {
    draw({ coming: null, held: null, stack: { waitingCents: 9000, disputeCents: 0 } }, "money");
    const tile = screen.getByRole("button", { name: /^On its way/ });
    expect(tile.textContent).toContain("$0.00");
    expect(tile.querySelector('[data-money-stack="waiting"]')).not.toBeNull();
    expect(tile.querySelector('[data-money-stack="dispute"]')).toBeNull();
  });

  it("Home's strip keeps Coming to you alone", () => {
    draw({ coming: COMING, held: null, stack: { waitingCents: 13500, disputeCents: 18000 } }, "main");
    expect(screen.getByRole("button", { name: /^Coming to you/ }).querySelector("[data-money-stack]")).toBeNull();
    cleanup();
  });
});

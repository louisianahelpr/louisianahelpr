/**
 * Q1191 — the dispute timeline says WHY a decided dispute closed with amounts
 * that are not its split.
 *
 * WHAT WAS BROKEN (read in source, 2026-10-03): settle_dispute_by_external_refund
 * (20261003181427) records the decided dispute executed with the refunded
 * charge as the poster's share, Helpr $0, and an execution_error starting
 * "closed by a full refund made outside the split". DisputeTimelineDialog
 * explained only the lost-chargeback close, so this one read "Settled: who
 * posted it $X · Helpr $0.00" under a 50/50 decision with no reason.
 *
 * Held here: each close prefix the client keys on is byte-identical to the
 * text the NEWEST definition of its writer stamps; each maps to its own
 * sentence; and the dialog renders that sentence for any close reason.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments } from "./helpers/blankNonCode";
import {
  CHARGEBACK_CLOSE_PREFIX,
  OUTSIDE_REFUND_CLOSE_PREFIX,
  NO_PAYMENT_CLOSE_PREFIX,
  DISPUTE_CLOSE_COPY,
  disputeCloseReason,
  closeMovedNothing,
} from "@/components/disputeCloseReason";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

describe("Q1191: why a decided dispute closed outside its split", () => {
  const defs = effectiveDefs(MIG_DIR);

  it("each prefix is what its writer's newest definition stamps", () => {
    const squash = (fn: string) => (defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
    const writers: Array<[string, string]> = [
      ["settle_dispute_by_chargeback", `execution_error = '${CHARGEBACK_CLOSE_PREFIX} (`],
      ["settle_dispute_by_external_refund", `execution_error = '${OUTSIDE_REFUND_CLOSE_PREFIX} (`],
      ["rpc_settle_dispute_without_payment", `execution_error = '${NO_PAYMENT_CLOSE_PREFIX}: '`],
    ];
    for (const [fn, stamp] of writers) {
      expect(squash(fn).length, fn).toBeGreaterThan(500);
      expect(squash(fn), fn).toContain(stamp);
    }
  });

  it("an admin no-payment close says so and hides its $0 · $0 line, like a chargeback", () => {
    const d = { execution_status: "executed", execution_error: `${NO_PAYMENT_CLOSE_PREFIX}: test note` };
    expect(disputeCloseReason(d)).toBe("no_payment");
    expect(DISPUTE_CLOSE_COPY.no_payment).toMatch(/no payment was on file/);
    expect(closeMovedNothing("no_payment")).toBe(true);
    expect(closeMovedNothing("chargeback")).toBe(true);
    // An outside refund's amounts are real money that moved back: keep them.
    expect(closeMovedNothing("outside_refund")).toBe(false);
    expect(closeMovedNothing(null)).toBe(false);
  });

  it("an outside full refund reads as its own close, with its own sentence", () => {
    const d = {
      execution_status: "executed",
      execution_error: `${OUTSIDE_REFUND_CLOSE_PREFIX} (ch_123): the whole charge went back to the card holder, so no escrow was left to split`,
    };
    expect(disputeCloseReason(d)).toBe("outside_refund");
    expect(DISPUTE_CLOSE_COPY.outside_refund).toMatch(/full refund/i);
    expect(DISPUTE_CLOSE_COPY.outside_refund).not.toBe(DISPUTE_CLOSE_COPY.chargeback);
  });

  it("the chargeback close is unchanged", () => {
    expect(disputeCloseReason({ execution_status: "executed", execution_error: `${CHARGEBACK_CLOSE_PREFIX} (du_1): x` })).toBe("chargeback");
    expect(DISPUTE_CLOSE_COPY.chargeback).toBe(
      "Closed by the card holder's bank: the payment went back to the card, so nothing was split here.",
    );
  });

  it("an ordinary settle, an unsettled one, and a failed one give no close reason", () => {
    expect(disputeCloseReason({ execution_status: "executed", execution_error: null })).toBeNull();
    expect(disputeCloseReason({ execution_status: "failed", execution_error: `${OUTSIDE_REFUND_CLOSE_PREFIX} (ch_1)` })).toBeNull();
    expect(disputeCloseReason(null)).toBeNull();
  });

  it("the timeline renders the sentence for every close reason", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/DisputeTimelineDialog.tsx"), "utf8"));
    expect(src).toContain("const closeReason = disputeCloseReason(dispute);");
    expect(src).toMatch(/\{closeReason && \(\s*<p[^>]*>\s*\{DISPUTE_CLOSE_COPY\[closeReason\]\}/);
    // The amounts line is hidden for a close that moved nothing.
    expect(src).toContain("const movedNothing = closeMovedNothing(closeReason);");
    expect(src).toContain(`{dispute?.execution_status === "executed" && !movedNothing &&`);
  });
});

// @mutate src/components/disputeCloseReason.ts |   if (note.startsWith(OUTSIDE_REFUND_CLOSE_PREFIX)) return "outside_refund"; |
// @mutate src/components/disputeCloseReason.ts |   if (note.startsWith(NO_PAYMENT_CLOSE_PREFIX)) return "no_payment"; |
// @mutate src/components/disputeCloseReason.ts |   return reason === "chargeback" \|\| reason === "no_payment"; |   return reason === "chargeback";
// @mutate src/components/DisputeTimelineDialog.tsx |                 {closeReason && ( |                 {false && (
// @mutate src/components/DisputeTimelineDialog.tsx |                 {dispute?.execution_status === "executed" && !movedNothing && |                 {dispute?.execution_status === "executed" &&
// @mutate src/components/disputeCloseReason.ts | export const OUTSIDE_REFUND_CLOSE_PREFIX = "closed by a full refund made outside the split"; | export const OUTSIDE_REFUND_CLOSE_PREFIX = "closed by a full refund outside the split";

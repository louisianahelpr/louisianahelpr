/**
 * The Job done screen's Helpr headline (boards 35/36) is the transfer itself.
 * lh-money-escrow review 2026-10-20: a reversal_cleared row was counted as kept
 * (and a re-pay then doubled it: $94 read $188), and any non-`paid` row kept
 * "Sent" unlit forever.
 *
 * @mutate src/lib/jobDonePay.ts | if (t.status === "reversed" \|\| t.status === "reversal_cleared") { | if (t.status === "reversed") {
 * @mutate src/lib/jobDonePay.ts | return { cents, sent: cents > 0 && !pending }; | return { cents, sent: cents > 0 };
 */
import { describe, expect, it } from "vitest";
import { transferredCents } from "./jobDonePay";

const row = (status: string, amount_cents: number, metadata: unknown = null) => ({ status, amount_cents, metadata });

describe("transferredCents (Job done Helpr headline)", () => {
  it("counts a paid transfer as sent", () => {
    expect(transferredCents([row("paid", 2100)])).toEqual({ cents: 2100, sent: true });
  });
  it("a pending transfer is on its way, not sent", () => {
    expect(transferredCents([row("pending", 2100)])).toEqual({ cents: 2100, sent: false });
  });
  it("failed and canceled rows moved nothing", () => {
    expect(transferredCents([row("failed", 2100), row("canceled", 2100)])).toEqual({ cents: 0, sent: false });
  });
  it("a cleared reversal plus its re-pay is the re-pay once, not twice", () => {
    expect(transferredCents([row("reversal_cleared", 9400), row("paid", 9400)])).toEqual({ cents: 9400, sent: true });
  });
  it("a partial reversal keeps what was not taken back, and does not block Sent", () => {
    expect(transferredCents([row("reversed", 9400, { amount_reversed_cents: 4700 })])).toEqual({ cents: 4700, sent: true });
  });
  it("a reversal with no figure took the whole row back", () => {
    expect(transferredCents([row("reversed", 9400)])).toEqual({ cents: 0, sent: false });
  });
});

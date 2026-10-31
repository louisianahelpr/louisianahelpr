// AUD31-43: the held row's reason in words; unknown codes and free text pass through.
// @mutate src/components/admin/adminPayoutBatches/heldReason.ts |   if (!m \|\| !words) return reason; |   return reason;
import { describe, expect, it } from "vitest";
import { heldReasonWords } from "./heldReason";

describe("heldReasonWords", () => {
  it("names each known category in words and keeps its detail", () => {
    expect(heldReasonWords("transfer_failed: insufficient funds")).toBe("The Stripe transfer failed. Detail: insufficient funds");
    expect(heldReasonWords("payee_deleted")).toBe("The payee deleted their account.");
    expect(heldReasonWords("needs_reconcile: ")).toBe("A transfer may already exist (check Stripe by hand).");
  });
  it("passes free text and unknown codes through, and says when there is none", () => {
    expect(heldReasonWords("Refund made in Stripe on this order")).toBe("Refund made in Stripe on this order");
    expect(heldReasonWords("something_new: x")).toBe("something_new: x");
    expect(heldReasonWords(null)).toBe("No reason recorded");
    expect(heldReasonWords("  ")).toBe("No reason recorded");
  });
});

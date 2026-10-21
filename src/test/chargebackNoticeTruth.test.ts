/**
 * Board 145 (truth rule): the chargeback notice never says Helpr answers the
 * bank or sends evidence for the member. No code submits chargeback evidence
 * (stripe-webhook has no disputes.update call), so that sentence would be a
 * promise nobody keeps while someone's payout is on hold.
 *
 * @mutate src/lib/jobPaymentCardState.ts |     body: "The cardholder disputed this charge with their bank.", |     body: "Helpr answers the bank for you with the delivery record.",
 * @mutate src/lib/jobPaymentCardState.ts |     money: "Payouts for this job are on hold because of this dispute.", |     money: "If the bank sides with the payment, the payout goes through automatically.",
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_PROBLEM_COPY } from "@/lib/jobPaymentCardState";
import { blankComments } from "./helpers/blankNonCode";

describe("board 145: chargeback copy promises only what exists", () => {
  const all = Object.values(PAYMENT_PROBLEM_COPY).flatMap((c) => Object.values(c)).join("\n");

  it("reads the copy table", () => {
    expect(Object.keys(PAYMENT_PROBLEM_COPY)).toContain("chargeback");
    expect(all.length).toBeGreaterThan(100);
  });

  it("no member copy claims Helpr answers the bank or sends evidence", () => {
    expect(all).not.toMatch(/answers the bank|send[s]? (the )?evidence|evidence for you|delivery record/i);
    // Only a clawed-back payout is re-paid on a win; an unpaid one waits on an admin.
    expect(all).not.toMatch(/automatically/i);
  });

  it("the premise holds: no edge function submits evidence to the bank", () => {
    const dir = join(process.cwd(), "supabase/functions/stripe-webhook/handlers");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(blankComments(readFileSync(join(dir, f), "utf8"))).not.toMatch(/disputes\.update\(/);
  });
});

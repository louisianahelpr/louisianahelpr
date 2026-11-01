/**
 * The words and rules of "Your pay is delayed" (10-30 jobs audit, item 8). The two
 * payout exits that send it are tested on the real cron in
 * src/test/edge/process-scheduled-payouts.test.ts.
 *
 * @mutate supabase/functions/_shared/payDelayNotice.ts | return kind === "not_payable" \|\| kind === "rejected" \|\| kind === "unusable" ? "account" : "sending"; | return "account";
 * @mutate supabase/functions/_shared/payDelayNotice.ts | now - at >= PAY_DELAY_GRACE_HOURS * 60 * 60 * 1000 | now - at >= 0
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | poster_fee_flat_cents, is_seed, payout_scheduled_at"; | poster_fee_flat_cents, is_seed";
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { payDelayMessage, payDelayWhyForGate, payIsOverdue } from "../../supabase/functions/_shared/payDelayNotice";

const H = 3_600_000;
const pastBy = (hours: number) => new Date(Date.now() - hours * H).toISOString();

describe("the cron can tell a job is late", () => {
  // Without this column every job reads "not known to be late" and nobody is ever told.
  it("selects payout_scheduled_at on the jobs it pays", () => {
    const cron = readFileSync(resolve(process.cwd(), "supabase/functions/process-scheduled-payouts/index.ts"), "utf8");
    // JOB_COLUMNS is the one column list both the normal and the early crew-member pass select (JOBS-3).
    expect(cron).toMatch(/const JOB_COLUMNS = "[^"]*is_seed, payout_scheduled_at";/);
    expect(cron).toMatch(/\.select\(JOB_COLUMNS\)\s*\.eq\("status", "completed"\)/);
  });
});

describe("the words", () => {
  it("says why and what to do", () => {
    expect(payDelayMessage("Mow", "account")).toBe(`Your pay for "Mow" is delayed because your payout account can't receive money right now. Your pay is kept for you. Profile → Payments shows what's needed.`);
    expect(payDelayMessage("Mow", "sending")).toBe(`Your pay for "Mow" is delayed because we couldn't send it. You don't need to do anything. We're trying again and will tell you when it's sent.`);
  });

  it("only a problem with their own account asks them to look at it", () => {
    for (const kind of ["not_payable", "rejected", "unusable"]) expect(payDelayWhyForGate(kind), kind).toBe("account");
    for (const kind of ["platform_rejected", "cannot_verify"]) expect(payDelayWhyForGate(kind), kind).toBe("sending");
  });

  it("is late only past the grace, and never on an unreadable time", () => {
    expect(payIsOverdue(pastBy(13))).toBe(true);
    expect(payIsOverdue(pastBy(11))).toBe(false);
    expect(payIsOverdue(null)).toBe(false);
    expect(payIsOverdue("not a date")).toBe(false);
  });
});

/**
 * BOARD 120: THE DELETE-ACCOUNT MONEY COPY SAYS WHAT THE SERVER DOES.
 *
 * The dialog used to say "Pending payouts will be forfeited ... Cash out from
 * Earnings first". No code forfeits anything: delete-own-account REFUSES the
 * delete (409) while any job is live or its money is in escrow or
 * payout_pending (_shared/accountPurge.ts LIVE_STATUS_FILTER), and the purge
 * never touches the payout account (it cancels only the membership).
 *
 * CLASS: the member-facing delete dialog may not promise a money outcome the
 * server does not produce. It states the refusal instead, and that statement
 * is only allowed while the server really refuses on held AND pending money.
 *
 * @mutate src/components/profile/DeleteAccountDialog.tsx | or money is still on its way to you. | or your pending payouts will be forfeited.
 * @mutate supabase/functions/_shared/accountPurge.ts |   const owed = await findMoneyOwedToMember(admin, userId); |   const owed = { ok: true, active: false } as ActiveWorkResult;
 * @mutate supabase/functions/_shared/accountPurge.ts |   "payment_status.in.(escrow,payout_pending,held)"; |   "payment_status.in.(escrow,held)";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const DIALOG = read("src/components/profile/DeleteAccountDialog.tsx");
const PURGE = read("supabase/functions/_shared/accountPurge.ts");
const FN = read("supabase/functions/delete-own-account/index.ts");

describe("board 120: delete-account copy matches delete-own-account", () => {
  it("reads the real files", () => {
    expect(DIALOG.length).toBeGreaterThan(1000);
    expect(PURGE).toMatch(/LIVE_STATUS_FILTER\s*=/);
    expect(FN).toMatch(/findActiveWork\(/);
  });

  it("the dialog promises no forfeit, cash-out or payout-before-close outcome", () => {
    for (const re of [/forfeit/i, /cash out/i, /paid out to your bank before/i, /pause (my account|instead)/i]) {
      expect(DIALOG, String(re)).not.toMatch(re);
    }
  });

  it("the server refuses on held AND pending money, and answers 409", () => {
    const filter = /LIVE_STATUS_FILTER\s*=\s*([\s\S]*?);/.exec(PURGE)?.[1] ?? "";
    expect(filter).toMatch(/payment_status\.in\.\([^)]*\bescrow\b/);
    expect(filter).toMatch(/payment_status\.in\.\([^)]*\bpayout_pending\b/);
    expect(FN).toMatch(/status:\s*409/);
  });

  it("the dialog states that refusal, so nobody expects money to be lost", () => {
    expect(DIALOG).toContain("a job's payment is held or waiting to be paid out, or money is still on its way to you.");
  });

  // Q2273: "money is still on its way to you" is only true while findActiveWork
  // also refuses on money owed TO the member (fees, held tips, held payouts).
  it("the server refuses while money is owed to the member", () => {
    const body = PURGE.slice(PURGE.indexOf("export async function findActiveWork"));
    expect(body).toMatch(/const owed = await findMoneyOwedToMember\(admin, userId\);\s*if \(!owed\.ok \|\| owed\.active\) return owed;/);
  });
});

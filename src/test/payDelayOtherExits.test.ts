/**
 * Q2497: every per-job status process-scheduled-payouts writes is classified, both
 * ways: it tells the Helpr "Your pay is delayed" (PAY_DELAY_SENDING_STATUSES, sent
 * after the loop for a single-Helpr job past its promised time), or it is EXEMPT
 * here with the reason. A new exit fails this until someone decides. The notice on
 * the real cron is tested in src/test/edge/process-scheduled-payouts.test.ts.
 *
 * @mutate supabase/functions/_shared/payDelayNotice.ts |   "ledger_read_error",\n |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { PAY_DELAY_SENDING_STATUSES } from "../../supabase/functions/_shared/payDelayNotice";

// @two-way src/test/payDelayOtherExits.test.ts:stale exempt status — the cron no longer writes it
const EXEMPT: Record<string, string> = {
  transferred: "paid",
  released: "paid",
  already_transferred: "already paid (healed)",
  transfer_failed: "told where it fails (the transfer catch)",
  payee_not_payable: "told where it fails (the live payout gate, 'account' words)",
  no_connect_account: "its own 'Payout account required' notice",
  payout_held: "a staff payout hold (Q764); the hold is staff's to explain",
  unsettled_dispute_hold: "an open dispute the Helpr is a party to",
  dispute_closed_as_test: "a dispute an admin closed as a test; test data, no page by design (Q1910)",
  reversed_transfer_hold: "money already moved and was clawed back; staff reconcile",
  skipped_test_mode_object: "a test-mode object (test data)",
  stripe_mode_refused: "a job pairing a test account with a real one",
  already_claimed: "another run is paying it right now",
  job_moved_on: "refunded or cancelled meanwhile; nothing is owed",
  no_pi: "no payment was ever taken",
  gift_job_card_leg_failed: "the poster's card leg failed; nothing to pay from",
  payout_below_onboarding_fee: "never sends on its own (needs ops); 'we're trying again' would be false",
  roster_read_error: "crew job (per-member exits are not covered yet)",
  crew_decision_read_error: "crew job",
  crew_decision_ambiguous: "crew job",
  crew_decision_pays_nobody: "crew job",
  early_member_not_on_roster: "crew job",
  no_payable_helper: "nobody to tell",
};

describe("process-scheduled-payouts: every stuck exit tells the Helpr or says why not (Q2497)", () => {
  const src = blankComments(readFileSync("supabase/functions/process-scheduled-payouts/index.ts", "utf8"));
  const written = new Set<string>();
  for (const m of src.matchAll(/status:\s*"([a-z_]+)"/g)) written.add(m[1]);
  for (const m of src.matchAll(/status:\s*`([a-z_]+)\$\{/g)) written.add(`${m[1]}*`);
  for (const m of src.matchAll(/status:\s*[\w.]+\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) { written.add(m[1]); written.add(m[2]); }
  if (/status:\s*PAYOUT_HELD_CODE/.test(src)) written.add("payout_held");

  it("each status is told or exempt, never both", () => {
    const unclassified = [...written].filter((s) => !s.endsWith("*") && !PAY_DELAY_SENDING_STATUSES.has(s) && !(s in EXEMPT));
    expect(unclassified).toEqual([]);
    expect([...PAY_DELAY_SENDING_STATUSES].filter((s) => s in EXEMPT)).toEqual([]);
    // pi_not_succeeded_<status>: the poster's payment is not there; nothing to pay from.
    expect([...written].filter((s) => s.endsWith("*"))).toEqual(["pi_not_succeeded_*"]);
  });

  it("no stale entry: every listed status is one the cron still writes", () => {
    expect([...PAY_DELAY_SENDING_STATUSES].filter((s) => !written.has(s))).toEqual([]);
    const stale = Object.keys(EXEMPT).filter((s) => !written.has(s));
    expect(stale, `stale exempt status — the cron no longer writes it: ${stale.join(", ")}`).toEqual([]);
  });

  it("inventory floor", () => {
    expect(written.size).toBeGreaterThan(30);
    expect(PAY_DELAY_SENDING_STATUSES.size).toBeGreaterThan(15);
  });
});
